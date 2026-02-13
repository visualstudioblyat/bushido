use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const MAX_MSG_LEN: usize = 65535;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessage {
    // Pairing
    PairRequest { device_id: String, device_name: String },
    PairAccept { device_id: String, device_name: String },
    PairReject { reason: String },
    SpakeMsg { msg: Vec<u8> },
    PairConfirm { hmac: Vec<u8> },
    PairKeyExchange { encrypted_public_key: Vec<u8> },
    PairComplete,

    // General
    Close { reason: String },
    Ping,
    Pong,
}

/// Encode a SyncMessage to MessagePack bytes.
pub fn encode(msg: &SyncMessage) -> Result<Vec<u8>, String> {
    rmp_serde::to_vec(msg).map_err(|e| format!("encode: {}", e))
}

/// Decode MessagePack bytes to a SyncMessage.
pub fn decode(bytes: &[u8]) -> Result<SyncMessage, String> {
    rmp_serde::from_slice(bytes).map_err(|e| format!("decode: {}", e))
}

/// Send a length-prefixed MessagePack message over TCP (unencrypted — for pairing).
pub async fn send_message(stream: &mut TcpStream, msg: &SyncMessage) -> Result<(), String> {
    let data = encode(msg)?;
    if data.len() > MAX_MSG_LEN {
        return Err("message too large".into());
    }
    let len = (data.len() as u32).to_be_bytes();
    stream.write_all(&len).await.map_err(|e| format!("write len: {}", e))?;
    stream.write_all(&data).await.map_err(|e| format!("write data: {}", e))?;
    stream.flush().await.map_err(|e| format!("flush: {}", e))?;
    Ok(())
}

/// Receive a length-prefixed MessagePack message from TCP (unencrypted — for pairing).
pub async fn recv_message(stream: &mut TcpStream) -> Result<SyncMessage, String> {
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("read len: {}", e))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_MSG_LEN {
        return Err("message too large".into());
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .await
        .map_err(|e| format!("read data: {}", e))?;
    decode(&buf)
}
