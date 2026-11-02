pub mod discovery;
pub mod keys;
pub mod loro_doc;
pub mod noise;
pub mod pairing;
pub mod protocol;
pub mod sync_doc;
pub mod sync_engine;

use discovery::{DiscoveryService, PeerInfo};
use keys::{DeviceIdentity, PairedDevice};
use sync_doc::SyncDoc;
use protocol::SyncMessage;
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::Mutex;
use std::time::{Duration, Instant};
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
    // Phase C+D: CRDT sync doc (bookmarks, history, settings, tabs)
    pub sync_doc: tokio::sync::Mutex<Option<SyncDoc>>,
    pub sync_debounce: Mutex<Option<tokio::sync::mpsc::Sender<()>>>,
    // selective sync flags
    pub sync_bookmarks: AtomicBool,
    pub sync_history: AtomicBool,
    pub sync_settings: AtomicBool,
    pub sync_tabs: AtomicBool,
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
            sync_doc: tokio::sync::Mutex::new(None),
            sync_debounce: Mutex::new(None),
            sync_bookmarks: AtomicBool::new(true),
            sync_history: AtomicBool::new(true),
            sync_settings: AtomicBool::new(true),
            sync_tabs: AtomicBool::new(true),
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
            sync_doc: tokio::sync::Mutex::new(None),
            sync_debounce: Mutex::new(None),
            sync_bookmarks: AtomicBool::new(true),
            sync_history: AtomicBool::new(true),
            sync_settings: AtomicBool::new(true),
            sync_tabs: AtomicBool::new(true),
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
                    SyncMessage::SyncRequest { device_id: peer_did } => {
                        handle_incoming_sync(
                            app_clone, stream, &peer_did, &data_dir,
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
            .lock();
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
            .lock();
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
            .lock();
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
            .lock();
        *active = true;
    }

    // Create oneshot channel for receiving code from UI
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut sender = state
            .pairing_code_sender
            .lock();
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
                    .lock();
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
            .lock();
        *active = false;
    }
    {
        let mut sender = state
            .pairing_code_sender
            .lock();
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
            .lock();
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

// ── Phase C: Sync Handlers ──────────────────────────────────────────────────

/// Handle an incoming sync request from a paired peer.
async fn handle_incoming_sync(
    app: tauri::AppHandle,
    mut stream: tokio::net::TcpStream,
    peer_device_id: &str,
    _app_data_dir: &std::path::Path,
) {
    let state = app.state::<SyncState>();

    // verify peer is paired
    let peer = {
        let devices = state
            .paired_devices
            .lock();
        devices.iter().find(|d| d.device_id == peer_device_id).cloned()
    };
    let peer = match peer {
        Some(p) => p,
        None => {
            let _ = protocol::send_message(
                &mut stream,
                &SyncMessage::Close {
                    reason: "not paired".into(),
                },
            )
            .await;
            return;
        }
    };

    // accept
    if protocol::send_message(&mut stream, &SyncMessage::SyncAccept)
        .await
        .is_err()
    {
        return;
    }

    // noise handshake (responder)
    let private_key = state.noise_private_key.clone();
    let mut ns = match noise::NoiseStream::handshake_responder(stream, &private_key).await {
        Ok(ns) => ns,
        Err(e) => {
            eprintln!("[sync] noise handshake failed: {}", e);
            return;
        }
    };

    // verify remote key
    let remote_key = match ns.remote_static_key() {
        Some(k) => k,
        None => return,
    };
    if remote_key != peer.noise_public_key {
        eprintln!("[sync] remote key mismatch");
        return;
    }

    // receive first encrypted message — could be Hello (sync) or SendTab (tab push)
    let first_msg = match protocol::recv_encrypted(&mut ns).await {
        Ok(msg) => msg,
        Err(_) => return,
    };

    // handle SendTab — lightweight push, no full sync needed
    if let SyncMessage::SendTab { sender_device_id, sender_device_name, url, title } = first_msg {
        // validate url
        if sync_doc::is_safe_url_pub(&url) {
            let safe_title = title.replace('<', "&lt;").replace('>', "&gt;");
            let _ = app.emit_to("main", "tab-received", serde_json::json!({
                "from_device": sender_device_name,
                "from_device_id": sender_device_id,
                "url": url,
                "title": safe_title,
            }));
            emit_log(&app, "receive", &format!("received tab: {}", &url), Some(&sender_device_id));
        }
        let _ = protocol::send_encrypted(&mut ns, &SyncMessage::SendTabAck).await;
        return;
    }

    let remote_vv = match first_msg {
        SyncMessage::Hello { vv, .. } => vv,
        _ => return,
    };

    // grab sync doc, run sync responder
    eprintln!("[sync] handle_incoming_sync: starting responder for peer {}", peer_device_id);
    let _ = app.emit_to("main", "sync-activity", "syncing");
    emit_log(&app, "sync", "syncing with peer", Some(peer_device_id));
    let changes = {
        let mut doc_guard = state.sync_doc.lock().await;
        let doc = match doc_guard.as_mut() {
            Some(d) => {
                eprintln!("[sync] sync_doc is Some, proceeding");
                d
            }
            None => {
                eprintln!("[sync] sync_doc is None! Cannot sync.");
                return;
            }
        };
        sync_engine::handle_sync_responder(&mut ns, remote_vv, doc).await
    };

    eprintln!("[sync] handle_incoming_sync: result = {:?}", changes.as_ref().map(|r| format!("{:?}", r)).unwrap_or_else(|e| format!("Err({})", e)));
    match changes {
        Ok(sync_engine::SyncResult::ChangesReceived | sync_engine::SyncResult::BothSynced) => {
            eprintln!("[sync] emitting sync-*-changed to frontend");
            let _ = app.emit_to("main", "sync-bookmarks-changed", ());
            let _ = app.emit_to("main", "sync-history-changed", ());
            let _ = app.emit_to("main", "sync-settings-changed", ());
            let _ = app.emit_to("main", "sync-tabs-changed", ());
            let _ = app.emit_to("main", "sync-activity", "success");
            emit_log(&app, "receive", "received changes from peer", Some(peer_device_id));
        }
        Ok(ref r) => {
            eprintln!("[sync] no incoming changes, result: {:?}", r);
            let _ = app.emit_to("main", "sync-activity", "success");
        }
        Err(e) => {
            eprintln!("[sync] responder error: {}", e);
            let _ = app.emit_to("main", "sync-activity", "error");
            emit_log(&app, "error", &format!("sync error: {}", e), Some(peer_device_id));
        }
    }
}

/// Sync with all paired+discovered peers.
pub fn trigger_sync(app: tauri::AppHandle) {
    let state = app.state::<SyncState>();
    if !state.enabled {
        return;
    }

    // collect paired devices + their discovered addresses
    let pairs: Vec<(PairedDevice, SocketAddr)> = {
        let devices = state
            .paired_devices
            .lock();
        let disc = state
            .discovery
            .lock();
        let peers = disc.as_ref().map(|d| d.get_peers()).unwrap_or_default();

        devices
            .iter()
            .filter_map(|d| {
                let peer = peers.iter().find(|p| p.device_id == d.device_id)?;
                let addr_str = peer.addresses.first()?;
                let addr: SocketAddr = format!("{}:{}", addr_str, peer.port).parse().ok()?;
                Some((d.clone(), addr))
            })
            .collect()
    };

    if pairs.is_empty() {
        return;
    }

    let private_key = state.noise_private_key.clone();
    let device_id = state.device_id.clone();

    let _ = app.emit_to("main", "sync-activity", "syncing");

    for (peer, addr) in pairs {
        let app2 = app.clone();
        let pk = private_key.clone();
        let did = device_id.clone();

        tauri::async_runtime::spawn(async move {
            let state = app2.state::<SyncState>();
            // grab doc, sync, release
            let result = {
                let mut doc_guard = state.sync_doc.lock().await;
                let doc = match doc_guard.as_mut() {
                    Some(d) => d,
                    None => return,
                };
                sync_engine::sync_with_peer(&peer, addr, &pk, &did, doc).await
            };

            match result {
                Ok(
                    sync_engine::SyncResult::ChangesReceived
                    | sync_engine::SyncResult::BothSynced,
                ) => {
                    let _ = app2.emit_to("main", "sync-bookmarks-changed", ());
                    let _ = app2.emit_to("main", "sync-history-changed", ());
                    let _ = app2.emit_to("main", "sync-settings-changed", ());
                    let _ = app2.emit_to("main", "sync-tabs-changed", ());
                    let _ = app2.emit_to("main", "sync-activity", "success");
                }
                Ok(_) => {
                    let _ = app2.emit_to("main", "sync-activity", "success");
                }
                Err(_) => {} // peer offline or busy — silent, retry next trigger
            }
        });
    }
}

/// Start the debounce loop: bookmark changes within 1s are batched into one sync.
/// Also starts a periodic 5-min sync as a safety net for missed changes.
pub fn start_sync_debounce(app: tauri::AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(16);

    {
        let state = app.state::<SyncState>();
        let mut sender = state
            .sync_debounce
            .lock();
        *sender = Some(tx);
    }

    // debounce loop — batches local changes into one sync
    let app_debounce = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if rx.recv().await.is_none() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            while rx.try_recv().is_ok() {}
            trigger_sync(app_debounce.clone());
        }
    });

    // periodic sync — 5 min interval, catches missed changes from offline peers
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            trigger_sync(app.clone());
        }
    });
}

