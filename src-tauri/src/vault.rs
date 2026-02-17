use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;
use rand::Rng;
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{SaltString, PasswordHash};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, aead::Aead};
use chacha20poly1305::aead::generic_array::GenericArray;

use crate::sync::keys::{dpapi_encrypt, dpapi_decrypt};

pub struct VaultState {
    pub db_path: PathBuf,
    // derived key from master password, None = locked
    pub derived_key: Mutex<Option<[u8; 32]>>,
}

#[derive(Serialize, Clone)]
pub struct VaultEntry {
    pub id: String,
    pub domain: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl VaultState {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path, derived_key: Mutex::new(None) }
    }

    pub fn init_db(&self) -> Result<(), String> {
        let conn = self.open_db()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS vault_entries (
                id TEXT PRIMARY KEY,
                domain TEXT NOT NULL,
                username TEXT NOT NULL,
                password_enc BLOB NOT NULL,
                nonce BLOB NOT NULL,
                notes TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_vault_domain ON vault_entries(domain);
            CREATE TABLE IF NOT EXISTS vault_meta (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            );"
        ).map_err(|e| format!("db init: {}", e))
    }

    fn open_db(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|e| format!("db open: {}", e))
    }

    // encrypt password: chacha20 then dpapi wrap
    fn encrypt_password(&self, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
        let key = self.get_key()?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill(&mut nonce_bytes);
        let nonce = GenericArray::from_slice(&nonce_bytes);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&key));
        let encrypted = cipher.encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| "encrypt failed".to_string())?;
        let wrapped = dpapi_encrypt(&encrypted)?;
        Ok((wrapped, nonce_bytes.to_vec()))
    }

    fn decrypt_password(&self, enc: &[u8], nonce: &[u8]) -> Result<String, String> {
        let key = self.get_key()?;
        let unwrapped = dpapi_decrypt(enc)?;
        let nonce_arr = GenericArray::from_slice(nonce);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&key));
        let decrypted = cipher.decrypt(nonce_arr, unwrapped.as_ref())
            .map_err(|_| "decrypt failed".to_string())?;
        String::from_utf8(decrypted).map_err(|_| "invalid utf8".to_string())
    }

    fn get_key(&self) -> Result<[u8; 32], String> {
        let guard = self.derived_key.lock().unwrap_or_else(|e| e.into_inner());
        guard.ok_or_else(|| "vault locked".to_string())
    }
}

// argon2 derive key from master password + salt
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    use argon2::Argon2;
    let mut output = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut output)
        .map_err(|e| format!("argon2: {}", e))?;
    Ok(output)
}

// sync check if master password is set (no async, no key needed)
pub fn has_master_password_sync(state: &VaultState) -> bool {
    let conn = match state.open_db() {
        Ok(c) => c,
        Err(_) => return false,
    };
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM vault_meta WHERE key = 'master_hash'",
        [],
        |row| row.get::<_, bool>(0),
    ).unwrap_or(false)
}

// sync helper for postMessage handler (no async)
pub fn get_entries_for_domain(state: &VaultState, domain: &str) -> Result<Vec<VaultEntry>, String> {
    if state.derived_key.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
        return Ok(vec![]);
    }
    let conn = state.open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, domain, username, password_enc, nonce, notes, created_at, updated_at FROM vault_entries WHERE domain = ?1 ORDER BY updated_at DESC"
    ).map_err(|e| format!("query: {}", e))?;
    let rows = stmt.query_map([domain], |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, Vec<u8>>(3)?, row.get::<_, Vec<u8>>(4)?, row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?, row.get::<_, i64>(7)?,
        ))
    }).map_err(|e| format!("query: {}", e))?;
    let mut entries = Vec::new();
    for row in rows {
        let (id, domain, username, enc, nonce, notes, created_at, updated_at) = row.map_err(|e| format!("row: {}", e))?;
        let password = state.decrypt_password(&enc, &nonce).unwrap_or_default();
        entries.push(VaultEntry { id, domain, username, password, notes, created_at, updated_at });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn vault_has_master_password(state: tauri::State<'_, VaultState>) -> Result<bool, String> {
    let conn = state.open_db()?;
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM vault_meta WHERE key = 'master_hash'",
        [],
        |row| row.get(0),
    ).unwrap_or(false);
    Ok(exists)
}

#[tauri::command]
pub async fn vault_setup(state: tauri::State<'_, VaultState>, master_password: String) -> Result<(), String> {
    if master_password.len() < 8 {
        return Err("password must be at least 8 characters".into());
    }

    let salt = SaltString::generate(&mut rand::thread_rng());
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(master_password.as_bytes(), &salt)
        .map_err(|e| format!("hash: {}", e))?;

    let conn = state.open_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('master_hash', ?1)",
        [hash.to_string().as_bytes()],
    ).map_err(|e| format!("save hash: {}", e))?;

    // store salt separately for key derivation
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('salt', ?1)",
        [salt.as_str().as_bytes()],
    ).map_err(|e| format!("save salt: {}", e))?;

    // derive and store key in memory
    let key = derive_key(&master_password, salt.as_str().as_bytes())?;
    let mut guard = state.derived_key.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(key);

    Ok(())
}

