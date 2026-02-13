use std::sync::mpsc;

#[cfg(windows)]
use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::crash_log;

/// Capture visible viewport as base64 PNG via CapturePreview → IStream
#[tauri::command]
pub async fn capture_visible(app: tauri::AppHandle, id: String) -> Result<String, String> {
    use tauri::Manager;

    crash_log::log_info("screenshot", &format!("capture_visible called for id={}", id));

    let wv = app.get_webview(&id).ok_or_else(|| {
        crash_log::log_error("screenshot", &format!("webview not found: {}", id));
        "webview not found".to_string()
    })?;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let tx_fallback = tx.clone();

    #[cfg(windows)]
    {
        let with_result = wv.with_webview(move |wv| {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
            use windows::Win32::System::Com::{IStream, STREAM_SEEK_SET, STATFLAG_NONAME};
            use windows::Win32::Foundation::HGLOBAL;

            crash_log::log_info("screenshot", "inside with_webview closure");
            let tx = tx;
            unsafe {
                let controller = wv.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        crash_log::log_error("screenshot", &format!("CoreWebView2 failed: {}", e));
                        let _ = tx.send(Err(e.to_string()));
                        return;
                    }
                };

                let stream: IStream = match CreateStreamOnHGlobal(HGLOBAL::default(), true) {
                    Ok(s) => s,
                    Err(e) => {
                        crash_log::log_error("screenshot", &format!("CreateStreamOnHGlobal failed: {}", e));
                        let _ = tx.send(Err(e.to_string()));
                        return;
                    }
                };

                let stream_clone = stream.clone();
                let handler = webview2_com::CapturePreviewCompletedHandler::create(
                    Box::new(move |hr| {
                        crash_log::log_info("screenshot", &format!("CapturePreview callback fired, hr={:?}", hr));
                        let stream_ref = AssertUnwindSafe(&stream_clone);
                        let tx_ref = AssertUnwindSafe(&tx);
                        let _ = catch_unwind(move || {
                            if hr.is_err() {
                                let _ = tx_ref.send(Err(format!("CapturePreview failed: {:?}", hr)));
                                return;
                            }
                            let result = (|| -> Result<Vec<u8>, String> {
                                let stream = &*stream_ref;
                                stream.Seek(0, STREAM_SEEK_SET, None)
                                    .map_err(|e| format!("Seek failed: {}", e))?;
                                let mut stat = Default::default();
                                stream.Stat(&mut stat, STATFLAG_NONAME)
                                    .map_err(|e| format!("Stat failed: {}", e))?;
                                let size = stat.cbSize as usize;
                                crash_log::log_info("screenshot", &format!("stream size = {} bytes", size));
                                if size == 0 {
                                    return Err("Empty stream".into());
                                }
                                let mut buf = vec![0u8; size];
                                let mut read = 0u32;
                                let hr = stream.Read(
                                    buf.as_mut_ptr() as *mut _,
                                    size as u32,
                                    Some(&mut read),
                                );
                                if hr.is_err() {
                                    return Err(format!("Read failed: {:?}", hr));
                                }
                                crash_log::log_info("screenshot", &format!("read {} bytes from stream", read));
                                buf.truncate(read as usize);
                                Ok(buf)
                            })();
                            let _ = tx_ref.send(result);
                        });
                        Ok(())
                    })
                );

                let capture_hr = core.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                    &stream,
                    &handler,
                );
                if capture_hr.is_err() {
                    crash_log::log_error("screenshot", &format!("CapturePreview call failed: {:?}", capture_hr));
                } else {
                    crash_log::log_info("screenshot", "CapturePreview call dispatched");
                }
            }
        });

        if let Err(e) = with_result {
            crash_log::log_error("screenshot", &format!("with_webview failed: {}", e));
            let _ = tx_fallback.send(Err(format!("with_webview failed: {}", e)));
        }
    }

    crash_log::log_info("screenshot", "waiting for capture result...");
    let bytes = rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("recv timed out: {:?}", e));
            "Capture timed out".to_string()
        })?
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("capture error: {}", e));
            e
        })?;

    crash_log::log_info("screenshot", &format!("success! {} bytes captured", bytes.len()));
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Capture viewport preview + hide webview off-screen (for area select overlay)
#[tauri::command]
pub async fn capture_preview_for_select(app: tauri::AppHandle, id: String) -> Result<String, String> {
    use tauri::Manager;

    let b64 = capture_visible(app.clone(), id.clone()).await?;

    if let Some(wv) = app.get_webview(&id) {
        let _ = wv.set_position(tauri::LogicalPosition::new(-9999.0, -9999.0));
    }

    Ok(b64)
}