/// Called after a local bookmark mutation — signals the debounce channel.
pub fn notify_sync_change(state: &SyncState) {
    let sender = state
        .sync_debounce
        .lock();
    if let Some(ref tx) = *sender {
        let _ = tx.try_send(());
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
        .clone();
    let peers = {
        let discovery = state
            .discovery
            .lock();
        match discovery.as_ref() {
            Some(d) => d.get_peers(),
            None => Vec::new(),
        }
    };
    let paired = state
        .paired_devices
        .lock()
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
            .lock();
        *discovery = Some(disc);
    }
    {
        let mut status = state.status.lock();
        *status = SyncStatus::Discovering;
    }
    {
        let mut paired = state
            .paired_devices
            .lock();
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
            .lock();
        discovery.take()
    };
    if let Some(d) = disc {
        let _ = d.shutdown();
    }

    // Stop TCP listener
    {
        let mut lh = state
            .listener_handle
            .lock();
        if let Some(handle) = lh.take() {
            handle.abort();
        }
    }

    {
        let mut status = state.status.lock();
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
        .lock();
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
            .lock();
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
            .lock();
        if *active {
            return Err("Already pairing with another device".into());
        }
    }

    // Find peer address from discovery
    let peer_addr = {
        let discovery = state
            .discovery
            .lock();
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
            .lock();
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
            .lock();
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
            .lock();
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
            .lock();
        if let Some(ref d) = *disc {
            let mut peers = d.peers.lock();
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

// ── Phase C: Sync Commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn force_sync(app: tauri::AppHandle, state: tauri::State<'_, SyncState>) -> Result<(), String> {
    if !state.enabled {
        return Err("Sync is not enabled".into());
    }
    trigger_sync(app);
    Ok(())
}

// ── Phase C.2: Surgical Bookmark Commands ──────────────────────────────────

#[tauri::command]
pub async fn sync_add_bookmark(
    app: tauri::AppHandle, id: String, url: String, title: String,
    favicon: Option<String>, folder_id: String, created_at: f64,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.add_bookmark(&id, &url, &title, favicon.as_deref(), &folder_id, created_at)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_remove_bookmark(
    app: tauri::AppHandle, id: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.remove_bookmark(&id)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_add_folder(
    app: tauri::AppHandle, id: String, name: String, parent_id: String, order: f64,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.add_folder(&id, &name, &parent_id, order)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_remove_folder(
    app: tauri::AppHandle, id: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.delete_folder_cascade(&id)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_rename_folder(
    app: tauri::AppHandle, id: String, name: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.rename_folder(&id, &name)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_move_bookmark(
    app: tauri::AppHandle, id: String, folder_id: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.move_bookmark(&id, &folder_id)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

/// Full loopback test: pair a ghost device, then sync sample bookmarks into our LoroDoc.
/// Returns the pairing code for the user to enter in the UI. After the code is entered,
/// the ghost pairs, then immediately syncs 3 sample bookmarks into the real device.
#[tauri::command]
pub async fn simulate_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
) -> Result<serde_json::Value, String> {
    if !state.enabled {
        return Err("Sync is not enabled".into());
    }

    // check we have a LoroDoc
    {
        let doc = state.sync_doc.lock().await;
        if doc.is_none() {
            return Err("LoroDoc not initialized".into());
        }
    }

    // generate ghost identity
    let builder = snow::Builder::new(
        "Noise_XX_25519_ChaChaPoly_BLAKE2s"
            .parse()
            .map_err(|e| format!("noise params: {}", e))?,
    );
    let ghost_kp = builder
        .generate_keypair()
        .map_err(|e| format!("keygen: {}", e))?;

    let mut id_bytes = [0u8; 16];
    rand::Rng::fill(&mut rand::thread_rng(), &mut id_bytes);
    let ghost_device_id: String = id_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let ghost_name = "Ghost Sync".to_string();
    let ghost_fingerprint =
        keys::DeviceIdentity::fingerprint_from_public_key(&ghost_kp.public);

    let code = pairing::generate_code();

    // inject ghost into discovery
    {
        let disc = state
            .discovery
            .lock();
        if let Some(ref d) = *disc {
            let mut peers = d.peers.lock();
            peers.insert(
                ghost_device_id.clone(),
                PeerInfo {
                    device_id: ghost_device_id.clone(),
                    name: ghost_name.clone(),
                    fingerprint: ghost_fingerprint.clone(),
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
            "device_id": &ghost_device_id,
            "name": &ghost_name,
            "fingerprint": &ghost_fingerprint,
            "addresses": ["127.0.0.1"],
            "port": 22000
        }),
    );

    // spawn ghost: pair first, then sync
    let code_clone = code.clone();
    let ghost_did = ghost_device_id.clone();
    let ghost_nm = ghost_name.clone();
    let ghost_pk = ghost_kp.public.to_vec();
    let ghost_private = ghost_kp.private.clone();
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // ── Step 1: Pair ──
        let mut stream = match tokio::net::TcpStream::connect("127.0.0.1:22000").await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[simulate_sync] connect for pair failed: {}", e);
                return;
            }
        };

        let pair_result = match pairing::run_initiator(
            &mut stream,
            &code_clone,
            &ghost_did,
            &ghost_nm,
            &ghost_pk,
        )
        .await
        {
            Ok(r) => {
                eprintln!("[simulate_sync] paired with {} ({})", r.device_name, r.fingerprint);
                r
            }
            Err(e) => {
                eprintln!("[simulate_sync] pairing failed: {}", e);
                let _ = app2.emit_to("main", "pair-error", serde_json::json!({ "message": e }));
                return;
            }
        };

        // small delay for pairing to fully register
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        // ── Step 2: Create ghost LoroDoc with sample bookmarks ──
        let ghost_doc_dir = std::env::temp_dir().join(format!("bushido_ghost_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&ghost_doc_dir);

        // random peer_id each time — if we reuse 9999, the real doc's VV already
        // covers that peer from previous runs and import() silently skips everything
        let ghost_peer_id = rand::random::<u64>() & 0x0FFF_FFFF_FFFF_FFFF; // avoid sign issues
        eprintln!("[simulate_sync] ghost peer_id: {}", ghost_peer_id);
        let mut ghost_doc = match loro_doc::BookmarkDoc::init(&ghost_doc_dir, ghost_peer_id) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[simulate_sync] ghost doc init failed: {}", e);
                return;
            }
        };

        // unique IDs each run so re-syncing after deletion works (CRDT tombstones are permanent)
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let sample_bookmarks = format!(r#"{{
            "bookmarks": [
                {{"id":"ghost-{ts}-1","url":"https://github.com/nicoverbruggen/bushido","title":"Bushido Browser — GitHub","folderId":"root","createdAt":{ts}}},
                {{"id":"ghost-{ts}-2","url":"https://www.rust-lang.org","title":"Rust Programming Language","favicon":"https://www.rust-lang.org/favicon.ico","folderId":"ghost-folder-{ts}","createdAt":{ts2}}},
                {{"id":"ghost-{ts}-3","url":"https://tauri.app","title":"Tauri — Build Desktop Apps","folderId":"ghost-folder-{ts}","createdAt":{ts3}}}
            ],
            "folders": [
                {{"id":"ghost-folder-{ts}","name":"Synced from Ghost","parentId":"root","order":99}}
            ]
        }}"#, ts=ts, ts2=ts+1, ts3=ts+2);

        eprintln!("[simulate_sync] ghost bookmarks JSON: {}", &sample_bookmarks[..sample_bookmarks.len().min(200)]);
        if let Err(e) = ghost_doc.write_full_from_json(&sample_bookmarks) {
            eprintln!("[simulate_sync] ghost write failed: {}", e);
            return;
        }
        let ghost_json = ghost_doc.read_as_json().unwrap_or_default();
        eprintln!("[simulate_sync] ghost doc after write: {}", &ghost_json[..ghost_json.len().min(300)]);
        eprintln!("[simulate_sync] ghost peer_id: {}", ghost_doc.doc.peer_id());
        eprintln!("[simulate_sync] ghost vv: {:?}", &ghost_doc.version_vector()[..ghost_doc.version_vector().len().min(20)]);
        let ghost_tree = ghost_doc.doc.get_tree("bookmarks");
        eprintln!("[simulate_sync] ghost tree nodes: {}", ghost_tree.children(None).unwrap_or_default().len());
        for nid in ghost_tree.children(None).unwrap_or_default() {
            eprintln!("[simulate_sync]   ghost node: {:?}", nid);
        }

        // ── Step 3: Connect and sync ──
        eprintln!("[simulate_sync] starting sync connection...");

        let mut stream2 = match tokio::net::TcpStream::connect("127.0.0.1:22000").await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[simulate_sync] connect for sync failed: {}", e);
                return;
            }
        };

        // send SyncRequest
        if let Err(e) = protocol::send_message(
            &mut stream2,
            &SyncMessage::SyncRequest { device_id: ghost_did.clone() },
        ).await {
            eprintln!("[simulate_sync] send SyncRequest failed: {}", e);
            return;
        }

        // wait for SyncAccept
        let resp = match protocol::recv_message(&mut stream2).await {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[simulate_sync] recv response failed: {}", e);
                return;
            }
        };
        match resp {
            SyncMessage::SyncAccept => {}
            other => {
                eprintln!("[simulate_sync] expected SyncAccept, got {:?}", other);
                return;
            }
        }

        // Noise handshake (ghost is initiator)
        let mut ns = match noise::NoiseStream::handshake_initiator(stream2, &ghost_private).await {
            Ok(ns) => ns,
            Err(e) => {
                eprintln!("[simulate_sync] noise handshake failed: {}", e);
                return;
            }
        };

        // verify remote key matches the device we paired with
        if let Some(remote_key) = ns.remote_static_key() {
            if remote_key != pair_result.noise_public_key {
                eprintln!("[simulate_sync] remote key mismatch after handshake!");
                return;
            }
        }

        // send Hello with ghost's version vector
        let ghost_vv = ghost_doc.version_vector();
        if let Err(e) = protocol::send_encrypted(
            &mut ns,
            &SyncMessage::Hello {
                device_id: ghost_did.clone(),
                vv: ghost_vv,
            },
        ).await {
            eprintln!("[simulate_sync] send Hello failed: {}", e);
            return;
        }

        // receive HelloAck
        let _peer_vv = match protocol::recv_encrypted(&mut ns).await {
            Ok(SyncMessage::HelloAck { vv }) => vv,
            Ok(other) => {
                eprintln!("[simulate_sync] expected HelloAck, got {:?}", other);
                return;
            }
            Err(e) => {
                eprintln!("[simulate_sync] recv HelloAck failed: {}", e);
                return;
            }
        };

        // send our delta to the real device
        // Send full updates (not snapshot!) for first-time sync between unrelated docs.
        // Snapshot import discards foreign tree nodes; updates import merges them correctly.
        let updates = match ghost_doc.export_all_updates() {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[simulate_sync] export_all_updates failed: {}", e);
                return;
            }
        };
        eprintln!("[simulate_sync] sending updates (delta): {} bytes", updates.len());
        let compressed = lz4_flex::compress_prepend_size(&updates);
        if let Err(e) = protocol::send_encrypted(&mut ns, &SyncMessage::SyncDelta { data: compressed }).await {
            eprintln!("[simulate_sync] send delta failed: {}", e);
            return;
        }

        // receive peer's data (ghost doesn't need it, but protocol requires it)
        match protocol::recv_encrypted(&mut ns).await {
            Ok(msg) => eprintln!("[simulate_sync] recv peer response: {:?}", std::mem::discriminant(&msg)),
            Err(e) => eprintln!("[simulate_sync] recv peer data failed: {}", e),
        }

        // exchange acks
        let _ = protocol::send_encrypted(&mut ns, &SyncMessage::SyncAck).await;
        let _ = protocol::recv_encrypted(&mut ns).await;

        eprintln!("[simulate_sync] sync complete! Ghost bookmarks should appear in the browser.");

        // remove ghost from discovery so debounce doesn't try to reach it
        {
            let state = app2.state::<SyncState>();
            let disc = state.discovery.lock();
            if let Some(ref d) = *disc {
                let mut peers = d.peers.lock();
                peers.remove(&ghost_did);
            }
        }

        // cleanup temp dir
        let _ = std::fs::remove_dir_all(&ghost_doc_dir);
    });

    Ok(serde_json::json!({
        "device_id": ghost_device_id,
        "device_name": ghost_name,
        "code": code,
        "info": "Enter the code in the pairing dialog. After pairing, ghost will auto-sync 3 sample bookmarks."
    }))
}