#[tauri::command]
pub async fn vault_unlock(state: tauri::State<'_, VaultState>, master_password: String) -> Result<(), String> {
    let conn = state.open_db()?;

    let hash_str: String = conn.query_row(
        "SELECT value FROM vault_meta WHERE key = 'master_hash'",
        [],
        |row| {
            let bytes: Vec<u8> = row.get(0)?;
            Ok(String::from_utf8_lossy(&bytes).to_string())
        },
    ).map_err(|_| "no master password set".to_string())?;

    let salt_str: String = conn.query_row(
        "SELECT value FROM vault_meta WHERE key = 'salt'",
        [],
        |row| {
            let bytes: Vec<u8> = row.get(0)?;
            Ok(String::from_utf8_lossy(&bytes).to_string())
        },
    ).map_err(|_| "no salt found".to_string())?;

    // verify password
    let parsed_hash = PasswordHash::new(&hash_str)
        .map_err(|e| format!("parse hash: {}", e))?;
    Argon2::default()
        .verify_password(master_password.as_bytes(), &parsed_hash)
        .map_err(|_| "wrong password".to_string())?;

    let key = derive_key(&master_password, salt_str.as_bytes())?;
    let mut guard = state.derived_key.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(key);

    Ok(())
}

#[tauri::command]
pub async fn vault_lock(state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let mut guard = state.derived_key.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref mut key) = *guard {
        // zero out before dropping
        key.iter_mut().for_each(|b| *b = 0);
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn vault_is_unlocked(state: tauri::State<'_, VaultState>) -> Result<bool, String> {
    let guard = state.derived_key.lock().unwrap_or_else(|e| e.into_inner());
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn vault_save_entry(
    state: tauri::State<'_, VaultState>,
    domain: String,
    username: String,
    password: String,
    notes: Option<String>,
) -> Result<String, String> {
    let (enc, nonce) = state.encrypt_password(&password)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let notes = notes.unwrap_or_default();

    let conn = state.open_db()?;
    conn.execute(
        "INSERT INTO vault_entries (id, domain, username, password_enc, nonce, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, domain, username, enc, nonce, notes, now, now],
    ).map_err(|e| format!("save: {}", e))?;

    Ok(id)
}

#[tauri::command]
pub async fn vault_get_entries(
    state: tauri::State<'_, VaultState>,
    domain: Option<String>,
) -> Result<Vec<VaultEntry>, String> {
    let conn = state.open_db()?;

    let mut entries = Vec::new();
    if let Some(ref d) = domain {
        let mut stmt = conn.prepare(
            "SELECT id, domain, username, password_enc, nonce, notes, created_at, updated_at FROM vault_entries WHERE domain = ?1 ORDER BY updated_at DESC"
        ).map_err(|e| format!("query: {}", e))?;

        let rows = stmt.query_map([d], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        }).map_err(|e| format!("query: {}", e))?;

        for row in rows {
            let (id, domain, username, enc, nonce, notes, created_at, updated_at) = row.map_err(|e| format!("row: {}", e))?;
            // only decrypt if vault is unlocked
            let password = state.decrypt_password(&enc, &nonce).unwrap_or_default();
            entries.push(VaultEntry { id, domain, username, password, notes, created_at, updated_at });
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, domain, username, password_enc, nonce, notes, created_at, updated_at FROM vault_entries ORDER BY domain, updated_at DESC"
        ).map_err(|e| format!("query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        }).map_err(|e| format!("query: {}", e))?;

        for row in rows {
            let (id, domain, username, enc, nonce, notes, created_at, updated_at) = row.map_err(|e| format!("row: {}", e))?;
            let password = state.decrypt_password(&enc, &nonce).unwrap_or_default();
            entries.push(VaultEntry { id, domain, username, password, notes, created_at, updated_at });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn vault_delete_entry(state: tauri::State<'_, VaultState>, id: String) -> Result<(), String> {
    let conn = state.open_db()?;
    conn.execute("DELETE FROM vault_entries WHERE id = ?1", [&id])
        .map_err(|e| format!("delete: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn vault_update_entry(
    state: tauri::State<'_, VaultState>,
    id: String,
    username: Option<String>,
    password: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    let conn = state.open_db()?;
    let now = chrono::Utc::now().timestamp();

    if let Some(ref pw) = password {
        let (enc, nonce) = state.encrypt_password(pw)?;
        conn.execute(
            "UPDATE vault_entries SET password_enc = ?1, nonce = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![enc, nonce, now, id],
        ).map_err(|e| format!("update pw: {}", e))?;
    }
    if let Some(ref u) = username {
        conn.execute(
            "UPDATE vault_entries SET username = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![u, now, id],
        ).map_err(|e| format!("update user: {}", e))?;
    }
    if let Some(ref n) = notes {
        conn.execute(
            "UPDATE vault_entries SET notes = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![n, now, id],
        ).map_err(|e| format!("update notes: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_generate_password(
    length: Option<u32>,
    uppercase: Option<bool>,
    lowercase: Option<bool>,
    digits: Option<bool>,
    symbols: Option<bool>,
) -> Result<String, String> {
    let len = length.unwrap_or(20).max(4).min(128) as usize;
    let uc = uppercase.unwrap_or(true);
    let lc = lowercase.unwrap_or(true);
    let dg = digits.unwrap_or(true);
    let sy = symbols.unwrap_or(true);

    let mut charset = String::new();
    if uc { charset.push_str("ABCDEFGHIJKLMNOPQRSTUVWXYZ"); }
    if lc { charset.push_str("abcdefghijklmnopqrstuvwxyz"); }
    if dg { charset.push_str("0123456789"); }
    if sy { charset.push_str("!@#$%^&*()-_=+[]{}|;:,.<>?"); }
    if charset.is_empty() { charset.push_str("abcdefghijklmnopqrstuvwxyz0123456789"); }

    let chars: Vec<char> = charset.chars().collect();
    let mut rng = rand::thread_rng();
    let password: String = (0..len).map(|_| chars[rng.gen_range(0..chars.len())]).collect();

    Ok(password)
}
