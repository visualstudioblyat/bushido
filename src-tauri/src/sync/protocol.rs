use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const MAX_MSG_LEN: usize = 65535;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessage {
    // pairing (phase B)
    PairRequest { device_id: String, device_name: String },
    PairAccept { device_id: String, device_name: String },
    PairReject { reason: String },
    SpakeMsg { msg: Vec<u8> },
    PairConfirm { hmac: Vec<u8> },
    PairKeyExchange { encrypted_public_key: Vec<u8> },
    PairComplete,

    // sync intent (unencrypted, first message to TCP listener)
    SyncRequest { device_id: String },
    SyncAccept,

    // sync protocol (encrypted, over NoiseStream)
    Hello { device_id: String, vv: Vec<u8> },
    HelloAck { vv: Vec<u8> },
    SyncDelta { data: Vec<u8> },    // lz4-compressed loro delta
    SyncSnapshot { data: Vec<u8> }, // lz4-compressed full snapshot
    SyncAck,
    SyncUpToDate,

    // send tab (encrypted, over NoiseStream)
    SendTab {
        sender_device_id: String,
        sender_device_name: String,
        url: String,
        title: String,
    },
    SendTabAck,

    // general
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

// ── Encrypted transport (over NoiseStream) ──────────────────────────────

/// Send a SyncMessage over an encrypted NoiseStream.
pub async fn send_encrypted(
    ns: &mut super::noise::NoiseStream,
    msg: &SyncMessage,
) -> Result<(), String> {
    let data = encode(msg)?;
    ns.send_large(&data).await
}

/// Receive a SyncMessage from an encrypted NoiseStream.
pub async fn recv_encrypted(
    ns: &mut super::noise::NoiseStream,
) -> Result<SyncMessage, String> {
    let data = ns.recv_large().await?;
    decode(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(msg: &SyncMessage) {
        let encoded = encode(msg).unwrap();
        let decoded = decode(&encoded).unwrap();
        // compare debug representations
        assert_eq!(format!("{:?}", msg), format!("{:?}", decoded));
    }

    #[test]
    fn roundtrip_pair_request() {
        roundtrip(&SyncMessage::PairRequest {
            device_id: "abc123".into(),
            device_name: "My PC".into(),
        });
    }

    #[test]
    fn roundtrip_pair_accept() {
        roundtrip(&SyncMessage::PairAccept {
            device_id: "def456".into(),
            device_name: "Other PC".into(),
        });
    }

    #[test]
    fn roundtrip_pair_reject() {
        roundtrip(&SyncMessage::PairReject {
            reason: "too many attempts".into(),
        });
    }

    #[test]
    fn roundtrip_spake_msg() {
        roundtrip(&SyncMessage::SpakeMsg {
            msg: vec![1, 2, 3, 4, 5],
        });
    }

    #[test]
    fn roundtrip_pair_confirm() {
        roundtrip(&SyncMessage::PairConfirm {
            hmac: vec![0xaa; 32],
        });
    }

    #[test]
    fn roundtrip_pair_key_exchange() {
        roundtrip(&SyncMessage::PairKeyExchange {
            encrypted_public_key: vec![0xbb; 64],
        });
    }

    #[test]
    fn roundtrip_pair_complete() {
        roundtrip(&SyncMessage::PairComplete);
    }

    #[test]
    fn roundtrip_sync_request() {
        roundtrip(&SyncMessage::SyncRequest {
            device_id: "device-xyz".into(),
        });
    }

    #[test]
    fn roundtrip_sync_accept() {
        roundtrip(&SyncMessage::SyncAccept);
    }

    #[test]
    fn roundtrip_hello() {
        roundtrip(&SyncMessage::Hello {
            device_id: "dev1".into(),
            vv: vec![10, 20, 30],
        });
    }

    #[test]
    fn roundtrip_hello_ack() {
        roundtrip(&SyncMessage::HelloAck {
            vv: vec![40, 50, 60],
        });
    }

    #[test]
    fn roundtrip_sync_delta() {
        roundtrip(&SyncMessage::SyncDelta {
            data: vec![0xff; 1000],
        });
    }

    #[test]
    fn roundtrip_sync_snapshot() {
        roundtrip(&SyncMessage::SyncSnapshot {
            data: vec![0xee; 2000],
        });
    }

    #[test]
    fn roundtrip_sync_ack() {
        roundtrip(&SyncMessage::SyncAck);
    }

    #[test]
    fn roundtrip_sync_up_to_date() {
        roundtrip(&SyncMessage::SyncUpToDate);
    }

    #[test]
    fn roundtrip_close() {
        roundtrip(&SyncMessage::Close {
            reason: "goodbye".into(),
        });
    }

    #[test]
    fn roundtrip_ping_pong() {
        roundtrip(&SyncMessage::Ping);
        roundtrip(&SyncMessage::Pong);
    }

    #[test]
    fn empty_data_roundtrip() {
        roundtrip(&SyncMessage::SyncDelta { data: vec![] });
        roundtrip(&SyncMessage::Hello {
            device_id: String::new(),
            vv: vec![],
        });
    }
}