// ── Phase D: History / Settings / Tabs / Send Tab Commands ─────────────

#[tauri::command]
pub async fn sync_add_history(
    app: tauri::AppHandle, url: String, title: String,
    favicon: Option<String>, timestamp: i64,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled || !state.sync_history.load(Ordering::Relaxed) { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.add_history(&url, &title, favicon.as_deref(), timestamp)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_write_setting(
    app: tauri::AppHandle, key: String, value: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled || !state.sync_settings.load(Ordering::Relaxed) { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.write_setting(&key, &value)?;
        doc.save()?;
    }
    notify_sync_change(&state);
    Ok(())
}

#[tauri::command]
pub async fn sync_write_tabs(
    app: tauri::AppHandle, tabs: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled || !state.sync_tabs.load(Ordering::Relaxed) { return Ok(()); }
    {
        let mut g = state.sync_doc.lock().await;
        let doc = g.as_mut().ok_or("no doc")?;
        doc.write_tabs(&tabs)?;
        doc.save()?;
    }
    // no debounce trigger — tabs are read-only by other devices
    Ok(())
}

#[tauri::command]
pub async fn sync_get_all_tabs(
    app: tauri::AppHandle,
) -> Result<String, String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Ok("[]".into()); }
    let g = state.sync_doc.lock().await;
    let doc = g.as_ref().ok_or("no doc")?;
    doc.read_all_tabs()
}

