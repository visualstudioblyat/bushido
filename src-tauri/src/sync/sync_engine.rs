use super::keys::PairedDevice;
use super::sync_doc::SyncDoc;
use super::noise::NoiseStream;
use super::protocol::{self, SyncMessage};
use std::net::SocketAddr;
use tokio::net::TcpStream;

#[derive(Debug)]
pub enum SyncResult {
    ChangesReceived,
    ChangesSent,
    BothSynced,
    AlreadyUpToDate,
}

/// Initiator side: connect to peer, handshake, exchange deltas.
pub async fn sync_with_peer(
    peer: &PairedDevice,
    addr: SocketAddr,
    private_key: &[u8],
    device_id: &str,
    sync_doc: &mut SyncDoc,
) -> Result<SyncResult, String> {
    // tcp connect
    let timeout = tokio::time::Duration::from_secs(5);
    let stream = tokio::time::timeout(timeout, TcpStream::connect(addr))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| format!("connect: {}", e))?;

    // send sync intent (unencrypted)
    let mut stream = stream;
    protocol::send_message(
        &mut stream,
        &SyncMessage::SyncRequest {
            device_id: device_id.to_string(),
        },
    )
    .await?;

    // wait for accept
    let resp = protocol::recv_message(&mut stream).await?;
    match resp {
        SyncMessage::SyncAccept => {}
        SyncMessage::Close { reason } => return Err(format!("peer rejected: {}", reason)),
        _ => return Err("unexpected response to SyncRequest".into()),
    }

    // noise handshake (initiator)
    let mut ns = NoiseStream::handshake_initiator(stream, private_key).await?;

    // verify remote key matches paired device
    let remote_key = ns.remote_static_key().ok_or("no remote static key")?;
    if remote_key != peer.noise_public_key {
        return Err("remote key mismatch".into());
    }

    // send Hello with our version vector
    let local_vv = sync_doc.version_vector();
    protocol::send_encrypted(
        &mut ns,
        &SyncMessage::Hello {
            device_id: device_id.to_string(),
            vv: local_vv,
        },
    )
    .await?;

    // receive HelloAck with peer's version vector
    let ack = protocol::recv_encrypted(&mut ns).await?;
    let peer_vv = match ack {
        SyncMessage::HelloAck { vv } => vv,
        _ => return Err("expected HelloAck".into()),
    };

    // send our changes to peer
    let sent = send_delta_or_snapshot(sync_doc, &peer_vv, &mut ns).await?;

    // receive peer's changes
    let received = recv_and_import(sync_doc, &mut ns).await?;

    // exchange acks
    protocol::send_encrypted(&mut ns, &SyncMessage::SyncAck).await?;
    let _ = protocol::recv_encrypted(&mut ns).await?; // peer's ack

    if received && sent {
        Ok(SyncResult::BothSynced)
    } else if received {
        Ok(SyncResult::ChangesReceived)
    } else if sent {
        Ok(SyncResult::ChangesSent)
    } else {
        Ok(SyncResult::AlreadyUpToDate)
    }
}

/// Responder side: called after receiving Hello on an already-established NoiseStream.
pub async fn handle_sync_responder(
    ns: &mut NoiseStream,
    remote_vv: Vec<u8>,
    sync_doc: &mut SyncDoc,
) -> Result<SyncResult, String> {
    // send HelloAck with our version vector
    let local_vv = sync_doc.version_vector();
    protocol::send_encrypted(ns, &SyncMessage::HelloAck { vv: local_vv }).await?;

    // receive peer's changes
    let received = recv_and_import(sync_doc, ns).await?;
    eprintln!("[sync-engine] responder: received={}", received);

    // send our changes to peer
    let sent = send_delta_or_snapshot(sync_doc, &remote_vv, ns).await?;
    eprintln!("[sync-engine] responder: sent={}", sent);

    // exchange acks
    let _ = protocol::recv_encrypted(ns).await?; // peer's ack
    protocol::send_encrypted(ns, &SyncMessage::SyncAck).await?;

    let result = if received && sent {
        SyncResult::BothSynced
    } else if received {
        SyncResult::ChangesReceived
    } else if sent {
        SyncResult::ChangesSent
    } else {
        SyncResult::AlreadyUpToDate
    };
    eprintln!("[sync-engine] responder result: {:?}", match &result {
        SyncResult::BothSynced => "BothSynced",
        SyncResult::ChangesReceived => "ChangesReceived",
        SyncResult::ChangesSent => "ChangesSent",
        SyncResult::AlreadyUpToDate => "AlreadyUpToDate",
    });
    Ok(result)
}

// ── internal helpers ──────────────────────────────────────────────────

