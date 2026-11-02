use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
pub struct PeerInfo {
    pub device_id: String,
    pub name: String,
    pub fingerprint: String,
    pub addresses: Vec<String>,
    pub port: u16,
}

const SERVICE_TYPE: &str = "_bushido-sync._tcp.local.";
const SYNC_PORT: u16 = 22000;

pub struct DiscoveryService {
    daemon: ServiceDaemon,
    instance_name: String,
    pub peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    browse_active: Arc<Mutex<bool>>,
}

impl DiscoveryService {
    pub fn new() -> Result<Self, String> {
        let daemon = ServiceDaemon::new()
            .map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

        Ok(DiscoveryService {
            daemon,
            instance_name: String::new(),
            peers: Arc::new(Mutex::new(HashMap::new())),
            browse_active: Arc::new(Mutex::new(false)),
        })
    }

    pub fn register(
        &mut self,
        device_id: &str,
        device_name: &str,
        fingerprint: &str,
    ) -> Result<(), String> {
        let instance_name = format!("bushido-{}", &device_id[..8.min(device_id.len())]);
        self.instance_name = instance_name.clone();

        let hostname = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "bushido-device".to_string());
        let host_fqdn = format!("{}.local.", hostname);

        let properties = [
            ("v", "1"),
            ("id", device_id),
            ("fp", fingerprint),
            ("name", device_name),
        ];

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_fqdn,
            "",  // auto-detect IP
            SYNC_PORT,
            &properties[..],
        )
        .map_err(|e| format!("Failed to create ServiceInfo: {}", e))?
        .enable_addr_auto();

        self.daemon.register(service)
            .map_err(|e| format!("Failed to register mDNS service: {}", e))?;

        Ok(())
    }

    pub fn start_browsing(&self, app: AppHandle, own_device_id: String) -> Result<(), String> {
        {
            let mut active = self.browse_active.lock();
            if *active {
                return Ok(()); // already browsing
            }
            *active = true;
        }

        let receiver = self.daemon.browse(SERVICE_TYPE)
            .map_err(|e| format!("Failed to start mDNS browsing: {}", e))?;

        let peers = self.peers.clone();
        let browse_active = self.browse_active.clone();

        std::thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                // check if we should stop
                {
                    let active = browse_active.lock();
                    if !*active { break; }
                }

                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        // extract TXT properties
                        let device_id = info.get_property_val_str("id")
                            .unwrap_or_default().to_string();
                        let name = info.get_property_val_str("name")
                            .unwrap_or_default().to_string();
                        let fingerprint = info.get_property_val_str("fp")
                            .unwrap_or_default().to_string();

                        // skip our own device
                        if device_id == own_device_id || device_id.is_empty() {
                            continue;
                        }

                        // filter out virtual network adapters
                        let addresses: Vec<String> = info.get_addresses_v4()
                            .iter()
                            .map(|a| a.to_string())
                            .collect();

                        if addresses.is_empty() {
                            continue;
                        }

                        let peer = PeerInfo {
                            device_id: device_id.clone(),
                            name,
                            fingerprint,
                            addresses,
                            port: info.get_port(),
                        };

                        // store and emit
                        {
                            let mut peers_lock = peers.lock();
                            peers_lock.insert(device_id.clone(), peer.clone());
                        }

                        let _ = app.emit_to("main", "peer-discovered", &peer);

                        // auto-sync with paired peers when they appear
                        let app_sync = app.clone();
                        tauri::async_runtime::spawn(async move {
                            // small delay so peer is fully registered
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            super::trigger_sync(app_sync);
                        });
                    }
                    ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        // extract device_id from fullname and remove
                        let mut peers_lock = peers.lock();
                        let removed_id = peers_lock.iter()
                            .find(|(_, p)| fullname.contains(&p.device_id[..8.min(p.device_id.len())]))
                            .map(|(id, _)| id.clone());
                        if let Some(id) = removed_id {
                            peers_lock.remove(&id);
                            let _ = app.emit_to("main", "peer-removed", &id);
                        }
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub fn stop_browsing(&self) {
        let mut active = self.browse_active.lock();
        *active = false;
    }

    pub fn unregister(&self) -> Result<(), String> {
        if self.instance_name.is_empty() {
            return Ok(());
        }
        // build the full service name for unregistration
        let fullname = format!("{}.{}", self.instance_name, SERVICE_TYPE);
        let _ = self.daemon.unregister(&fullname);
        Ok(())
    }

    pub fn shutdown(self) -> Result<(), String> {
        self.stop_browsing();
        let _ = self.unregister();
        let _ = self.daemon.shutdown();
        Ok(())
    }

    pub fn get_peers(&self) -> Vec<PeerInfo> {
        let peers = self.peers.lock();
        peers.values().cloned().collect()
    }
}
