pub mod discovery;
pub mod keys;
pub mod noise;
pub mod pairing;
pub mod protocol;

use discovery::{DiscoveryService, PeerInfo};
use keys::{DeviceIdentity, PairedDevice};
use protocol::SyncMessage;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize)]
pub enum SyncStatus {
    Disabled,
    Idle,
    Discovering,
    Error { message: String },
}

pub struct SyncState {
    pub enabled: bool,
    pub device_id: String,
    pub device_name: String,
    pub fingerprint: String,
    pub peer_id: u64,
    pub noise_private_key: Vec<u8>,
    pub noise_public_key: Vec<u8>,
    pub paired_devices: Mutex<Vec<PairedDevice>>,
    pub status: Mutex<SyncStatus>,
    pub discovery: Mutex<Option<DiscoveryService>>,
    pub app_data_dir: PathBuf,
    // Phase B: TCP listener + pairing
    pub listener_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub pairing_code_sender: Mutex<Option<tokio::sync::oneshot::Sender<String>>>,
    pub pairing_active: Mutex<bool>,
    pub failed_attempts: Mutex<HashMap<String, (u32, Instant)>>,
}

impl SyncState {
    pub fn new_disabled(app_data_dir: PathBuf) -> Self {
        SyncState {
            enabled: false,
            device_id: String::new(),
            device_name: String::new(),
            fingerprint: String::new(),
            peer_id: 0,
            noise_private_key: Vec::new(),
            noise_public_key: Vec::new(),
            paired_devices: Mutex::new(Vec::new()),
            status: Mutex::new(SyncStatus::Disabled),
            discovery: Mutex::new(None),
            app_data_dir,
            listener_handle: Mutex::new(None),
            pairing_code_sender: Mutex::new(None),
            pairing_active: Mutex::new(false),
            failed_attempts: Mutex::new(HashMap::new()),
        }
    }

    pub fn from_identity(
        identity: DeviceIdentity,
        device_name: String,
        app_data_dir: PathBuf,
    ) -> Self {
        SyncState {
            enabled: true,
            device_id: identity.device_id,
            device_name,
            fingerprint: identity.fingerprint,
            peer_id: identity.peer_id,
            noise_private_key: identity.noise_private_key,
            noise_public_key: identity.noise_public_key,
            paired_devices: Mutex::new(identity.paired_devices),
            status: Mutex::new(SyncStatus::Idle),
            discovery: Mutex::new(None),
            app_data_dir,
            listener_handle: Mutex::new(None),
            pairing_code_sender: Mutex::new(None),
            pairing_active: Mutex::new(false),
            failed_attempts: Mutex::new(HashMap::new()),
        }
    }
}

// ── TCP Listener ───────────────────────────────────────────────────────────

/// Start the TCP listener for incoming sync/pairing connections.
/// Call after `app.manage(SyncState)` so we can retrieve state from app handle.
pub fn start_tcp_listener(app: tauri::AppHandle) {
    // Extract everything we need before moving app into the spawn
    let (enabled, device_id, device_name, noise_public_key, app_data_dir) = {
        let state = app.state::<SyncState>();
        if !state.enabled {
            return;
        }
        (
            state.enabled,
            state.device_id.clone(),
            state.device_name.clone(),
            state.noise_public_key.clone(),
            state.app_data_dir.clone(),
        )
    };
    let _ = enabled; // used for the guard above

    let app_for_handle = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let app = app_for_handle;
        let listener = match tokio::net::TcpListener::bind("0.0.0.0:22000").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[sync] TCP listener bind failed: {}", e);
                return;
            }
        };

        loop {
            let (mut stream, _addr) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => continue,
            };

            let app_clone = app.clone();
            let did = device_id.clone();
            let dname = device_name.clone();
            let npk = noise_public_key.clone();
            let data_dir = app_data_dir.clone();

            tauri::async_runtime::spawn(async move {
                // Read first message to determine intent (10s timeout)
                let first_msg = match tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    protocol::recv_message(&mut stream),
                )
                .await
                {
                    Ok(Ok(msg)) => msg,
                    _ => return,
                };

                match first_msg {
                    SyncMessage::PairRequest {
                        device_id: peer_id,
                        device_name: peer_name,
                    } => {
                        handle_incoming_pair(
                            app_clone,
                            &mut stream,
                            &did,
                            &dname,
                            &npk,
                            &data_dir,
                            &peer_id,
                            &peer_name,
                        )
                        .await;
                    }
                    SyncMessage::Ping => {
                        let _ =
                            protocol::send_message(&mut stream, &SyncMessage::Pong).await;
                    }
                    _ => {
                        let _ = protocol::send_message(
                            &mut stream,
                            &SyncMessage::Close {
                                reason: "unexpected message".into(),
                            },
                        )
                        .await;
                    }
                }
            });
        }
    });

    {
        let state = app.state::<SyncState>();
        let mut lh = state
            .listener_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *lh = Some(handle);
    }
}