/// Try delta export, fall back to snapshot if delta is empty or fails.
/// Returns true if something was sent.
async fn send_delta_or_snapshot(
    doc: &SyncDoc,
    remote_vv: &[u8],
    ns: &mut NoiseStream,
) -> Result<bool, String> {
    // try delta first
    match doc.export_delta(remote_vv) {
        Ok(delta) if !delta.is_empty() => {
            let compressed = lz4_flex::compress_prepend_size(&delta);
            protocol::send_encrypted(ns, &SyncMessage::SyncDelta { data: compressed }).await?;
            Ok(true)
        }
        _ => {
            // empty delta or failed — send all updates (not snapshot, which discards foreign nodes)
            match doc.export_all_updates() {
                Ok(updates) if !updates.is_empty() => {
                    let compressed = lz4_flex::compress_prepend_size(&updates);
                    protocol::send_encrypted(
                        ns,
                        &SyncMessage::SyncDelta { data: compressed },
                    )
                    .await?;
                    Ok(true)
                }
                _ => {
                    protocol::send_encrypted(ns, &SyncMessage::SyncUpToDate).await?;
                    Ok(false)
                }
            }
        }
    }
}

/// Receive delta/snapshot from peer and import into doc.
/// Returns true if changes were imported.
/// Backs up .loro → .loro.bak before importing for crash recovery.
async fn recv_and_import(doc: &mut SyncDoc, ns: &mut NoiseStream) -> Result<bool, String> {
    let msg = protocol::recv_encrypted(ns).await?;
    match msg {
        SyncMessage::SyncDelta { data } => {
            eprintln!("[sync-engine] recv delta: {} bytes compressed", data.len());
            let decompressed = lz4_flex::decompress_size_prepended(&data)
                .map_err(|e| format!("lz4 decompress: {}", e))?;
            eprintln!("[sync-engine] decompressed to {} bytes", decompressed.len());
            let json_before = doc.read_bookmarks_as_json().unwrap_or_default();
            eprintln!("[sync-engine] BEFORE import: {}", &json_before[..json_before.len().min(200)]);
            let tree_before = doc.doc.get_tree("bookmarks");
            eprintln!("[sync-engine] tree nodes before: {}", tree_before.children(None).unwrap_or_default().len());
            doc.backup(); // .loro → .loro.bak
            eprintln!("[sync-engine] doc vv before import: {:?}", &doc.version_vector()[..doc.version_vector().len().min(20)]);
            doc.import_remote(&decompressed)?;
            eprintln!("[sync-engine] doc vv after import: {:?}", &doc.version_vector()[..doc.version_vector().len().min(20)]);
            let tree_after = doc.doc.get_tree("bookmarks");
            let children = tree_after.children(None).unwrap_or_default();
            eprintln!("[sync-engine] root children after import: {}", children.len());
            for (i, nid) in children.iter().enumerate() {
                if let Ok(meta) = tree_after.get_meta(*nid) {
                    let t = super::sync_doc::get_map_str_pub(&meta, "type").unwrap_or_default();
                    let id = super::sync_doc::get_map_str_pub(&meta, "id").unwrap_or_default();
                    eprintln!("[sync-engine]   root[{}]: type={} id={} treeid={:?}", i, t, id, nid);
                }
            }
            // also check ALL nodes including non-root via get_value
            let tree_val = tree_after.get_value();
            eprintln!("[sync-engine] tree get_value: {}", serde_json::to_string(&tree_val).unwrap_or_else(|_| "ERR".into()));
            doc.save()?;
            let json = doc.read_bookmarks_as_json().unwrap_or_default();
            eprintln!("[sync-engine] after save, read_as_json: {}", &json[..json.len().min(300)]);
            Ok(true)
        }
        SyncMessage::SyncSnapshot { data } => {
            eprintln!("[sync-engine] recv snapshot: {} bytes compressed", data.len());
            let decompressed = lz4_flex::decompress_size_prepended(&data)
                .map_err(|e| format!("lz4 decompress: {}", e))?;
            eprintln!("[sync-engine] decompressed to {} bytes", decompressed.len());
            doc.backup();
            doc.import_remote(&decompressed)?;
            doc.save()?;
            let json = doc.read_bookmarks_as_json().unwrap_or_default();
            eprintln!("[sync-engine] after import, doc has: {}", &json[..json.len().min(300)]);
            Ok(true)
        }
        SyncMessage::SyncUpToDate => {
            eprintln!("[sync-engine] recv SyncUpToDate (no changes from peer)");
            Ok(false)
        }
        _ => Err("expected SyncDelta/SyncSnapshot/SyncUpToDate".into()),
    }
}