#[tauri::command]
pub async fn sync_set_data_types(
    app: tauri::AppHandle, bookmarks: bool, history: bool, settings: bool, tabs: bool,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    state.sync_bookmarks.store(bookmarks, Ordering::Relaxed);
    state.sync_history.store(history, Ordering::Relaxed);
    state.sync_settings.store(settings, Ordering::Relaxed);
    state.sync_tabs.store(tabs, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn send_tab_to_device(
    app: tauri::AppHandle, device_id: String, url: String, title: String,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Err("Sync not enabled".into()); }

    // validate url scheme
    if !sync_doc::is_safe_url_pub(&url) {
        return Err("blocked url scheme".into());
    }

    // find peer address
    let (peer, addr) = {
        let devices = state.paired_devices.lock();
        let disc = state.discovery.lock();
        let peers = disc.as_ref().map(|d| d.get_peers()).unwrap_or_default();
        let device = devices.iter().find(|d| d.device_id == device_id)
            .ok_or("device not paired")?;
        let info = peers.iter().find(|p| p.device_id == device_id)
            .ok_or("device not discovered")?;
        let addr_str = info.addresses.first().ok_or("no address")?;
        let addr: SocketAddr = format!("{}:{}", addr_str, info.port).parse()
            .map_err(|_| "invalid address")?;
        (device.clone(), addr)
    };

    let private_key = state.noise_private_key.clone();
    let own_did = state.device_id.clone();
    let own_name = state.device_name.clone();

    // async: connect, noise handshake, send tab
    tauri::async_runtime::spawn(async move {
        let result = async {
            let timeout = tokio::time::Duration::from_secs(5);
            let mut stream = tokio::time::timeout(timeout, tokio::net::TcpStream::connect(addr))
                .await.map_err(|_| "connect timeout".to_string())?
                .map_err(|e| format!("connect: {}", e))?;

            protocol::send_message(&mut stream, &SyncMessage::SyncRequest { device_id: own_did.clone() }).await?;
            let resp = protocol::recv_message(&mut stream).await?;
            match resp {
                SyncMessage::SyncAccept => {}
                SyncMessage::Close { reason } => return Err(format!("rejected: {}", reason)),
                _ => return Err("unexpected response".into()),
            }

            let mut ns = noise::NoiseStream::handshake_initiator(stream, &private_key).await?;

            // verify remote key
            let remote_key = ns.remote_static_key().ok_or("no remote key")?;
            if remote_key != peer.noise_public_key {
                return Err("key mismatch".into());
            }

            // send SendTab instead of Hello
            protocol::send_encrypted(&mut ns, &SyncMessage::SendTab {
                sender_device_id: own_did,
                sender_device_name: own_name,
                url: url.clone(),
                title: title.clone(),
            }).await?;

            // wait for ack
            let _ = protocol::recv_encrypted(&mut ns).await;
            Ok(())
        }.await;

        if let Err(e) = result {
            eprintln!("[sync] send_tab failed: {}", e);
            emit_log(&app, "error", &format!("send tab failed: {}", e), Some(&device_id));
        } else {
            emit_log(&app, "send", &format!("sent tab: {}", &url), Some(&device_id));
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn reset_sync_data(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let state = app.state::<SyncState>();
    if !state.enabled { return Err("Sync not enabled".into()); }
    {
        let mut g = state.sync_doc.lock().await;
        if let Some(ref doc) = *g {
            doc.backup();
        }
        // reinit with fresh doc
        match SyncDoc::init(&state.app_data_dir, state.peer_id, &state.device_id) {
            Ok(doc) => *g = Some(doc),
            Err(e) => return Err(format!("reset failed: {}", e)),
        }
    }
    emit_log(&app, "sync", "sync data reset", None);
    Ok(())
}

// ── Activity log helper ──

fn emit_log(app: &tauri::AppHandle, log_type: &str, message: &str, device: Option<&str>) {
    let _ = app.emit_to("main", "sync-log", serde_json::json!({
        "type": log_type,
        "message": message,
        "device": device,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    }));
}

// ── Health check + compaction (Phase E) ──

/// 60s health check: restart dead discovery/listener
pub fn start_health_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.tick().await; // skip first
        loop {
            interval.tick().await;
            let state = app.state::<SyncState>();
            if !state.enabled { continue; }

            // check discovery alive
            let disc_alive = {
                let disc = state.discovery.lock();
                disc.is_some()
            };
            if !disc_alive {
                eprintln!("[sync] health: discovery dead, restarting");
                if let Ok(mut disc) = DiscoveryService::new() {
                    let _ = disc.register(&state.device_id, &state.device_name, &state.fingerprint);
                    let _ = disc.start_browsing(app.clone(), state.device_id.clone());
                    *state.discovery.lock() = Some(disc);
                }
            }

            // check listener alive — if handle is None, restart
            let has_handle = {
                let lh = state.listener_handle.lock();
                lh.is_some()
            };
            if !has_handle {
                eprintln!("[sync] health: listener handle missing, restarting");
                start_tcp_listener(app.clone());
            }
        }
    });
}

/// 24h compaction: prune old history, clean stale tabs
pub fn start_compaction(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(86400));
        interval.tick().await; // skip first
        loop {
            interval.tick().await;
            let state = app.state::<SyncState>();
            if !state.enabled { continue; }

            let mut g = state.sync_doc.lock().await;
            if let Some(ref mut doc) = *g {
                match doc.compact_history(90, 50000) {
                    Ok(n) if n > 0 => eprintln!("[sync] compaction: pruned {} history entries", n),
                    _ => {}
                }
                match doc.clean_stale_tabs(7) {
                    Ok(n) if n > 0 => eprintln!("[sync] compaction: cleaned {} stale tab entries", n),
                    _ => {}
                }
                let _ = doc.save();
            }
        }
    });
}