/// Handle an incoming pairing request from a peer.
async fn handle_incoming_pair(
    app: tauri::AppHandle,
    stream: &mut tokio::net::TcpStream,
    own_device_id: &str,
    own_device_name: &str,
    own_noise_public_key: &[u8],
    app_data_dir: &std::path::Path,
    peer_device_id: &str,
    peer_device_name: &str,
) {
    let state = app.state::<SyncState>();

    // Rate limit: max 3 failures per device per 5 minutes
    // Check and drop guard BEFORE any .await
    let rate_limited = {
        let mut attempts = state
            .failed_attempts
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some((count, since)) = attempts.get(peer_device_id) {
            if *count >= 3 && since.elapsed() < std::time::Duration::from_secs(300) {
                true
            } else {
                if since.elapsed() >= std::time::Duration::from_secs(300) {
                    attempts.remove(peer_device_id);
                }
                false
            }
        } else {
            false
        }
    };
    if rate_limited {
        let _ = protocol::send_message(
            stream,
            &SyncMessage::PairReject {
                reason: "Too many failed attempts. Try again later.".into(),
            },
        )
        .await;
        return;
    }

    // Check not already pairing — drop guard BEFORE any .await
    let already_active = {
        let active = state
            .pairing_active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *active
    };
    if already_active {
        let _ = protocol::send_message(
            stream,
            &SyncMessage::PairReject {
                reason: "Already pairing with another device".into(),
            },
        )
        .await;
        return;
    }

    // Set pairing active
    {
        let mut active = state
            .pairing_active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *active = true;
    }

    // Create oneshot channel for receiving code from UI
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut sender = state
            .pairing_code_sender
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *sender = Some(tx);
    }

    // Emit event to React
    let _ = app.emit_to(
        "main",
        "pair-request-received",
        serde_json::json!({
            "device_id": peer_device_id,
            "device_name": peer_device_name,
        }),
    );

    // Wait for user to enter code (60s timeout)
    let code = match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(code)) => code,
        _ => {
            let _ = protocol::send_message(
                stream,
                &SyncMessage::PairReject {
                    reason: "Timed out".into(),
                },
            )
            .await;
            cleanup_pairing(&state);
            let _ = app.emit_to(
                "main",
                "pair-error",
                serde_json::json!({ "message": "Pairing timed out" }),
            );
            return;
        }
    };

    let _ = app.emit_to(
        "main",
        "pair-progress",
        serde_json::json!({ "step": "Verifying code..." }),
    );

    // Run responder pairing
    match pairing::run_responder(
        stream,
        &code,
        own_device_id,
        own_device_name,
        own_noise_public_key,
        peer_device_id,
        peer_device_name,
    )
    .await
    {
        Ok(result) => {
            store_paired_device(&state, &result, app_data_dir);
            let _ = app.emit_to(
                "main",
                "pair-complete",
                serde_json::json!({
                    "device_id": result.device_id,
                    "device_name": result.device_name,
                }),
            );
        }
        Err(e) => {
            // Track failed attempt
            {
                let mut attempts = state
                    .failed_attempts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                let entry = attempts
                    .entry(peer_device_id.to_string())
                    .or_insert((0, Instant::now()));
                entry.0 += 1;
                entry.1 = Instant::now();
            }
            let _ = app.emit_to(
                "main",
                "pair-error",
                serde_json::json!({ "message": e }),
            );
        }
    }

    cleanup_pairing(&state);
}