/// Helper: call a CDP method and return the JSON response string
#[cfg(windows)]
fn cdp_call(
    wv: &tauri::webview::PlatformWebview,
    method_name: &str,
    params_json: &str,
    tx: mpsc::Sender<Result<String, String>>,
) {
    use windows::core::PCWSTR;

    unsafe {
        let controller = wv.controller();
        let core = match controller.CoreWebView2() {
            Ok(c) => c,
            Err(e) => { let _ = tx.send(Err(e.to_string())); return; }
        };

        let method: Vec<u16> = method_name.encode_utf16().chain(std::iter::once(0)).collect();
        let params_wide: Vec<u16> = params_json.encode_utf16().chain(std::iter::once(0)).collect();

        let handler = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(
            Box::new(move |hr, json| {
                let tx_ref = AssertUnwindSafe(&tx);
                let _ = catch_unwind(move || {
                    if hr.is_err() {
                        let _ = tx_ref.send(Err(format!("CDP call failed: {:?}", hr)));
                        return;
                    }
                    // webview2-com converts PCWSTR → String automatically
                    let _ = tx_ref.send(Ok(json));
                });
                Ok(())
            })
        );

        let _ = core.CallDevToolsProtocolMethod(
            PCWSTR::from_raw(method.as_ptr()),
            PCWSTR::from_raw(params_wide.as_ptr()),
            &handler,
        );
    }
}

/// Capture a specific area using CDP Page.captureScreenshot with clip
#[tauri::command]
pub async fn capture_area(app: tauri::AppHandle, id: String, x: f64, y: f64, w: f64, h: f64, scale: f64) -> Result<String, String> {
    use tauri::Manager;

    crash_log::log_info("screenshot", &format!("capture_area id={} x={} y={} w={} h={} scale={}", id, x, y, w, h, scale));

    let wv = app.get_webview(&id).ok_or_else(|| {
        crash_log::log_error("screenshot", &format!("capture_area: webview not found: {}", id));
        "webview not found".to_string()
    })?;
    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    let params = serde_json::json!({
        "format": "png",
        "clip": { "x": x, "y": y, "width": w, "height": h, "scale": scale }
    });
    let params_str = params.to_string();

    #[cfg(windows)]
    {
        let _ = wv.with_webview(move |wv| {
            cdp_call(&wv, "Page.captureScreenshot", &params_str, tx);
        });
    }

    let json_str = rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("capture_area timed out: {:?}", e));
            "Area capture timed out".to_string()
        })??;

    crash_log::log_info("screenshot", "capture_area CDP response received");
    extract_cdp_data(&json_str)
}

/// Capture full page (beyond viewport) using CDP
#[tauri::command]
pub async fn capture_fullpage(app: tauri::AppHandle, id: String) -> Result<String, String> {
    use tauri::Manager;

    crash_log::log_info("screenshot", &format!("capture_fullpage called for id={}", id));

    let wv = app.get_webview(&id).ok_or_else(|| {
        crash_log::log_error("screenshot", &format!("capture_fullpage: webview not found: {}", id));
        "webview not found".to_string()
    })?;

    // step 1: get layout metrics
    let (tx1, rx1) = mpsc::channel::<Result<String, String>>();

    #[cfg(windows)]
    {
        let wv_ref = wv.clone();
        let _ = wv_ref.with_webview(move |wv| {
            cdp_call(&wv, "Page.getLayoutMetrics", "{}", tx1);
        });
    }

    let metrics_json = rx1.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("getLayoutMetrics timed out: {:?}", e));
            "getLayoutMetrics timed out".to_string()
        })??;

    let metrics: serde_json::Value = serde_json::from_str(&metrics_json)
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("Parse metrics failed: {}", e));
            format!("Parse metrics: {}", e)
        })?;

    let content_width = metrics.pointer("/contentSize/width")
        .and_then(|v| v.as_f64()).unwrap_or(1280.0);
    let content_height = metrics.pointer("/contentSize/height")
        .and_then(|v| v.as_f64()).unwrap_or(800.0);

    // cap to prevent OOM
    let capped_height = content_height.min(16384.0);
    crash_log::log_info("screenshot", &format!("fullpage metrics: {}x{} (capped height: {})", content_width, content_height, capped_height));

    // step 2: capture with captureBeyondViewport
    let (tx2, rx2) = mpsc::channel::<Result<String, String>>();

    let params = serde_json::json!({
        "format": "png",
        "captureBeyondViewport": true,
        "clip": { "x": 0, "y": 0, "width": content_width, "height": capped_height, "scale": 1 }
    });
    let params_str = params.to_string();

    #[cfg(windows)]
    {
        let _ = wv.with_webview(move |wv| {
            cdp_call(&wv, "Page.captureScreenshot", &params_str, tx2);
        });
    }

    let json_str = rx2.recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("fullpage capture timed out: {:?}", e));
            "Full page capture timed out".to_string()
        })??;

    crash_log::log_info("screenshot", "capture_fullpage CDP response received");
    extract_cdp_data(&json_str)
}

