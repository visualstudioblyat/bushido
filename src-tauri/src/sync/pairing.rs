use crate::sync::keys::DeviceIdentity;
use crate::sync::protocol::{self, SyncMessage};
use chacha20poly1305::aead::rand_core::OsRng;
use chacha20poly1305::{aead::Aead, aead::AeadCore, aead::KeyInit, XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use rand::Rng;
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};

// Disambiguate: use Mac trait's new_from_slice
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

type HmacSha256 = Hmac<Sha256>;

const PAIRING_TIMEOUT: Duration = Duration::from_secs(60);
const CONFIRM_LABEL: &[u8] = b"bushido-pair-confirm";

/// Result of a successful pairing.
pub struct PairResult {
    pub device_id: String,
    pub device_name: String,
    pub noise_public_key: Vec<u8>,
    pub fingerprint: String,
}

/// Generate a random 6-digit pairing code.
pub fn generate_code() -> String {
    let code: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
    code.to_string()
}

/// Initiator-side pairing flow: connects, runs SPAKE2-A, exchanges keys.
pub async fn run_initiator(
    stream: &mut TcpStream,
    code: &str,
    own_device_id: &str,
    own_device_name: &str,
    own_noise_public_key: &[u8],
) -> Result<PairResult, String> {
    // 1. Send PairRequest
    protocol::send_message(
        stream,
        &SyncMessage::PairRequest {
            device_id: own_device_id.to_string(),
            device_name: own_device_name.to_string(),
        },
    )
    .await?;

    // 2. Recv PairAccept
    let response = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out waiting for accept".to_string())?
        .map_err(|e| format!("recv accept: {}", e))?;

    let (peer_device_id, peer_device_name) = match response {
        SyncMessage::PairAccept {
            device_id,
            device_name,
        } => (device_id, device_name),
        SyncMessage::PairReject { reason } => return Err(format!("Rejected: {}", reason)),
        _ => return Err("Expected PairAccept".into()),
    };

    // 3. SPAKE2-A
    let (spake_state, spake_msg) = Spake2::<Ed25519Group>::start_a(
        &Password::new(code.as_bytes()),
        &Identity::new(b"bushido-a"),
        &Identity::new(b"bushido-b"),
    );

    // 4. Send our SPAKE msg
    protocol::send_message(
        stream,
        &SyncMessage::SpakeMsg {
            msg: spake_msg.to_vec(),
        },
    )
    .await?;

    // 5. Recv peer SPAKE msg
    let peer_spake_msg = recv_expect_spake(stream).await?;

    // 6. Derive shared key
    let shared_key = spake_state
        .finish(&peer_spake_msg)
        .map_err(|e| format!("SPAKE2 finish: {:?}", e))?;

    // 7. HMAC confirmation — send ours, recv + verify theirs
    let our_hmac = compute_hmac(&shared_key)?;

    protocol::send_message(
        stream,
        &SyncMessage::PairConfirm {
            hmac: our_hmac.clone(),
        },
    )
    .await?;

    let peer_hmac = recv_expect_confirm(stream).await?;
    if peer_hmac != our_hmac {
        return Err("Wrong code".into());
    }

    // 8. Encrypt and send our Noise public key
    let encrypted_pk = encrypt_public_key(&shared_key, own_noise_public_key)?;
    protocol::send_message(
        stream,
        &SyncMessage::PairKeyExchange {
            encrypted_public_key: encrypted_pk,
        },
    )
    .await?;

    // 9. Recv peer's encrypted public key
    let peer_encrypted_pk = recv_expect_key_exchange(stream).await?;
    let peer_noise_pk = decrypt_public_key(&shared_key, &peer_encrypted_pk)?;

    // 10. Complete
    protocol::send_message(stream, &SyncMessage::PairComplete).await?;

    let complete = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out waiting for PairComplete".to_string())?
        .map_err(|e| format!("recv complete: {}", e))?;
    if !matches!(complete, SyncMessage::PairComplete) {
        return Err("Expected PairComplete".into());
    }

    Ok(PairResult {
        device_id: peer_device_id,
        device_name: peer_device_name,
        fingerprint: DeviceIdentity::fingerprint_from_public_key(&peer_noise_pk),
        noise_public_key: peer_noise_pk,
    })
}