fn cleanup_pairing(state: &SyncState) {
    {
        let mut active = state
            .pairing_active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *active = false;
    }
    {
        let mut sender = state
            .pairing_code_sender
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *sender = None;
    }
}

fn store_paired_device(
    state: &SyncState,
    result: &pairing::PairResult,
    app_data_dir: &std::path::Path,
) {
    let paired = PairedDevice {
        device_id: result.device_id.clone(),
        name: result.device_name.clone(),
        noise_public_key: result.noise_public_key.clone(),
        fingerprint: result.fingerprint.clone(),
        paired_at: chrono::Utc::now().timestamp(),
    };

    let devices = {
        let mut devices = state
            .paired_devices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Replace if already exists
        devices.retain(|d| d.device_id != result.device_id);
        devices.push(paired);
        devices.clone()
    };

    // Save to disk
    if let Ok(Some(mut identity)) = keys::load_identity(app_data_dir) {
        identity.paired_devices = devices;
        let _ = keys::save_identity(app_data_dir, &identity);
    }
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SyncInfo {
    pub enabled: bool,
    pub device_id: String,
    pub device_name: String,
    pub fingerprint: String,
    pub status: SyncStatus,
    pub peers: Vec<PeerInfo>,
    pub paired_devices: Vec<PairedDeviceInfo>,
}

#[derive(Clone, Serialize)]
pub struct PairedDeviceInfo {
    pub device_id: String,
    pub name: String,
    pub fingerprint: String,
    pub paired_at: i64,
}

impl From<&PairedDevice> for PairedDeviceInfo {
    fn from(pd: &PairedDevice) -> Self {
        PairedDeviceInfo {
            device_id: pd.device_id.clone(),
            name: pd.name.clone(),
            fingerprint: pd.fingerprint.clone(),
            paired_at: pd.paired_at,
        }
    }
}

#[tauri::command]
pub async fn get_sync_status(state: tauri::State<'_, SyncState>) -> Result<SyncInfo, String> {
    let status = state
        .status
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let peers = {
        let discovery = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match discovery.as_ref() {
            Some(d) => d.get_peers(),
            None => Vec::new(),
        }
    };
    let paired = state
        .paired_devices
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(PairedDeviceInfo::from)
        .collect();

    Ok(SyncInfo {
        enabled: state.enabled,
        device_id: state.device_id.clone(),
        device_name: state.device_name.clone(),
        fingerprint: state.fingerprint.clone(),
        status,
        peers,
        paired_devices: paired,
    })
}

#[tauri::command]
pub async fn enable_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    device_name: String,
) -> Result<SyncInfo, String> {
    if state.enabled {
        return get_sync_status(state).await;
    }

    let identity = match keys::load_identity(&state.app_data_dir)? {
        Some(id) => id,
        None => keys::generate_identity(&state.app_data_dir)?,
    };

    // Start discovery
    let mut disc = DiscoveryService::new()?;
    disc.register(&identity.device_id, &device_name, &identity.fingerprint)?;
    disc.start_browsing(app.clone(), identity.device_id.clone())?;

    {
        let mut discovery = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *discovery = Some(disc);
    }
    {
        let mut status = state.status.lock().unwrap_or_else(|e| e.into_inner());
        *status = SyncStatus::Discovering;
    }
    {
        let mut paired = state
            .paired_devices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *paired = identity.paired_devices;
    }

    // Start TCP listener
    start_tcp_listener(app.clone());

    let info = SyncInfo {
        enabled: true,
        device_id: identity.device_id,
        device_name: device_name.clone(),
        fingerprint: identity.fingerprint,
        status: SyncStatus::Discovering,
        peers: Vec::new(),
        paired_devices: Vec::new(),
    };
    Ok(info)
}