/// Extract base64 "data" field from CDP JSON response
fn extract_cdp_data(json_str: &str) -> Result<String, String> {
    let val: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse: {}", e))?;
    val.get("data")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No data in CDP response".to_string())
}

/// Save base64 PNG to Downloads directory
#[tauri::command]
pub async fn save_screenshot(data: String, suggested_name: String) -> Result<String, String> {
    use base64::Engine as _;

    crash_log::log_info("screenshot", &format!("save_screenshot called, data_len={} name={}", data.len(), suggested_name));

    let bytes = base64::engine::general_purpose::STANDARD.decode(&data)
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("save base64 decode failed: {}", e));
            format!("Base64 decode: {}", e)
        })?;

    let download_dir = dirs::download_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let name = if suggested_name.is_empty() {
        let now = chrono::Local::now();
        format!("Bushido Screenshot {}.png", now.format("%Y-%m-%d %H%M%S"))
    } else {
        suggested_name
    };

    let path = download_dir.join(&name);

    let final_path = if path.exists() {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = path.extension().unwrap_or_default().to_string_lossy().to_string();
        let mut i = 1;
        loop {
            let candidate = download_dir.join(format!("{} ({}).{}", stem, i, ext));
            if !candidate.exists() { break candidate; }
            i += 1;
        }
    } else {
        path
    };

    std::fs::write(&final_path, &bytes).map_err(|e| {
        crash_log::log_error("screenshot", &format!("save write failed: {} path={}", e, final_path.display()));
        format!("Write failed: {}", e)
    })?;
    crash_log::log_info("screenshot", &format!("saved {} bytes to {}", bytes.len(), final_path.display()));
    Ok(final_path.to_string_lossy().to_string())
}

/// Copy base64 PNG image to system clipboard
#[tauri::command]
pub async fn copy_image_to_clipboard(data: String) -> Result<(), String> {
    crash_log::log_info("screenshot", &format!("copy_image_to_clipboard called, data_len={}", data.len()));

    // arboard needs to run on a thread with Win32 message pump access
    tokio::task::spawn_blocking(move || {
        use base64::Engine as _;

        let bytes = base64::engine::general_purpose::STANDARD.decode(&data)
            .map_err(|e| {
                crash_log::log_error("screenshot", &format!("clipboard base64 decode failed: {}", e));
                format!("Base64 decode: {}", e)
            })?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| {
                crash_log::log_error("screenshot", &format!("clipboard image decode failed: {}", e));
                format!("Image decode: {}", e)
            })?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        let img_data = arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        };

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| {
                crash_log::log_error("screenshot", &format!("clipboard init failed: {}", e));
                format!("Clipboard init: {}", e)
            })?;
        clipboard.set_image(img_data)
            .map_err(|e| {
                crash_log::log_error("screenshot", &format!("clipboard set_image failed: {}", e));
                format!("Clipboard set: {}", e)
            })?;

        crash_log::log_info("screenshot", &format!("copied {}x{} image to clipboard", w, h));
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| {
        crash_log::log_error("screenshot", &format!("clipboard thread error: {}", e));
        format!("Thread error: {}", e)
    })?
}

/// Generate QR code for a URL, return as base64 PNG
#[tauri::command]
pub async fn generate_qr_code(url: String) -> Result<String, String> {
    use base64::Engine as _;

    crash_log::log_info("screenshot", &format!("generate_qr_code for url={}", url));

    let code = qrcode::QrCode::new(url.as_bytes())
        .map_err(|e| {
            crash_log::log_error("screenshot", &format!("QR encode failed: {}", e));
            format!("QR encode: {}", e)
        })?;

    let image = code.render::<image::Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(256, 256)
        .build();

    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    image::ImageEncoder::write_image(
        encoder,
        image.as_raw(),
        image.width(),
        image.height(),
        image::ExtendedColorType::L8,
    ).map_err(|e| format!("PNG encode: {}", e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}