/// Responder-side pairing flow: PairRequest already consumed by TCP listener.
pub async fn run_responder(
    stream: &mut TcpStream,
    code: &str,
    own_device_id: &str,
    own_device_name: &str,
    own_noise_public_key: &[u8],
    peer_device_id: &str,
    peer_device_name: &str,
) -> Result<PairResult, String> {
    // 1. Send PairAccept
    protocol::send_message(
        stream,
        &SyncMessage::PairAccept {
            device_id: own_device_id.to_string(),
            device_name: own_device_name.to_string(),
        },
    )
    .await?;

    // 2. SPAKE2-B
    let (spake_state, spake_msg) = Spake2::<Ed25519Group>::start_b(
        &Password::new(code.as_bytes()),
        &Identity::new(b"bushido-a"),
        &Identity::new(b"bushido-b"),
    );

    // 3. Recv initiator's SPAKE msg
    let init_spake_msg = recv_expect_spake(stream).await?;

    // 4. Send our SPAKE msg
    protocol::send_message(
        stream,
        &SyncMessage::SpakeMsg {
            msg: spake_msg.to_vec(),
        },
    )
    .await?;

    // 5. Derive shared key
    let shared_key = spake_state
        .finish(&init_spake_msg)
        .map_err(|e| format!("SPAKE2 finish: {:?}", e))?;

    // 6. Recv initiator's HMAC, verify, send ours
    let init_hmac = recv_expect_confirm(stream).await?;
    let our_hmac = compute_hmac(&shared_key)?;

    if init_hmac != our_hmac {
        return Err("Wrong code".into());
    }

    protocol::send_message(
        stream,
        &SyncMessage::PairConfirm {
            hmac: our_hmac,
        },
    )
    .await?;

    // 7. Recv initiator's encrypted public key, decrypt, then send ours
    let init_encrypted_pk = recv_expect_key_exchange(stream).await?;
    let peer_noise_pk = decrypt_public_key(&shared_key, &init_encrypted_pk)?;

    let encrypted_pk = encrypt_public_key(&shared_key, own_noise_public_key)?;
    protocol::send_message(
        stream,
        &SyncMessage::PairKeyExchange {
            encrypted_public_key: encrypted_pk,
        },
    )
    .await?;

    // 8. Complete
    let complete = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out waiting for PairComplete".to_string())?
        .map_err(|e| format!("recv complete: {}", e))?;
    if !matches!(complete, SyncMessage::PairComplete) {
        return Err("Expected PairComplete".into());
    }

    protocol::send_message(stream, &SyncMessage::PairComplete).await?;

    Ok(PairResult {
        device_id: peer_device_id.to_string(),
        device_name: peer_device_name.to_string(),
        fingerprint: DeviceIdentity::fingerprint_from_public_key(&peer_noise_pk),
        noise_public_key: peer_noise_pk,
    })
}

// ── Message receive helpers ────────────────────────────────────────────────

async fn recv_expect_spake(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let msg = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out during SPAKE exchange".to_string())?
        .map_err(|e| format!("recv SpakeMsg: {}", e))?;
    match msg {
        SyncMessage::SpakeMsg { msg } => Ok(msg),
        _ => Err("Expected SpakeMsg".into()),
    }
}

async fn recv_expect_confirm(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let msg = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out during confirmation".to_string())?
        .map_err(|e| format!("recv PairConfirm: {}", e))?;
    match msg {
        SyncMessage::PairConfirm { hmac } => Ok(hmac),
        _ => Err("Expected PairConfirm".into()),
    }
}

async fn recv_expect_key_exchange(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let msg = timeout(PAIRING_TIMEOUT, protocol::recv_message(stream))
        .await
        .map_err(|_| "Timed out during key exchange".to_string())?
        .map_err(|e| format!("recv PairKeyExchange: {}", e))?;
    match msg {
        SyncMessage::PairKeyExchange {
            encrypted_public_key,
        } => Ok(encrypted_public_key),
        _ => Err("Expected PairKeyExchange".into()),
    }
}

// ── Crypto helpers ─────────────────────────────────────────────────────────

fn compute_hmac(shared_key: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(shared_key)
        .map_err(|e| format!("HMAC init: {}", e))?;
    mac.update(CONFIRM_LABEL);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn encrypt_public_key(shared_key: &[u8], pubkey: &[u8]) -> Result<Vec<u8>, String> {
    if shared_key.len() < 32 {
        return Err("shared key too short".into());
    }
    let key = chacha20poly1305::Key::from_slice(&shared_key[..32]);
    let cipher = XChaCha20Poly1305::new(key);
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, pubkey)
        .map_err(|e| format!("encrypt: {}", e))?;
    // Prepend 24-byte nonce to ciphertext
    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn decrypt_public_key(shared_key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 24 {
        return Err("encrypted data too short".into());
    }
    if shared_key.len() < 32 {
        return Err("shared key too short".into());
    }
    let key = chacha20poly1305::Key::from_slice(&shared_key[..32]);
    let cipher = XChaCha20Poly1305::new(key);
    let nonce = XNonce::from_slice(&data[..24]);
    cipher
        .decrypt(nonce, &data[24..])
        .map_err(|e| format!("decrypt failed (wrong code?): {}", e))
}