#[tauri::command]
pub async fn disable_sync(state: tauri::State<'_, SyncState>) -> Result<(), String> {
    // Stop discovery
    let disc = {
        let mut discovery = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        discovery.take()
    };
    if let Some(d) = disc {
        let _ = d.shutdown();
    }

    // Stop TCP listener
    {
        let mut lh = state
            .listener_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = lh.take() {
            handle.abort();
        }
    }

    {
        let mut status = state.status.lock().unwrap_or_else(|e| e.into_inner());
        *status = SyncStatus::Disabled;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_discovered_peers(
    state: tauri::State<'_, SyncState>,
) -> Result<Vec<PeerInfo>, String> {
    let discovery = state
        .discovery
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    match discovery.as_ref() {
        Some(d) => Ok(d.get_peers()),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn set_device_name(
    state: tauri::State<'_, SyncState>,
    name: String,
) -> Result<(), String> {
    if let Some(identity) = keys::load_identity(&state.app_data_dir)? {
        let mut discovery = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut d) = *discovery {
            let _ = d.unregister();
            d.register(&identity.device_id, &name, &identity.fingerprint)?;
        }
    }
    Ok(())
}

// ── Phase B: Pairing Commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_pairing(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    peer_id: String,
) -> Result<String, String> {
    if !state.enabled {
        return Err("Sync is not enabled".into());
    }

    // Check not already pairing
    {
        let active = state
            .pairing_active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if *active {
            return Err("Already pairing with another device".into());
        }
    }

    // Find peer address from discovery
    let peer_addr = {
        let discovery = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let peers = discovery
            .as_ref()
            .map(|d| d.get_peers())
            .unwrap_or_default();
        let peer = peers
            .iter()
            .find(|p| p.device_id == peer_id)
            .ok_or("Peer not found")?;
        format!(
            "{}:{}",
            peer.addresses.first().ok_or("No address")?,
            peer.port
        )
    };

    let code = pairing::generate_code();
    let code_clone = code.clone();

    let device_id = state.device_id.clone();
    let device_name = state.device_name.clone();
    let noise_public_key = state.noise_public_key.clone();
    let app_data_dir = state.app_data_dir.clone();

    // Set pairing active
    {
        let mut active = state
            .pairing_active
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *active = true;
    }

    // Spawn initiator flow
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app_clone.emit_to(
            "main",
            "pair-progress",
            serde_json::json!({ "step": "Connecting..." }),
        );

        let result = async {
            let mut stream = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::net::TcpStream::connect(&peer_addr),
            )
            .await
            .map_err(|_| "Connection timed out".to_string())?
            .map_err(|e| format!("Connection failed: {}", e))?;

            let _ = app_clone.emit_to(
                "main",
                "pair-progress",
                serde_json::json!({ "step": "Waiting for other device..." }),
            );

            pairing::run_initiator(
                &mut stream,
                &code_clone,
                &device_id,
                &device_name,
                &noise_public_key,
            )
            .await
        }
        .await;

        let state = app_clone.state::<SyncState>();

        match result {
            Ok(pair_result) => {
                store_paired_device(&state, &pair_result, &app_data_dir);
                let _ = app_clone.emit_to(
                    "main",
                    "pair-complete",
                    serde_json::json!({
                        "device_id": pair_result.device_id,
                        "device_name": pair_result.device_name,
                    }),
                );
            }
            Err(e) => {
                let _ = app_clone.emit_to(
                    "main",
                    "pair-error",
                    serde_json::json!({ "message": e }),
                );
            }
        }

        cleanup_pairing(&state);
    });

    Ok(code)
}

#[tauri::command]
pub async fn enter_pairing_code(
    state: tauri::State<'_, SyncState>,
    _peer_id: String,
    code: String,
) -> Result<(), String> {
    let sender = {
        let mut s = state
            .pairing_code_sender
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        s.take()
    };
    match sender {
        Some(tx) => tx
            .send(code)
            .map_err(|_| "Pairing session expired".to_string()),
        None => Err("No active pairing session".into()),
    }
}

