use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub device_id: String,
    pub name: String,
    pub noise_public_key: Vec<u8>,
    pub fingerprint: String,
    pub paired_at: i64,
}

#[derive(Serialize, Deserialize)]
struct KeyBundle {
    noise_private_key: Vec<u8>,
    noise_public_key: Vec<u8>,
    device_id: String,
    peer_id: u64,
    paired_devices: Vec<PairedDevice>,
}

pub struct DeviceIdentity {
    pub device_id: String,
    pub peer_id: u64,
    pub noise_private_key: Vec<u8>,
    pub noise_public_key: Vec<u8>,
    pub fingerprint: String,
    pub paired_devices: Vec<PairedDevice>,
}

impl DeviceIdentity {
    pub fn fingerprint_from_public_key(public_key: &[u8]) -> String {
        let hash = Sha256::digest(public_key);
        hex_encode(&hash[..8])
    }
}

fn sync_dir(app_data: &Path) -> PathBuf {
    app_data.join("sync")
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn generate_identity(app_data: &Path) -> Result<DeviceIdentity, String> {
    let dir = sync_dir(app_data);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sync dir: {}", e))?;

    let mut rng = rand::thread_rng();

    // Generate device_id: 16 random bytes → 32 hex chars
    let mut id_bytes = [0u8; 16];
    rng.fill(&mut id_bytes);
    let device_id = hex_encode(&id_bytes);

    // Generate peer_id for Loro
    let peer_id: u64 = rng.gen();

    // Generate Noise keypair
    let builder = snow::Builder::new("Noise_XX_25519_ChaChaPoly_BLAKE2s".parse().unwrap());
    let keypair = builder.generate_keypair().map_err(|e| format!("Keypair generation failed: {}", e))?;

    let fingerprint = DeviceIdentity::fingerprint_from_public_key(&keypair.public);

    let identity = DeviceIdentity {
        device_id,
        peer_id,
        noise_private_key: keypair.private.to_vec(),
        noise_public_key: keypair.public.to_vec(),
        fingerprint,
        paired_devices: Vec::new(),
    };

    save_identity(app_data, &identity)?;
    Ok(identity)
}

pub fn save_identity(app_data: &Path, identity: &DeviceIdentity) -> Result<(), String> {
    let dir = sync_dir(app_data);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sync dir: {}", e))?;

    // Write plaintext device_id and peer_id
    fs::write(dir.join("device_id"), &identity.device_id)
        .map_err(|e| format!("Failed to write device_id: {}", e))?;
    fs::write(dir.join("peer_id"), identity.peer_id.to_string())
        .map_err(|e| format!("Failed to write peer_id: {}", e))?;

    // Bundle secrets for DPAPI encryption
    let bundle = KeyBundle {
        noise_private_key: identity.noise_private_key.clone(),
        noise_public_key: identity.noise_public_key.clone(),
        device_id: identity.device_id.clone(),
        peer_id: identity.peer_id,
        paired_devices: identity.paired_devices.clone(),
    };

    let plaintext = rmp_serde::to_vec(&bundle)
        .map_err(|e| format!("Failed to serialize key bundle: {}", e))?;

    let encrypted = dpapi_encrypt(&plaintext)?;
    fs::write(dir.join("keys.dat"), encrypted)
        .map_err(|e| format!("Failed to write keys.dat: {}", e))?;

    Ok(())
}

pub fn load_identity(app_data: &Path) -> Result<Option<DeviceIdentity>, String> {
    let dir = sync_dir(app_data);
    let keys_path = dir.join("keys.dat");

    if !keys_path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&keys_path)
        .map_err(|e| format!("Failed to read keys.dat: {}", e))?;

    let plaintext = dpapi_decrypt(&encrypted)?;

    let bundle: KeyBundle = rmp_serde::from_slice(&plaintext)
        .map_err(|e| format!("Failed to deserialize key bundle: {}", e))?;

    let fingerprint = DeviceIdentity::fingerprint_from_public_key(&bundle.noise_public_key);

    Ok(Some(DeviceIdentity {
        device_id: bundle.device_id,
        peer_id: bundle.peer_id,
        noise_private_key: bundle.noise_private_key,
        noise_public_key: bundle.noise_public_key,
        fingerprint,
        paired_devices: bundle.paired_devices,
    }))
}

// --- DPAPI wrappers ---

#[cfg(windows)]
pub(crate) fn dpapi_encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB,
    };

    extern "system" {
        fn LocalFree(hmem: *mut u8) -> *mut u8;
    }

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        let result = CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output,
        );

        if result == 0 {
            return Err("DPAPI CryptProtectData failed".into());
        }

        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData);

        Ok(encrypted)
    }
}

#[cfg(windows)]
pub(crate) fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    extern "system" {
        fn LocalFree(hmem: *mut u8) -> *mut u8;
    }

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        let result = CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output,
        );

        if result == 0 {
            return Err("DPAPI CryptUnprotectData failed".into());
        }

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData);

        Ok(decrypted)
    }
}

#[cfg(not(windows))]
pub(crate) fn dpapi_encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plaintext.to_vec())
}

#[cfg(not(windows))]
pub(crate) fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    Ok(encrypted.to_vec())
}
