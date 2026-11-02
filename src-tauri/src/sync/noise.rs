use snow::TransportState;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const MAX_MSG_LEN: usize = 65535;
// leave room for Noise overhead (16-byte AEAD tag + length prefix)
const NOISE_CHUNK_SIZE: usize = 65000;

pub struct NoiseStream {
    stream: TcpStream,
    transport: TransportState,
    send_buf: Vec<u8>,
    recv_buf: Vec<u8>,
}

impl NoiseStream {
    /// Perform initiator-side Noise XX handshake (3 messages).
    pub async fn handshake_initiator(
        mut stream: TcpStream,
        local_private_key: &[u8],
    ) -> Result<Self, String> {
        let mut handshake = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
            .local_private_key(local_private_key)
            .map_err(|e| format!("builder key: {}", e))?
            .build_initiator()
            .map_err(|e| format!("build initiator: {}", e))?;

        let mut buf = vec![0u8; MAX_MSG_LEN];

        // -> e
        let len = handshake
            .write_message(&[], &mut buf)
            .map_err(|e| format!("hs write 1: {}", e))?;
        send_frame(&mut stream, &buf[..len]).await?;

        // <- e, ee, s, es
        let msg2 = recv_frame(&mut stream).await?;
        handshake
            .read_message(&msg2, &mut buf)
            .map_err(|e| format!("hs read 2: {}", e))?;

        // -> s, se
        let len = handshake
            .write_message(&[], &mut buf)
            .map_err(|e| format!("hs write 3: {}", e))?;
        send_frame(&mut stream, &buf[..len]).await?;

        let transport = handshake
            .into_transport_mode()
            .map_err(|e| format!("transport mode: {}", e))?;

        Ok(NoiseStream {
            stream,
            transport,
            send_buf: vec![0u8; MAX_MSG_LEN],
            recv_buf: vec![0u8; MAX_MSG_LEN],
        })
    }

    /// Perform responder-side Noise XX handshake (3 messages).
    pub async fn handshake_responder(
        mut stream: TcpStream,
        local_private_key: &[u8],
    ) -> Result<Self, String> {
        let mut handshake = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
            .local_private_key(local_private_key)
            .map_err(|e| format!("builder key: {}", e))?
            .build_responder()
            .map_err(|e| format!("build responder: {}", e))?;

        let mut buf = vec![0u8; MAX_MSG_LEN];

        // <- e
        let msg1 = recv_frame(&mut stream).await?;
        handshake
            .read_message(&msg1, &mut buf)
            .map_err(|e| format!("hs read 1: {}", e))?;

        // -> e, ee, s, es
        let len = handshake
            .write_message(&[], &mut buf)
            .map_err(|e| format!("hs write 2: {}", e))?;
        send_frame(&mut stream, &buf[..len]).await?;

        // <- s, se
        let msg3 = recv_frame(&mut stream).await?;
        handshake
            .read_message(&msg3, &mut buf)
            .map_err(|e| format!("hs read 3: {}", e))?;

        let transport = handshake
            .into_transport_mode()
            .map_err(|e| format!("transport mode: {}", e))?;

        Ok(NoiseStream {
            stream,
            transport,
            send_buf: vec![0u8; MAX_MSG_LEN],
            recv_buf: vec![0u8; MAX_MSG_LEN],
        })
    }

    /// Send an encrypted message (length-framed Noise ciphertext).
    pub async fn send(&mut self, plaintext: &[u8]) -> Result<(), String> {
        let len = self
            .transport
            .write_message(plaintext, &mut self.send_buf)
            .map_err(|e| format!("noise encrypt: {}", e))?;
        send_frame(&mut self.stream, &self.send_buf[..len]).await
    }

    /// Receive and decrypt a message.
    pub async fn recv(&mut self) -> Result<Vec<u8>, String> {
        let ciphertext = recv_frame(&mut self.stream).await?;
        let len = self
            .transport
            .read_message(&ciphertext, &mut self.recv_buf)
            .map_err(|e| format!("noise decrypt: {}", e))?;
        Ok(self.recv_buf[..len].to_vec())
    }

    /// Send a payload that may exceed the Noise max message size.
    /// Sends a u32 chunk count, then each chunk as a separate Noise message.
    pub async fn send_large(&mut self, plaintext: &[u8]) -> Result<(), String> {
        let chunks: Vec<&[u8]> = plaintext.chunks(NOISE_CHUNK_SIZE).collect();
        let count = if plaintext.is_empty() { 1 } else { chunks.len() };

        // send chunk count as a single Noise message
        let count_bytes = (count as u32).to_be_bytes();
        self.send(&count_bytes).await?;

        if plaintext.is_empty() {
            // single empty chunk
            self.send(&[]).await?;
        } else {
            for chunk in &chunks {
                self.send(chunk).await?;
            }
        }
        Ok(())
    }

    /// Receive a chunked payload (inverse of send_large).
    pub async fn recv_large(&mut self) -> Result<Vec<u8>, String> {
        // read chunk count
        let count_bytes = self.recv().await?;
        if count_bytes.len() != 4 {
            return Err("invalid chunk count".into());
        }
        let count = u32::from_be_bytes([count_bytes[0], count_bytes[1], count_bytes[2], count_bytes[3]]) as usize;
        if count > 1000 {
            return Err("too many chunks".into());
        }

        let mut result = Vec::with_capacity(count * NOISE_CHUNK_SIZE);
        for _ in 0..count {
            let chunk = self.recv().await?;
            result.extend_from_slice(&chunk);
        }
        Ok(result)
    }

    /// Get the remote peer's static public key (available after XX handshake).
    pub fn remote_static_key(&self) -> Option<Vec<u8>> {
        self.transport.get_remote_static().map(|k| k.to_vec())
    }
}

// ── Frame helpers ──────────────────────────────────────────────────────────

/// Write a 4-byte BE length-prefixed frame.
async fn send_frame(stream: &mut TcpStream, data: &[u8]) -> Result<(), String> {
    let len_bytes = (data.len() as u32).to_be_bytes();
    stream
        .write_all(&len_bytes)
        .await
        .map_err(|e| format!("frame write len: {}", e))?;
    stream
        .write_all(data)
        .await
        .map_err(|e| format!("frame write data: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("frame flush: {}", e))?;
    Ok(())
}

/// Read a 4-byte BE length-prefixed frame.
async fn recv_frame(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("frame read len: {}", e))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_MSG_LEN {
        return Err("frame too large".into());
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .await
        .map_err(|e| format!("frame read data: {}", e))?;
    Ok(buf)
}