#[tauri::command]
pub async fn remove_device(
    state: tauri::State<'_, SyncState>,
    device_id: String,
) -> Result<(), String> {
    let devices = {
        let mut devices = state
            .paired_devices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        devices.retain(|d| d.device_id != device_id);
        devices.clone()
    };

    // Save to disk
    if let Ok(Some(mut identity)) = keys::load_identity(&state.app_data_dir) {
        identity.paired_devices = devices;
        keys::save_identity(&state.app_data_dir, &identity)?;
    }

    Ok(())
}

// ── Debug: Loopback Pairing Simulation ──────────────────────────────────────

/// Simulate a remote device pairing with us over localhost.
/// A fake "Ghost Device" connects to our TCP listener on port 22000 and runs
/// the initiator side of the SPAKE2 pairing protocol. The UI receives a
/// pair-request-received event and the user enters the returned code to complete
/// the full real crypto handshake — all on one machine.
#[tauri::command]
pub async fn simulate_pairing(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<serde_json::Value, String> {
    if !state.enabled {
        return Err("Sync is not enabled".into());
    }

    // Generate a fake device identity
    let builder = snow::Builder::new(
        "Noise_XX_25519_ChaChaPoly_BLAKE2s"
            .parse()
            .map_err(|e| format!("noise params: {}", e))?,
    );
    let fake_kp = builder
        .generate_keypair()
        .map_err(|e| format!("keygen: {}", e))?;

    let mut id_bytes = [0u8; 16];
    rand::Rng::fill(&mut rand::thread_rng(), &mut id_bytes);
    let fake_device_id: String = id_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let fake_name = "Ghost Device".to_string();
    let fake_fingerprint =
        keys::DeviceIdentity::fingerprint_from_public_key(&fake_kp.public);

    // Generate the shared pairing code
    let code = pairing::generate_code();

    // Inject fake peer into discovery so UI can see it (optional — for visibility)
    {
        let disc = state
            .discovery
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(ref d) = *disc {
            let mut peers = d.peers.lock().unwrap_or_else(|e| e.into_inner());
            peers.insert(
                fake_device_id.clone(),
                PeerInfo {
                    device_id: fake_device_id.clone(),
                    name: fake_name.clone(),
                    fingerprint: fake_fingerprint.clone(),
                    addresses: vec!["127.0.0.1".to_string()],
                    port: 22000,
                },
            );
        }
    }
    let _ = app.emit_to(
        "main",
        "peer-discovered",
        serde_json::json!({
            "device_id": &fake_device_id,
            "name": &fake_name,
            "fingerprint": &fake_fingerprint,
            "addresses": ["127.0.0.1"],
            "port": 22000
        }),
    );

    // Spawn fake initiator — connects to our own TCP listener after a short delay
    let code_clone = code.clone();
    let fake_did = fake_device_id.clone();
    let fake_nm = fake_name.clone();
    let fake_pk = fake_kp.public.to_vec();

    tauri::async_runtime::spawn(async move {
        // Small delay so the TCP handler is ready and UI has time to render
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let mut stream = match tokio::net::TcpStream::connect("127.0.0.1:22000").await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[simulate] connect failed: {}", e);
                return;
            }
        };

        // Run the full initiator-side pairing (sends PairRequest, SPAKE2-A, etc.)
        match pairing::run_initiator(&mut stream, &code_clone, &fake_did, &fake_nm, &fake_pk)
            .await
        {
            Ok(result) => {
                eprintln!(
                    "[simulate] pairing succeeded! Paired with {} ({})",
                    result.device_name, result.fingerprint
                );
            }
            Err(e) => {
                eprintln!("[simulate] pairing failed: {}", e);
            }
        }
    });

    Ok(serde_json::json!({
        "device_id": fake_device_id,
        "device_name": fake_name,
        "code": code,
    }))
}
