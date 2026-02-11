mod blocker;
mod downloads;

use tauri::{Manager, WebviewUrl, Emitter};
use tauri::webview::WebviewBuilder;
use std::sync::{Mutex, Arc};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use adblock::engine::Engine;
use adblock::request::Request;

struct WebviewState {
    tabs: Mutex<HashMap<String, bool>>,
}

struct PanelState {
    ids: Mutex<HashSet<String>>,
}

struct BlockerState {
    engine: Arc<Engine>,
    cosmetic_script: String,
    cookie_script: String,
    shortcut_script: String,
    media_script: String,
}

struct WhitelistState {
    sites: Mutex<HashSet<String>>,
}

fn is_blocked_scheme(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("javascript:") || lower.starts_with("data:")
        || lower.starts_with("file:") || lower.starts_with("vbscript:")
        || lower.starts_with("blob:")
}

#[tauri::command]
async fn create_tab(app: tauri::AppHandle, id: String, url: String, sidebar_w: f64, top_offset: f64, https_only: bool, ad_blocker: bool, cookie_auto_reject: bool, is_panel: bool) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let content_w = (size.width as f64 / scale) - sidebar_w;
    let content_h = (size.height as f64 / scale) - top_offset;

    // block dangerous URL schemes
    if is_blocked_scheme(&url) {
        return Err("Blocked URL scheme".into());
    }

    // internal pages — handled by React, no webview needed
    if url.starts_with("bushido://") {
        return Ok(());
    }

    // https upgrade (conditional on https_only setting)
    let final_url = if url.starts_with("https://") {
        url.clone()
    } else if url.starts_with("http://") {
        if https_only { url.replacen("http://", "https://", 1) } else { url.clone() }
    } else {
        format!("https://{}", url)
    };
    let webview_url = WebviewUrl::External(
        final_url.parse().map_err(|e: url::ParseError| e.to_string())?
    );

    let bs = app.state::<BlockerState>();
    let engine = bs.engine.clone();
    let cosmetic_script = bs.cosmetic_script.clone();
    let cookie_script = bs.cookie_script.clone();
    let shortcut_script = bs.shortcut_script.clone();
    let media_script = bs.media_script.clone();

    // check if this site is whitelisted
    let ws = app.state::<WhitelistState>();
    let whitelist_sites = ws.sites.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let site_domain = url::Url::parse(&final_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
        .unwrap_or_default();
    let site_whitelisted = whitelist_sites.contains(&site_domain);

    let tab_id_nav = id.clone();
    let tab_id_title = id.clone();
    let tab_id_load = id.clone();
    let tab_id_track = id.clone();
    let app_nav = app.clone();
    let app_title = app.clone();
    let app_load = app.clone();
    let engine_for_nav = engine.clone();
    let inject_cosmetic = cosmetic_script.clone();
    let inject_cookie = cookie_script.clone();
    let inject_shortcut = shortcut_script.clone();
    let inject_media = media_script.clone();
    let whitelisted_for_nav = site_whitelisted;
    let whitelisted_for_load = site_whitelisted;
    let nav_https_only = https_only;
    let nav_ad_blocker = ad_blocker;
    let load_ad_blocker = ad_blocker;
    let load_cookie_reject = cookie_auto_reject;

    let mut builder = WebviewBuilder::new(&id, webview_url)
        .auto_resize();

    // set mobile UA for panel webviews so sites serve narrow-friendly layouts
    if is_panel {
        builder = builder.user_agent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36");
    }

    builder = builder.on_navigation(move |url| {
            let url_str = url.to_string();

            // block dangerous URL schemes (javascript:, data:, file:, etc.)
            if is_blocked_scheme(&url_str) {
                return false;
            }

            // block http (only when https-only mode is enabled)
            if nav_https_only && url_str.starts_with("http://") {
                return false;
            }

            // adblock-rust engine check for document-level navigations
            if nav_ad_blocker && !whitelisted_for_nav {
                if let Ok(req) = Request::new(&url_str, &url_str, "document") {
                    let result = engine_for_nav.check_network_request(&req);
                    if result.matched {
                        return false;
                    }
                }
            }

            let _ = app_nav.emit_to("main", "tab-url-changed", serde_json::json!({
                "id": tab_id_nav,
                "url": url_str
            }));
            true
        })
        .on_document_title_changed(move |_wv, title| {
            // strip html tags to prevent stored xss via malicious <title>
            let clean = title.replace(|c: char| c == '<' || c == '>', "");
            let _ = app_title.emit_to("main", "tab-title-changed", serde_json::json!({
                "id": tab_id_title,
                "title": clean
            }));
        })
        .on_page_load(move |wv, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let _ = app_load.emit_to("main", "tab-loading", serde_json::json!({
                "id": tab_id_load,
                "loading": loading
            }));
            // re-inject on every page load
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                // shortcut bridge + media listener always injected
                let _ = wv.eval(&inject_shortcut);
                let _ = wv.eval(&inject_media);
                // blockers only if enabled and not whitelisted
                if load_ad_blocker && !whitelisted_for_load {
                    let _ = wv.eval(&inject_cosmetic);
                }
                if load_cookie_reject && !whitelisted_for_load {
                    let _ = wv.eval(&inject_cookie);
                }
            }
        });

    // shortcut bridge + media listener always injected
    builder = builder.initialization_script(&shortcut_script);
    builder = builder.initialization_script(&media_script);

    // only inject cosmetic + privacy scripts if enabled and not whitelisted
    if ad_blocker && !site_whitelisted {
        builder = builder.initialization_script(&cosmetic_script);
    }
    if cookie_auto_reject && !site_whitelisted {
        builder = builder.initialization_script(&cookie_script);
    }

    let webview = window.add_child(
        builder,
        tauri::LogicalPosition::new(sidebar_w, top_offset),
        tauri::LogicalSize::new(content_w, content_h),
    ).map_err(|e| e.to_string())?;

    let state = app.state::<WebviewState>();
    state.tabs.lock().unwrap_or_else(|e| e.into_inner()).insert(tab_id_track, true);

    // intercept downloads + ad blocking via WebView2 COM API
    #[cfg(windows)]
    {
        let app_dl = app.clone();
        let engine_for_block = engine.clone();
        let app_for_block = app.clone();
        let tab_id_block = id.clone();
        let block_enabled = ad_blocker && !site_whitelisted;
        let source_url = final_url.clone();

        let _ = webview.with_webview(move |wv| {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows::core::Interface;

            unsafe {
                let controller = wv.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let core4: ICoreWebView2_4 = match core.cast() {
                    Ok(c) => c,
                    Err(_) => return,
                };

                // try to get cookie manager for authenticated downloads
                let cookie_mgr: Option<ICoreWebView2CookieManager> = core.cast::<ICoreWebView2_2>()
                    .ok()
                    .and_then(|c2| c2.CookieManager().ok());

                let app_inner = app_dl.clone();
                let mut token: i64 = 0;

                let handler = webview2_com::DownloadStartingEventHandler::create(Box::new(
                    move |_sender, args| {
                        if let Some(args) = args {
                            // suppress default UI + cancel browser download
                            args.SetHandled(true)?;
                            args.SetCancel(true)?;

                            // extract url via out-pointer
                            let download_op = args.DownloadOperation()?;
                            let mut uri_pwstr = windows::core::PWSTR::null();
                            download_op.Uri(&mut uri_pwstr)?;
                            let url = if !uri_pwstr.is_null() {
                                uri_pwstr.to_string().unwrap_or_default()
                            } else {
                                String::new()
                            };

                            // extract content-disposition via out-pointer
                            let mut disp_pwstr = windows::core::PWSTR::null();
                            let disposition = if download_op.ContentDisposition(&mut disp_pwstr).is_ok() && !disp_pwstr.is_null() {
                                disp_pwstr.to_string().unwrap_or_default()
                            } else {
                                String::new()
                            };

                            let filename = downloads::parse_filename(&url, &disposition);

                            // extract cookies for authenticated downloads
                            if let Some(ref mgr) = cookie_mgr {
                                let url_clone = url.clone();
                                let filename_clone = filename.clone();
                                let app_cookie = app_inner.clone();
                                let url_wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
                                let url_pcwstr = windows::core::PCWSTR::from_raw(url_wide.as_ptr());

                                let cookie_handler = webview2_com::GetCookiesCompletedHandler::create(Box::new(
                                    move |hr, cookie_list| {
                                        let mut cookies_str = String::new();
                                        if hr.is_ok() {
                                            if let Some(ref list) = cookie_list {
                                                let mut count = 0u32;
                                                if list.Count(&mut count).is_ok() {
                                                    for i in 0..count {
                                                        if let Ok(cookie) = list.GetValueAtIndex(i) {
                                                            let mut name_pw = windows::core::PWSTR::null();
                                                            let mut val_pw = windows::core::PWSTR::null();
                                                            if cookie.Name(&mut name_pw).is_ok() && cookie.Value(&mut val_pw).is_ok() {
                                                                let name = if !name_pw.is_null() { name_pw.to_string().unwrap_or_default() } else { String::new() };
                                                                let val = if !val_pw.is_null() { val_pw.to_string().unwrap_or_default() } else { String::new() };
                                                                if !name.is_empty() {
                                                                    if !cookies_str.is_empty() { cookies_str.push_str("; "); }
                                                                    cookies_str.push_str(&name);
                                                                    cookies_str.push('=');
                                                                    cookies_str.push_str(&val);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        let cookies_opt = if cookies_str.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(cookies_str) };
                                        let _ = app_cookie.emit_to("main", "download-intercepted", serde_json::json!({
                                            "url": url_clone,
                                            "suggestedFilename": filename_clone,
                                            "cookies": cookies_opt
                                        }));
                                        Ok(())
                                    },
                                ));
                                let _ = mgr.GetCookies(url_pcwstr, &cookie_handler);
                            } else {
                                // no cookie manager — emit without cookies
                                let _ = app_inner.emit_to("main", "download-intercepted", serde_json::json!({
                                    "url": url,
                                    "suggestedFilename": filename
                                }));
                            }
                        }
                        Ok(())
                    },
                ));

                let _ = core4.add_DownloadStarting(&handler, &mut token);

                // adblock: intercept all sub-resource requests at network level
                if block_enabled {
                    let filter: Vec<u16> = "*\0".encode_utf16().collect();
                    let _ = core.AddWebResourceRequestedFilter(
                        windows::core::PCWSTR::from_raw(filter.as_ptr()),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    );

                    let engine_block = engine_for_block.clone();
                    let app_block = app_for_block.clone();
                    let tab_block = tab_id_block.clone();
                    let source = source_url.clone();
                    let blocked_count = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));

                    let block_handler = webview2_com::WebResourceRequestedEventHandler::create(Box::new(
                        move |_sender, args| {
                            if let Some(args) = args {
                                let request = args.Request()?;
                                let mut uri = windows::core::PWSTR::null();
                                request.Uri(&mut uri)?;
                                let url = if !uri.is_null() { uri.to_string().unwrap_or_default() } else { return Ok(()); };

                                let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                                let _ = args.ResourceContext(&mut ctx);
                                let rtype = blocker::resource_type_str(ctx.0 as u32);

                                let matched = Request::new(&url, &source, rtype)
                                    .map(|req| engine_block.check_network_request(&req).matched)
                                    .unwrap_or(false);
                                if matched {
                                    // block by setting empty 403 response
                                    let env = args.GetDeferral(); // just need to set response
                                    drop(env);
                                    // simplest block: set response to empty with status 403
                                    // WebView2 doesn't have a simple "block" — we use put_Response with empty body
                                    // but we need the environment. get it from the core ref.
                                    // actually the simplest approach: we can't easily get env here,
                                    // so we use the Request to set the URI to about:blank
                                    let blank: Vec<u16> = "about:blank\0".encode_utf16().collect();
                                    let _ = request.SetUri(windows::core::PCWSTR::from_raw(blank.as_ptr()));

                                    let count = blocked_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                                    if count <= 3 || count % 5 == 0 {
                                        let _ = app_block.emit_to("main", "tab-blocked-count", serde_json::json!({
                                            "id": tab_block,
                                            "count": count
                                        }));
                                    }
                                }
                            }
                            Ok(())
                        },
                    ));

                    let mut block_token: i64 = 0;
                    let _ = core.add_WebResourceRequested(&block_handler, &mut block_token);
                }

                // postMessage IPC handler — replaces title encoding
                let app_msg = app_for_block.clone();
                let tab_id_msg = tab_id_block.clone();

                let msg_handler = webview2_com::WebMessageReceivedEventHandler::create(Box::new(
                    move |_sender, args| {
                        if let Some(args) = args {
                            let mut msg_pwstr = windows::core::PWSTR::null();
                            args.WebMessageAsJson(&mut msg_pwstr)?;
                            let json_str = if !msg_pwstr.is_null() {
                                msg_pwstr.to_string().unwrap_or_default()
                            } else {
                                return Ok(());
                            };
                            // WebMessageAsJson returns a JSON-escaped string
                            let raw: String = serde_json::from_str(&json_str).unwrap_or_default();
                            let msg: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

                            match msg.get("__bushido").and_then(|v| v.as_str()) {
                                Some("shortcut") => {
                                    let valid = ["toggle-compact","new-tab","close-tab","focus-url",
                                                 "find","toggle-sidebar","bookmark","history",
                                                 "command-palette","reader-mode"];
                                    if let Some(action) = msg.get("action").and_then(|v| v.as_str()) {
                                        if valid.contains(&action) {
                                            let _ = app_msg.emit_to("main", "global-shortcut", action);
                                        }
                                    }
                                }
                                Some("media") => {
                                    if let Some(state) = msg.get("state").and_then(|v| v.as_str()) {
                                        if !matches!(state, "playing" | "paused" | "ended") { return Ok(()); }
                                        let title = msg.get("title").and_then(|v| v.as_str()).unwrap_or("");
                                        let clean = title.replace(|c: char| c == '<' || c == '>', "");
                                        let _ = app_msg.emit_to("main", "tab-media-state", serde_json::json!({
                                            "id": tab_id_msg, "state": state, "title": clean
                                        }));
                                    }
                                }
                                Some("video") => {
                                    let has = msg.get("hasVideo").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let _ = app_msg.emit_to("main", "tab-has-video", serde_json::json!({
                                        "id": tab_id_msg, "hasVideo": has
                                    }));
                                }
                                _ => {}
                            }
                        }
                        Ok(())
                    },
                ));

                let mut msg_token: i64 = 0;
                let _ = core.add_WebMessageReceived(&msg_handler, &mut msg_token);
            }
        });
    }

    Ok(())
}

#[tauri::command]
async fn close_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // remove from state FIRST so layout_webviews won't try to position a dying webview
    let state = app.state::<WebviewState>();
    state.tabs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    if let Some(wv) = app.get_webview(&id) {
        let _ = wv.close();
    }
    Ok(())
}

// position N webviews from a flat rect array
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaneRectArg {
    tab_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[tauri::command]
async fn layout_webviews(app: tauri::AppHandle, panes: Vec<PaneRectArg>, focused_tab_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let state = app.state::<WebviewState>();
    let panel_state = app.state::<PanelState>();
    let panel_ids = panel_state.ids.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let tabs = state.tabs.lock().unwrap_or_else(|e| e.into_inner()).clone();

    for (tab_id, _) in &tabs {
        if panel_ids.contains(tab_id) { continue; }
        if let Some(wv) = app.get_webview(tab_id) {
            if let Some(pane) = panes.iter().find(|p| p.tab_id == *tab_id) {
                let _ = wv.set_position(tauri::LogicalPosition::new(sidebar_w + pane.x, top_offset + pane.y));
                let _ = wv.set_size(tauri::LogicalSize::new(pane.w, pane.h));
                if *tab_id == focused_tab_id {
                    let _ = wv.set_focus();
                }
            } else {
                let _ = wv.set_position(tauri::LogicalPosition::new(-9999.0, -9999.0));
            }
        }
    }
    Ok(())
}

// legacy wrapper — kept for incremental migration
#[tauri::command]
async fn switch_tab(app: tauri::AppHandle, id: String, split_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let content_w = (size.width as f64 / scale) - sidebar_w;
    let content_h = (size.height as f64 / scale) - top_offset;

    let mut panes = vec![PaneRectArg { tab_id: id.clone(), x: 0.0, y: 0.0, w: content_w, h: content_h }];
    if !split_id.is_empty() {
        let half_w = content_w / 2.0;
        panes[0].w = half_w;
        panes.push(PaneRectArg { tab_id: split_id, x: half_w, y: 0.0, w: half_w, h: content_h });
    }

    layout_webviews(app, panes, id, sidebar_w, top_offset).await
}

#[tauri::command]
async fn navigate_tab(app: tauri::AppHandle, id: String, url: String) -> Result<(), String> {
    if is_blocked_scheme(&url) {
        return Err("Blocked URL scheme".into());
    }
    if let Some(wv) = app.get_webview(&id) {
        let parsed_url = if url.starts_with("https://") {
            url.parse().map_err(|e: url::ParseError| e.to_string())?
        } else if url.starts_with("http://") {
            url.replacen("http://", "https://", 1)
                .parse().map_err(|e: url::ParseError| e.to_string())?
        } else if url.contains('.') {
            format!("https://{}", url).parse().map_err(|e: url::ParseError| e.to_string())?
        } else {
            format!("https://www.google.com/search?q={}", urlencoding::encode(&url))
                .parse().map_err(|e: url::ParseError| e.to_string())?
        };
        wv.navigate(parsed_url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn go_back(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.history.back()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn go_forward(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.history.forward()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn reload_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.location.reload()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_window("main").ok_or("no window")?.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_window("main").ok_or("no window")?;
    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_window("main").ok_or("no window")?.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn find_in_page(app: tauri::AppHandle, id: String, query: String, forward: bool) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        if query.is_empty() {
            wv.eval("window.getSelection().removeAllRanges()").map_err(|e| e.to_string())?;
        } else {
            let dir = if forward { "false" } else { "true" };
            let js = format!(
                "window.find('{}', false, {}, true, false, false, false)",
                query.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n").replace('\r', "\\r"),
                dir
            );
            wv.eval(&js).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn detect_video(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let js = r#"(function(){var videos=document.querySelectorAll('video');var has=false;videos.forEach(function(v){if(v.readyState>=2||v.src||v.querySelector('source'))has=true});if(window.chrome&&window.chrome.webview){window.chrome.webview.postMessage(JSON.stringify({__bushido:'video',hasVideo:has}))}})()"#;
        wv.eval(js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_reader(app: tauri::AppHandle, id: String, font_size: u32, font: String, theme: String, line_width: u32) -> Result<(), String> {
    let fs = font_size.clamp(12, 28);
    let lw = line_width.clamp(600, 900);
    let font_family = if font == "serif" {
        "Georgia,'Times New Roman',serif"
    } else {
        "-apple-system,system-ui,sans-serif"
    };
    let (bg, text, link) = match theme.as_str() {
        "light" => ("#fafafa", "#1a1a1a", "#4f46e5"),
        "sepia" => ("#f4ecd8", "#433422", "#8b5e3c"),
        _ => ("#09090b", "#d4d4d8", "#818cf8"),
    };
    let css = format!(
        "#__bushido_reader{{position:fixed;inset:0;z-index:999999;background:{bg};color:{text};overflow-y:auto;padding:48px 24px;font-family:{font_family};font-size:{fs}px;line-height:1.7}}.bushido-reader-content{{max-width:{lw}px;margin:0 auto}}.bushido-reader-content h1{{font-size:2em;margin-bottom:.5em;line-height:1.2}}.bushido-reader-content img{{max-width:100%;height:auto;border-radius:8px;margin:16px 0}}.bushido-reader-content a{{color:{link}}}.bushido-reader-content p{{margin-bottom:1em}}"
    );
    let js = format!(
        r#"(function(){{if(document.getElementById('__bushido_reader')){{document.getElementById('__bushido_reader').remove();var s=document.getElementById('__bushido_reader_style');if(s)s.remove();document.querySelectorAll('[data-bushido-hidden]').forEach(function(el){{el.style.display=el.dataset.bushidoOrigDisplay||'';delete el.dataset.bushidoHidden;delete el.dataset.bushidoOrigDisplay}});return}}var article=document.querySelector('article')||document.querySelector('[role="main"]')||document.querySelector('main');if(!article){{var candidates=document.querySelectorAll('div,section');var best=null,bestLen=0;candidates.forEach(function(el){{var text=el.innerText||'';if(text.length>bestLen){{bestLen=text.length;best=el}}}});article=best}}if(!article)return;var title=document.title;var content=article.innerHTML;Array.from(document.body.children).forEach(function(el){{if(el.id==='__bushido_reader')return;el.dataset.bushidoOrigDisplay=el.style.display;el.dataset.bushidoHidden='true';el.style.display='none'}});var reader=document.createElement('div');reader.id='__bushido_reader';reader.innerHTML='<div class="bushido-reader-content"><h1>'+title+'</h1>'+content+'</div>';document.body.appendChild(reader);var style=document.createElement('style');style.id='__bushido_reader_style';style.textContent=`{css}`;document.head.appendChild(style)}})()"#
    );
    if let Some(wv) = app.get_webview(&id) {
        wv.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_pip(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let js = r#"(function(){if(document.pictureInPictureElement){document.exitPictureInPicture();return}var existing=document.getElementById('__bushido_pip_host');if(existing){existing.remove();return}var v=document.querySelector('video');if(!v)return;v.removeAttribute('disablePictureInPicture');v.removeAttribute('disablepictureinpicture');var host=document.createElement('div');host.id='__bushido_pip_host';host.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none';var shadow=host.attachShadow({mode:'closed'});var btn=document.createElement('div');btn.innerHTML='<svg width="18" height="18" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:6px"><rect x="1" y="2.5" width="14" height="11" rx="1.5" stroke="white" stroke-width="1.3"/><rect x="8" y="7" width="6" height="5" rx="1" fill="white" opacity="0.4" stroke="white" stroke-width="1"/></svg>Picture in Picture';btn.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:#fff;padding:14px 24px;border-radius:10px;cursor:pointer;font:600 15px system-ui;box-shadow:0 8px 32px rgba(0,0,0,0.6);pointer-events:auto;display:flex;align-items:center;border:1px solid rgba(255,255,255,0.15);backdrop-filter:blur(12px);transition:background 0.15s';btn.onmouseenter=function(){btn.style.background='rgba(99,102,241,0.9)'};btn.onmouseleave=function(){btn.style.background='rgba(0,0,0,0.9)'};btn.onclick=function(e){e.stopPropagation();v.requestPictureInPicture().then(function(){host.remove()}).catch(function(){btn.innerHTML='PiP not available';btn.style.background='rgba(239,68,68,0.9)';setTimeout(function(){host.remove()},2000)})};shadow.appendChild(btn);document.documentElement.appendChild(host)})()"#;
        wv.eval(js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn media_play_pause(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval(r#"(function(){var v=document.querySelector('video,audio');if(v){v.paused?v.play():v.pause()}})()"#)
          .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn media_mute(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval(r#"(function(){var v=document.querySelector('video,audio');if(v){v.muted=!v.muted}})()"#)
          .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn register_panel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let ps = app.state::<PanelState>();
    ps.ids.lock().unwrap_or_else(|e| e.into_inner()).insert(id);
    Ok(())
}

#[tauri::command]
async fn unregister_panel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let ps = app.state::<PanelState>();
    ps.ids.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    Ok(())
}

#[tauri::command]
async fn position_panel(app: tauri::AppHandle, id: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
        let _ = wv.set_size(tauri::LogicalSize::new(w, h));
    }
    Ok(())
}

// legacy wrapper
#[tauri::command]
async fn resize_webviews(app: tauri::AppHandle, active_id: String, split_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    switch_tab(app, active_id, split_id, sidebar_w, top_offset).await
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn session_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("session.json")
}

fn whitelist_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("whitelist.json")
}

fn load_whitelist(app: &tauri::AppHandle) -> HashSet<String> {
    let path = whitelist_path(app);
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(sites) = serde_json::from_str::<Vec<String>>(&data) {
                return sites.into_iter().collect();
            }
        }
    }
    HashSet::new()
}

fn save_whitelist(app: &tauri::AppHandle, sites: &HashSet<String>) {
    let path = whitelist_path(app);
    let list: Vec<&String> = sites.iter().collect();
    if let Ok(json) = serde_json::to_string(&list) {
        let _ = fs::write(&path, json);
    }
}

#[tauri::command]
async fn toggle_whitelist(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let (whitelisted, snapshot) = {
        let mut sites = ws.sites.lock().unwrap_or_else(|e| e.into_inner());
        let wl = if sites.contains(&domain) {
            sites.remove(&domain);
            false
        } else {
            sites.insert(domain);
            true
        };
        (wl, sites.clone())
    };
    save_whitelist(&app, &snapshot);
    Ok(whitelisted)
}

#[tauri::command]
async fn get_whitelist(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let ws = app.state::<WhitelistState>();
    let sites = ws.sites.lock().unwrap_or_else(|e| e.into_inner());
    Ok(sites.iter().cloned().collect())
}

#[tauri::command]
async fn is_whitelisted(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let sites = ws.sites.lock().unwrap_or_else(|e| e.into_inner());
    Ok(sites.contains(&domain))
}

#[tauri::command]
async fn save_session(app: tauri::AppHandle, tabs: String) -> Result<(), String> {
    let path = session_path(&app);
    fs::write(&path, tabs).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_session(app: tauri::AppHandle) -> Result<String, String> {
    let path = session_path(&app);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("[]".into())
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("settings.json") }
fn history_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("history.json") }
fn bookmarks_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("bookmarks.json") }

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(settings_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let p = settings_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok("{}".into()) }
}

#[tauri::command]
async fn save_history(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(history_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_history(app: tauri::AppHandle) -> Result<String, String> {
    let p = history_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok("[]".into()) }
}

#[tauri::command]
async fn save_bookmarks(app: tauri::AppHandle, data: String) -> Result<(), String> {
    fs::write(bookmarks_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_bookmarks(app: tauri::AppHandle) -> Result<String, String> {
    let p = bookmarks_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok(r#"{"bookmarks":[],"folders":[]}"#.into()) }
}

#[tauri::command]
async fn start_download(app: tauri::AppHandle, url: String, filename: String, download_dir: String, cookies: Option<String>) -> Result<String, String> {
    let dir = if download_dir.is_empty() {
        dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().to_string()
    } else {
        download_dir
    };
    downloads::start(app, url, filename, dir, cookies).await
}

#[tauri::command]
async fn pause_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    downloads::pause(&app, &id)
}

#[tauri::command]
async fn resume_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    downloads::resume(app, id).await
}

#[tauri::command]
async fn cancel_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    downloads::cancel(&app, &id)
}

#[tauri::command]
async fn get_downloads(app: tauri::AppHandle) -> Result<Vec<downloads::DlItem>, String> {
    let dm = app.state::<downloads::DownloadManager>();
    let downloads = dm.downloads.lock().unwrap_or_else(|e| e.into_inner());
    Ok(downloads.values().cloned().collect())
}

#[tauri::command]
async fn open_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dm = app.state::<downloads::DownloadManager>();
    let path = {
        let downloads = dm.downloads.lock().unwrap_or_else(|e| e.into_inner());
        let item = downloads.get(&id).ok_or("not found")?;
        item.file_path.clone()
    };
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_download_folder(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dm = app.state::<downloads::DownloadManager>();
    let path = {
        let downloads = dm.downloads.lock().unwrap_or_else(|e| e.into_inner());
        let item = downloads.get(&id).ok_or("not found")?;
        item.file_path.clone()
    };
    let parent = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
    tauri_plugin_opener::open_path(&parent, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // init adblock-rust engine (cached binary or cold compile)
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.bushido.browser");
    let _ = std::fs::create_dir_all(&data_dir);
    let engine = blocker::init_engine(&data_dir);

    let cosmetic_script = include_str!("content_blocker.js").to_string();
    let cookie_script = include_str!("cookie_blocker.js").to_string();
    let shortcut_script = include_str!("shortcut_bridge.js").to_string();
    let media_script = include_str!("media_listener.js").to_string();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WebviewState {
            tabs: Mutex::new(HashMap::new()),
        })
        .manage(PanelState {
            ids: Mutex::new(HashSet::new()),
        })
        .manage(downloads::DownloadManager::new())
        .manage(BlockerState {
            engine,
            cosmetic_script,
            cookie_script,
            shortcut_script,
            media_script,
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts([
                "ctrl+shift+b",
                "ctrl+k",
                "ctrl+shift+r",
                "ctrl+t",
                "ctrl+w",
                "ctrl+l",
                "ctrl+f",
                "ctrl+d",
                "ctrl+h",
                "ctrl+\\",
            ]).unwrap_or_else(|e| {
                eprintln!("Warning: failed to register global shortcuts: {}", e);
                tauri_plugin_global_shortcut::Builder::new()
            })
            .with_handler(|app, shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                if event.state != ShortcutState::Pressed { return; }
                let s = shortcut.to_string().to_lowercase();
                let action = if s.contains("shift") && s.contains('b') { "toggle-compact" }
                    else if s.contains("shift") && s.contains('r') { "reader-mode" }
                    else if s.contains('k') { "command-palette" }
                    else if s.contains('t') { "new-tab" }
                    else if s.contains('w') { "close-tab" }
                    else if s.contains('l') { "focus-url" }
                    else if s.contains('f') { "find" }
                    else if s.contains('d') { "bookmark" }
                    else if s.contains('h') { "history" }
                    else if s.contains('\\') { "split-view" }
                    else { return; };
                if let Some(win) = app.get_webview("main") {
                    let js = format!("window.__bushidoGlobalShortcut && window.__bushidoGlobalShortcut('{}')", action);
                    let _ = win.eval(&js);
                }
            })
            .build())
        .setup(|app| {
            let sites = load_whitelist(&app.handle());
            app.manage(WhitelistState {
                sites: Mutex::new(sites),
            });

            // restore pending downloads from manifests
            let pending = downloads::load_pending(&app.handle());
            if !pending.is_empty() {
                let dm = app.state::<downloads::DownloadManager>();
                let mut downloads = dm.downloads.lock().unwrap_or_else(|e| e.into_inner());
                for item in pending {
                    downloads.insert(item.id.clone(), item);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_tab,
            close_tab,
            layout_webviews,
            switch_tab,
            navigate_tab,
            go_back,
            go_forward,
            reload_tab,
            detect_video,
            toggle_reader,
            toggle_pip,
            media_play_pause,
            media_mute,
            resize_webviews,
            find_in_page,
            minimize_window,
            maximize_window,
            close_window,
            save_session,
            load_session,
            save_settings,
            load_settings,
            save_history,
            load_history,
            save_bookmarks,
            load_bookmarks,
            toggle_whitelist,
            get_whitelist,
            is_whitelisted,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            get_downloads,
            open_download,
            open_download_folder,
            register_panel,
            unregister_panel,
            position_panel
        ])
        .run(tauri::generate_context!())
        .expect("error while running bushido");
}
