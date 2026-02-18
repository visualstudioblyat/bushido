mod blocker;
mod crash_log;
mod downloads;
mod import;
mod screenshot;
mod sync;
mod vault;

use tauri::{Manager, WebviewUrl, Emitter};
use tauri::webview::WebviewBuilder;
use std::sync::Arc;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
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
    fingerprint_script: String,
    vault_script: String,
    glance_script: String,
}

struct WhitelistState {
    sites: Mutex<HashSet<String>>,
}

struct KeybindingState {
    map: Mutex<HashMap<String, String>>,  // normalized shortcut string → action
}

// Default keybindings: (action, combo in React format "Ctrl+T")
// next-tab/prev-tab excluded — Ctrl+Tab not capturable as global shortcut on Windows
const DEFAULT_KEYBINDINGS: &[(&str, &str)] = &[
    ("new-tab", "Ctrl+T"),
    ("close-tab", "Ctrl+W"),
    ("reopen-tab", "Ctrl+Shift+T"),
    ("focus-url", "Ctrl+L"),
    ("find", "Ctrl+F"),
    ("command-palette", "Ctrl+K"),
    ("reload", "Ctrl+R"),
    ("fullscreen", "F11"),
    ("bookmark", "Ctrl+D"),
    ("history", "Ctrl+H"),
    ("downloads", "Ctrl+J"),
    ("toggle-sidebar", "Ctrl+B"),
    ("toggle-compact", "Ctrl+Shift+B"),
    ("reader-mode", "Ctrl+Shift+R"),
    ("devtools", "Ctrl+Shift+I"),
    ("split-view", "Ctrl+\\"),
    ("print", "Ctrl+P"),
    ("screenshot", "Ctrl+Shift+S"),
    ("zoom-in", "Ctrl+="),
    ("zoom-out", "Ctrl+-"),
    ("zoom-reset", "Ctrl+0"),
];

/// Convert a React-format combo like "Ctrl+Shift+T" into the normalized lowercase
/// string that the global_hotkey crate produces from Shortcut::to_string().
/// Shortcut::to_string() outputs modifiers in order: shift+control+alt+super+ then key code.
/// e.g. "Ctrl+Shift+T" → "shift+control+keyt", "F11" → "f11", "Ctrl+=" → "control+equal"
fn normalize_combo(combo: &str) -> String {
    let mut has_shift = false;
    let mut has_ctrl = false;
    let mut has_alt = false;
    let mut key_part = "";

    for part in combo.split('+') {
        let trimmed = part.trim();
        match trimmed.to_uppercase().as_str() {
            "CTRL" | "CONTROL" => has_ctrl = true,
            "SHIFT" => has_shift = true,
            "ALT" | "OPTION" => has_alt = true,
            _ => key_part = trimmed,
        }
    }

    // Convert React key name to global_hotkey Code name
    let key_code = match key_part.to_uppercase().as_str() {
        s if s.len() == 1 && s.chars().next().unwrap().is_ascii_alphabetic() =>
            format!("key{}", s.to_lowercase()),
        "=" => "equal".into(),
        "-" => "minus".into(),
        "\\" => "backslash".into(),
        "0" => "digit0".into(),
        "1" => "digit1".into(),
        "2" => "digit2".into(),
        "3" => "digit3".into(),
        "4" => "digit4".into(),
        "5" => "digit5".into(),
        "6" => "digit6".into(),
        "7" => "digit7".into(),
        "8" => "digit8".into(),
        "9" => "digit9".into(),
        "/" => "slash".into(),
        "." => "period".into(),
        "," => "comma".into(),
        ";" => "semicolon".into(),
        "'" => "quote".into(),
        "`" => "backquote".into(),
        "[" => "bracketleft".into(),
        "]" => "bracketright".into(),
        other => other.to_lowercase(),
    };

    // Build in the same order as HotKey::into_string: shift, control, alt, super
    let mut result = String::new();
    if has_shift { result.push_str("shift+"); }
    if has_ctrl { result.push_str("control+"); }
    if has_alt { result.push_str("alt+"); }
    result.push_str(&key_code);
    result
}

#[cfg(windows)]
struct PendingPermission {
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
    args: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PermissionRequestedEventArgs,
    _tab_id: String,
}
#[cfg(windows)]
unsafe impl Send for PendingPermission {}
#[cfg(windows)]
unsafe impl Sync for PendingPermission {}

struct PermissionState {
    saved: Mutex<HashMap<String, bool>>,
    #[cfg(windows)]
    pending: Arc<Mutex<HashMap<String, PendingPermission>>>,
}

fn is_blocked_scheme(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("javascript:") || lower.starts_with("data:")
        || lower.starts_with("file:") || lower.starts_with("vbscript:")
        || lower.starts_with("blob:")
        // Windows-specific dangerous URI schemes (Follina CVE-2022-30190 + friends)
        || lower.starts_with("ms-msdt:") || lower.starts_with("search-ms:")
        || lower.starts_with("ms-officecmd:") || lower.starts_with("ms-word:")
        || lower.starts_with("ms-excel:") || lower.starts_with("ms-powerpoint:")
        || lower.starts_with("ms-cxh:") || lower.starts_with("ms-cxh-full:")
}

#[tauri::command]
async fn create_tab(app: tauri::AppHandle, id: String, url: String, sidebar_w: f64, top_offset: f64, https_only: bool, ad_blocker: bool, cookie_auto_reject: bool, is_panel: bool, disable_dev_tools: Option<bool>, disable_status_bar: Option<bool>, disable_autofill: Option<bool>, disable_password_save: Option<bool>, block_service_workers: Option<bool>, block_font_enum: Option<bool>, spoof_hw_concurrency: Option<bool>) -> Result<(), String> {
    crash_log::log_info("create_tab", &format!("id={} url={}", id, url));
    let disable_dev_tools = disable_dev_tools.unwrap_or(false);
    let disable_status_bar = disable_status_bar.unwrap_or(false);
    let disable_autofill = disable_autofill.unwrap_or(false);
    let disable_password_save = disable_password_save.unwrap_or(false);
    let block_service_workers = block_service_workers.unwrap_or(false);
    let block_font_enum = block_font_enum.unwrap_or(false);
    let spoof_hw_concurrency = spoof_hw_concurrency.unwrap_or(false);

    // cap at 50 tabs to prevent resource exhaustion
    {
        let ws = app.state::<WebviewState>();
        let tabs = ws.tabs.lock();
        if tabs.len() >= 50 { return Err("Max 50 tabs".into()); }
    }

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
    let fingerprint_script = bs.fingerprint_script.clone();
    let vault_script = bs.vault_script.clone();
    let glance_script = bs.glance_script.clone();

    // check if this site is whitelisted
    let ws = app.state::<WhitelistState>();
    let whitelist_sites = ws.sites.lock().clone();
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
    let inject_fingerprint = fingerprint_script.clone();
    let inject_vault = vault_script.clone();
    let inject_glance = glance_script.clone();

    // build security hardening JS (only enabled features)
    let mut sec_parts: Vec<&str> = Vec::new();
    if block_service_workers {
        sec_parts.push("try{if(navigator.serviceWorker){Object.defineProperty(navigator,'serviceWorker',{get:function(){return{register:function(){return Promise.reject(new DOMException('blocked','SecurityError'))},getRegistration:function(){return Promise.resolve(undefined)},getRegistrations:function(){return Promise.resolve([])},ready:new Promise(function(){}),controller:null}},configurable:false});}}catch(e){}");
    }
    if block_font_enum {
        sec_parts.push("try{if(document.fonts){Object.defineProperty(document,'fonts',{get:function(){return{forEach:function(){},size:0,ready:Promise.resolve(),check:function(){return false},has:function(){return false}}},configurable:false});}}catch(e){}");
    }
    if spoof_hw_concurrency {
        sec_parts.push("try{var rc=navigator.hardwareConcurrency;var sc=(rc>=8)?8:4;Object.defineProperty(navigator,'hardwareConcurrency',{get:function(){return sc},configurable:false});}catch(e){}");
    }
    let security_js = if sec_parts.is_empty() { String::new() } else { format!("(function(){{{}}})();", sec_parts.join("")) };
    let inject_security = security_js.clone();

    let whitelisted_for_nav = site_whitelisted;
    let whitelisted_for_load = site_whitelisted;
    let nav_https_only = https_only;
    let nav_ad_blocker = ad_blocker;
    let load_ad_blocker = ad_blocker;
    let load_cookie_reject = cookie_auto_reject;

    let mut builder = WebviewBuilder::new(&id, webview_url)
        .auto_resize();

    if is_panel {
        builder = builder.user_agent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36");
    } else {
        builder = builder.user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
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
                let _ = wv.eval(&inject_shortcut);
                let _ = wv.eval(&inject_media);
                let _ = wv.eval(&inject_fingerprint);
                let _ = wv.eval(&inject_vault);
                let _ = wv.eval(&inject_glance);
                // blockers only if enabled and not whitelisted
                if load_ad_blocker && !whitelisted_for_load {
                    let _ = wv.eval(&inject_cosmetic);
                }
                if load_cookie_reject && !whitelisted_for_load {
                    let _ = wv.eval(&inject_cookie);
                }
                if !inject_security.is_empty() {
                    let _ = wv.eval(&inject_security);
                }
            }
        });

    builder = builder.initialization_script(&shortcut_script);
    builder = builder.initialization_script(&media_script);
    builder = builder.initialization_script(&fingerprint_script);
    builder = builder.initialization_script(&vault_script);
    builder = builder.initialization_script(&glance_script);

    // only inject cosmetic scripts if enabled and not whitelisted
    if ad_blocker && !site_whitelisted {
        builder = builder.initialization_script(&cosmetic_script);
    }
    if cookie_auto_reject && !site_whitelisted {
        builder = builder.initialization_script(&cookie_script);
    }
    if !security_js.is_empty() {
        builder = builder.initialization_script(&security_js);
    }

    let webview = window.add_child(
        builder,
        tauri::LogicalPosition::new(sidebar_w, top_offset),
        tauri::LogicalSize::new(content_w, content_h),
    ).map_err(|e| e.to_string())?;

    let state = app.state::<WebviewState>();
    state.tabs.lock().insert(tab_id_track, true);

    // intercept downloads + ad blocking via WebView2 COM API
    #[cfg(windows)]
    {
        let app_dl = app.clone();
        let engine_for_block = engine.clone();
        let app_for_block = app.clone();
        let tab_id_block = id.clone();
        let block_enabled = ad_blocker && !site_whitelisted;
        let source_url = final_url.clone();

        let wv_tab_id = id.clone();
        let with_result = webview.with_webview(move |wv| {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows::core::Interface;

            unsafe {
                let controller = wv.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        crate::crash_log::log_error("with_webview", &format!("CoreWebView2() failed for {}: {}", wv_tab_id, e));
                        return;
                    }
                };
                let core4: ICoreWebView2_4 = match core.cast() {
                    Ok(c) => c,
                    Err(_) => return,
                };

                // always-on COM hardening
                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetAreHostObjectsAllowed(false);
                    // conditional security settings (toggled via Settings → Security)
                    if disable_dev_tools { let _ = settings.SetAreDevToolsEnabled(false); }
                    if disable_status_bar { let _ = settings.SetIsStatusBarEnabled(false); }
                    if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
                        let _ = s4.SetIsGeneralAutofillEnabled(!disable_autofill);
                        let _ = s4.SetIsPasswordAutosaveEnabled(!disable_password_save);
                    }
                }

                // try to get cookie manager for authenticated downloads
                let cookie_mgr: Option<ICoreWebView2CookieManager> = core.cast::<ICoreWebView2_2>()
                    .ok()
                    .and_then(|c2| c2.CookieManager().ok());

                let app_inner = app_dl.clone();
                let mut token: i64 = 0;

                let handler = webview2_com::DownloadStartingEventHandler::create(Box::new(
                    move |_sender, args| {
                        // SAFETY: catch_unwind prevents panics from crossing the FFI boundary (UB)
                        let args_ref = AssertUnwindSafe(&args);
                        let app_ref = AssertUnwindSafe(&app_inner);
                        let cookie_ref = AssertUnwindSafe(&cookie_mgr);
                        let _ = catch_unwind(move || {
                            if let Some(args) = args_ref.as_ref() {
                                let _ = args.SetHandled(true);
                                let _ = args.SetCancel(true);

                                let download_op = match args.DownloadOperation() { Ok(d) => d, Err(_) => return };
                                let mut uri_pwstr = windows::core::PWSTR::null();
                                if download_op.Uri(&mut uri_pwstr).is_err() { return; }
                                let url = if !uri_pwstr.is_null() {
                                    uri_pwstr.to_string().unwrap_or_default()
                                } else { String::new() };

                                let mut disp_pwstr = windows::core::PWSTR::null();
                                let disposition = if download_op.ContentDisposition(&mut disp_pwstr).is_ok() && !disp_pwstr.is_null() {
                                    disp_pwstr.to_string().unwrap_or_default()
                                } else { String::new() };

                                let filename = downloads::parse_filename(&url, &disposition);

                                if let Some(ref mgr) = *cookie_ref {
                                    let url_clone = url.clone();
                                    let filename_clone = filename.clone();
                                    let app_cookie = app_ref.clone();
                                    let url_wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
                                    let url_pcwstr = windows::core::PCWSTR::from_raw(url_wide.as_ptr());

                                    let cookie_handler = webview2_com::GetCookiesCompletedHandler::create(Box::new(
                                        move |hr, cookie_list| {
                                            let hr_ref = AssertUnwindSafe(hr);
                                            let list_ref = AssertUnwindSafe(&cookie_list);
                                            let app_c = AssertUnwindSafe(&app_cookie);
                                            let url_c = AssertUnwindSafe(&url_clone);
                                            let fname_c = AssertUnwindSafe(&filename_clone);
                                            let _ = catch_unwind(move || {
                                                let mut cookies_str = String::new();
                                                if hr_ref.is_ok() {
                                                    if let Some(ref list) = *list_ref {
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
                                                let _ = app_c.emit_to("main", "download-intercepted", serde_json::json!({
                                                    "url": *url_c,
                                                    "suggestedFilename": *fname_c,
                                                    "cookies": cookies_opt
                                                }));
                                            });
                                            Ok(())
                                        },
                                    ));
                                    let _ = mgr.GetCookies(url_pcwstr, &cookie_handler);
                                } else {
                                    let _ = app_ref.emit_to("main", "download-intercepted", serde_json::json!({
                                        "url": url,
                                        "suggestedFilename": filename
                                    }));
                                }
                            }
                        });
                        Ok(())
                    },
                ));

                let _ = core4.add_DownloadStarting(&handler, &mut token);

                // intercept ALL requests — header stripping is always-on, adblock is conditional
                {
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
                            let args_ref = AssertUnwindSafe(&args);
                            let engine_ref = AssertUnwindSafe(&engine_block);
                            let app_ref = AssertUnwindSafe(&app_block);
                            let tab_ref = AssertUnwindSafe(&tab_block);
                            let source_ref = AssertUnwindSafe(&source);
                            let count_ref = AssertUnwindSafe(&blocked_count);
                            let _ = catch_unwind(move || {
                                if let Some(args) = args_ref.as_ref() {
                                    let request = match args.Request() { Ok(r) => r, Err(_) => return };

                                    // always-on: strip tracking headers
                                    if let Ok(headers) = request.Headers() {
                                        for h in ["Sec-CH-UA", "Sec-CH-UA-Arch", "Sec-CH-UA-Bitness",
                                                  "Sec-CH-UA-Full-Version", "Sec-CH-UA-Full-Version-List",
                                                  "Sec-CH-UA-Mobile", "Sec-CH-UA-Model", "Sec-CH-UA-Platform",
                                                  "Sec-CH-UA-Platform-Version", "Sec-CH-UA-WoW64"] {
                                            let name: Vec<u16> = h.encode_utf16().chain(std::iter::once(0)).collect();
                                            let _ = headers.RemoveHeader(windows::core::PCWSTR::from_raw(name.as_ptr()));
                                        }
                                        // NOTE: Sec-Fetch-* intentionally NOT stripped (Chromium overwrites post-handler)

                                        for h in ["X-Client-Data", "X-Requested-With"] {
                                            let name: Vec<u16> = h.encode_utf16().chain(std::iter::once(0)).collect();
                                            let _ = headers.RemoveHeader(windows::core::PCWSTR::from_raw(name.as_ptr()));
                                        }
                                        // normalize Accept-Language to match JS navigator.language spoof
                                        {
                                            let al_name: Vec<u16> = "Accept-Language\0".encode_utf16().collect();
                                            let al_val: Vec<u16> = "en-US,en;q=0.9\0".encode_utf16().collect();
                                            let _ = headers.SetHeader(
                                                windows::core::PCWSTR::from_raw(al_name.as_ptr()),
                                                windows::core::PCWSTR::from_raw(al_val.as_ptr()),
                                            );
                                        }
                                        // normalize Referer to origin only
                                        let referer_name: Vec<u16> = "Referer\0".encode_utf16().collect();
                                        let mut referer_val = windows::core::PWSTR::null();
                                        if headers.GetHeader(windows::core::PCWSTR::from_raw(referer_name.as_ptr()), &mut referer_val).is_ok() && !referer_val.is_null() {
                                            if let Ok(ref_str) = referer_val.to_string() {
                                                if let Ok(parsed) = url::Url::parse(&ref_str) {
                                                    let origin = parsed.origin().ascii_serialization();
                                                    let origin_wide: Vec<u16> = format!("{}/", origin).encode_utf16().chain(std::iter::once(0)).collect();
                                                    let _ = headers.SetHeader(
                                                        windows::core::PCWSTR::from_raw(referer_name.as_ptr()),
                                                        windows::core::PCWSTR::from_raw(origin_wide.as_ptr()),
                                                    );
                                                }
                                            }
                                        }
                                    }

                                    // conditional: adblock engine check
                                    if block_enabled {
                                        let mut uri = windows::core::PWSTR::null();
                                        if request.Uri(&mut uri).is_err() { return; }
                                        let url = if !uri.is_null() { uri.to_string().unwrap_or_default() } else { return; };

                                        let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                                        let _ = args.ResourceContext(&mut ctx);
                                        let rtype = blocker::resource_type_str(ctx.0 as u32);

                                        let matched = Request::new(&url, &source_ref, rtype)
                                            .map(|req| engine_ref.check_network_request(&req).matched)
                                            .unwrap_or(false);
                                        if matched {
                                            let blank: Vec<u16> = "about:blank\0".encode_utf16().collect();
                                            let _ = request.SetUri(windows::core::PCWSTR::from_raw(blank.as_ptr()));

                                            let count = count_ref.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                                            if count <= 3 || count % 5 == 0 {
                                                let _ = app_ref.emit_to("main", "tab-blocked-count", serde_json::json!({
                                                    "id": *tab_ref,
                                                    "count": count
                                                }));
                                            }
                                        }
                                    }
                                }
                            });
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
                        let args_ref = AssertUnwindSafe(&args);
                        let app_ref = AssertUnwindSafe(&app_msg);
                        let tab_ref = AssertUnwindSafe(&tab_id_msg);
                        let _ = catch_unwind(move || {
                            if let Some(args) = args_ref.as_ref() {
                                let mut msg_pwstr = windows::core::PWSTR::null();
                                if args.WebMessageAsJson(&mut msg_pwstr).is_err() { return; }
                                let json_str = if !msg_pwstr.is_null() {
                                    msg_pwstr.to_string().unwrap_or_default()
                                } else { return; };
                                let raw: String = serde_json::from_str(&json_str).unwrap_or_default();
                                let msg: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

                                match msg.get("__bushido").and_then(|v| v.as_str()) {
                                    Some("shortcut") => {
                                        let valid = ["toggle-compact","new-tab","close-tab","focus-url",
                                                     "find","toggle-sidebar","bookmark","history",
                                                     "command-palette","reader-mode"];
                                        if let Some(action) = msg.get("action").and_then(|v| v.as_str()) {
                                            if valid.contains(&action) {
                                                let _ = app_ref.emit_to("main", "global-shortcut", action);
                                            }
                                        }
                                    }
                                    Some("media") => {
                                        if let Some(state) = msg.get("state").and_then(|v| v.as_str()) {
                                            if !matches!(state, "playing" | "paused" | "ended") { return; }
                                            let title = msg.get("title").and_then(|v| v.as_str()).unwrap_or("");
                                            let clean = title.replace(|c: char| c == '<' || c == '>', "");
                                            let _ = app_ref.emit_to("main", "tab-media-state", serde_json::json!({
                                                "id": *tab_ref, "state": state, "title": clean
                                            }));
                                        }
                                    }
                                    Some("video") => {
                                        let has = msg.get("hasVideo").and_then(|v| v.as_bool()).unwrap_or(false);
                                        let _ = app_ref.emit_to("main", "tab-has-video", serde_json::json!({
                                            "id": *tab_ref, "hasVideo": has
                                        }));
                                    }
                                    Some("match-count") => {
                                        let count = msg.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
                                        let _ = app_ref.emit_to("main", "match-count", serde_json::json!({
                                            "id": *tab_ref, "count": count
                                        }));
                                    }
                                    Some("vault-check") => {
                                        let domain = msg.get("domain").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let tab_id = tab_ref.to_string();
                                        let app_clone = (*app_ref).clone();
                                        std::thread::spawn(move || {
                                            let vs = app_clone.state::<crate::vault::VaultState>();
                                            let is_locked = vs.derived_key.lock().is_none();
                                            if is_locked {
                                                // vault locked but page has login form — tell React to show unlock prompt
                                                let has_master = crate::vault::has_master_password_sync(&vs);
                                                if has_master {
                                                    let _ = app_clone.emit_to("main", "vault-unlock-needed", serde_json::json!({
                                                        "domain": domain, "tabId": tab_id
                                                    }));
                                                }
                                                return;
                                            }
                                            if let Ok(entries) = crate::vault::get_entries_for_domain(&vs, &domain) {
                                                if entries.is_empty() { return; }
                                                if let Some(wv) = app_clone.get_webview(&tab_id) {
                                                    let data = serde_json::json!({
                                                        "__bushidoVaultFill": true,
                                                        "entries": entries,
                                                    });
                                                    let js = format!("window.postMessage({}, '*')", data);
                                                    let _ = wv.eval(&js);
                                                }
                                            }
                                        });
                                    }
                                    Some("vault-save-prompt") => {
                                        let domain = msg.get("domain").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let username = msg.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let password = msg.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        let _ = app_ref.emit_to("main", "vault-save-prompt", serde_json::json!({
                                            "domain": domain, "username": username, "password": password
                                        }));
                                    }
                                    Some("glance") => {
                                        if let Some(url) = msg.get("url").and_then(|v| v.as_str()) {
                                            let _ = app_ref.emit_to("main", "glance-request", serde_json::json!({
                                                "url": url,
                                                "sourceTabId": *tab_ref
                                            }));
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        });
                        Ok(())
                    },
                ));

                let mut msg_token: i64 = 0;
                let _ = core.add_WebMessageReceived(&msg_handler, &mut msg_token);

                // crash handler — detect renderer process failures
                let app_crash = app_for_block.clone();
                let tab_id_crash = tab_id_block.clone();
                let crash_handler = webview2_com::ProcessFailedEventHandler::create(Box::new(
                    move |_sender, _args| {
                        let app_ref = AssertUnwindSafe(&app_crash);
                        let tab_ref = AssertUnwindSafe(&tab_id_crash);
                        let _ = catch_unwind(move || {
                            crate::crash_log::log_error("ProcessFailed", &format!(
                                "WebView2 renderer crashed for tab={}", *tab_ref
                            ));
                            let _ = app_ref.emit_to("main", "tab-crashed", serde_json::json!({
                                "id": *tab_ref
                            }));
                        });
                        Ok(())
                    },
                ));
                let mut crash_token: i64 = 0;
                let _ = core.add_ProcessFailed(&crash_handler, &mut crash_token);

                // context menu — suppress default Chromium menu, emit target info to React
                if let Ok(core11) = core.cast::<ICoreWebView2_11>() {
                    let app_ctx = app_for_block.clone();
                    let tab_id_ctx = tab_id_block.clone();

                    let ctx_handler = webview2_com::ContextMenuRequestedEventHandler::create(Box::new(
                        move |_sender, args| {
                            let args_ref = AssertUnwindSafe(&args);
                            let app_ref = AssertUnwindSafe(&app_ctx);
                            let tab_ref = AssertUnwindSafe(&tab_id_ctx);
                            let _ = catch_unwind(move || {
                                if let Some(args) = args_ref.as_ref() {
                                    let _ = args.SetHandled(true);

                                    #[repr(C)]
                                    struct RawPoint { x: i32, y: i32 }
                                    let mut point = RawPoint { x: 0, y: 0 };
                                    let _ = args.Location(&mut point as *mut RawPoint as *mut _);

                                    if let Ok(target) = args.ContextMenuTarget() {
                                        let mut kind_val = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND(0);
                                        let _ = target.Kind(&mut kind_val);
                                        let kind = match kind_val.0 {
                                            1 => "image", 2 => "selection", 3 => "audio", 4 => "video",
                                            _ => "page",
                                        };

                                        let read_pw = |pw: windows::core::PWSTR| -> String {
                                            if !pw.is_null() { pw.to_string().unwrap_or_default() } else { String::new() }
                                        };

                                        let mut has_link = windows_core::BOOL::default();
                                        let _ = target.HasLinkUri(&mut has_link);
                                        let link_uri = if has_link == true {
                                            let mut pw = windows::core::PWSTR::null();
                                            let _ = target.LinkUri(&mut pw);
                                            read_pw(pw)
                                        } else { String::new() };

                                        let mut has_source = windows_core::BOOL::default();
                                        let _ = target.HasSourceUri(&mut has_source);
                                        let source_uri = if has_source == true {
                                            let mut pw = windows::core::PWSTR::null();
                                            let _ = target.SourceUri(&mut pw);
                                            read_pw(pw)
                                        } else { String::new() };

                                        let mut has_sel = windows_core::BOOL::default();
                                        let _ = target.HasSelection(&mut has_sel);
                                        let selection = if has_sel == true {
                                            let mut pw = windows::core::PWSTR::null();
                                            let _ = target.SelectionText(&mut pw);
                                            read_pw(pw)
                                        } else { String::new() };

                                        let mut page_pw = windows::core::PWSTR::null();
                                        let _ = target.PageUri(&mut page_pw);
                                        let page_uri = read_pw(page_pw);

                                        let mut is_edit = windows_core::BOOL::default();
                                        let _ = target.IsEditable(&mut is_edit);

                                        let _ = app_ref.emit_to("main", "webview-context-menu", serde_json::json!({
                                            "id": *tab_ref,
                                            "x": point.x,
                                            "y": point.y,
                                            "kind": kind,
                                            "linkUri": link_uri,
                                            "sourceUri": source_uri,
                                            "selectionText": selection,
                                            "pageUri": page_uri,
                                            "isEditable": is_edit == true,
                                        }));
                                    }
                                }
                            });
                            Ok(())
                        },
                    ));
                    let mut ctx_token: i64 = 0;
                    let _ = core11.add_ContextMenuRequested(&ctx_handler, &mut ctx_token);
                }

                // permission request handler — custom prompt instead of Chromium default
                {
                    let app_perm = app_for_block.clone();
                    let tab_id_perm = tab_id_block.clone();
                    let perm_state = app_perm.state::<PermissionState>();
                    let perm_pending = perm_state.pending.clone();
                    let perm_saved = perm_state.saved.lock().clone();

                    let perm_handler = webview2_com::PermissionRequestedEventHandler::create(Box::new(
                        move |_sender, args| {
                            let args_ref = AssertUnwindSafe(&args);
                            let app_ref = AssertUnwindSafe(&app_perm);
                            let tab_ref = AssertUnwindSafe(&tab_id_perm);
                            let pending_ref = AssertUnwindSafe(&perm_pending);
                            let saved_ref = AssertUnwindSafe(&perm_saved);
                            let _ = catch_unwind(move || {
                                if let Some(args) = args_ref.as_ref() {
                                    let mut uri_pw = windows::core::PWSTR::null();
                                    let _ = args.Uri(&mut uri_pw);
                                    let uri = if !uri_pw.is_null() { uri_pw.to_string().unwrap_or_default() } else { return; };

                                    let domain = url::Url::parse(&uri)
                                        .ok()
                                        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
                                        .unwrap_or_default();

                                    let mut kind_val = COREWEBVIEW2_PERMISSION_KIND(0);
                                    let _ = args.PermissionKind(&mut kind_val);
                                    let kind_str = match kind_val.0 {
                                        1 => "microphone", 2 => "camera", 3 => "geolocation",
                                        4 => "notifications", 5 => "othersensors", 6 => "clipboardread",
                                        7 => "multipledownloads", 8 => "filereadwrite", 9 => "autoplay",
                                        10 => "localfonts", 11 => "midi", 12 => "windowmanagement",
                                        _ => "unknown",
                                    };

                                    let kind_key = format!("{}:{}", domain, kind_str);

                                    if let Some(&allowed) = saved_ref.get(&kind_key) {
                                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE(if allowed { 1 } else { 2 }));
                                        return;
                                    }

                                    // auto-deny local fonts (fingerprint risk), auto-allow multiple downloads
                                    if kind_val.0 == 10 { let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE(2)); return; }
                                    if kind_val.0 == 7 { let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE(1)); return; }

                                    let deferral = match args.GetDeferral() {
                                        Ok(d) => d,
                                        Err(_) => return,
                                    };

                                    let request_id = uuid::Uuid::new_v4().to_string();

                                    let mut user_initiated = windows_core::BOOL::default();
                                    let _ = args.IsUserInitiated(&mut user_initiated);

                                    pending_ref.lock()
                                        .insert(request_id.clone(), PendingPermission {
                                            deferral, args: args.clone(), _tab_id: tab_ref.clone(),
                                        });

                                    let _ = app_ref.emit_to("main", "permission-requested", serde_json::json!({
                                        "requestId": request_id,
                                        "tabId": *tab_ref,
                                        "uri": uri,
                                        "domain": domain,
                                        "permission": kind_str,
                                        "isUserInitiated": user_initiated == true,
                                    }));
                                }
                            });
                            Ok(())
                        },
                    ));
                    let mut perm_token: i64 = 0;
                    let _ = core.add_PermissionRequested(&perm_handler, &mut perm_token);
                }
            }
        });
        if let Err(e) = with_result {
            crash_log::log_error("create_tab", &format!("with_webview failed for {}: {}", id, e));
        }
    }

    crash_log::log_info("create_tab", &format!("tab {} created successfully", id));
    Ok(())
}

#[tauri::command]
async fn suspend_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        // pause media before suspending to prevent AUDIO_RENDERER_ERROR on resume
        let _ = wv.eval("document.querySelectorAll('video,audio').forEach(m=>m.pause())");

        #[cfg(windows)]
        {
            let _ = wv.with_webview(move |wv| {
                use webview2_com::Microsoft::Web::WebView2::Win32::*;
                use windows::core::Interface;
                unsafe {
                    let controller = wv.controller();
                    let core = match controller.CoreWebView2() {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                        let handler = webview2_com::TrySuspendCompletedHandler::create(
                            Box::new(|_hr, _is_successful| Ok(()))
                        );
                        let _ = core3.TrySuspend(&handler);
                    }
                    // set memory target to low — triggers GC, reduces slack
                    if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                        let _ = core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(1));
                    }
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
async fn resume_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        #[cfg(windows)]
        {
            let _ = wv.with_webview(move |wv| {
                use webview2_com::Microsoft::Web::WebView2::Win32::*;
                use windows::core::Interface;
                unsafe {
                    let controller = wv.controller();
                    let core = match controller.CoreWebView2() {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                        let _ = core3.Resume();
                    }
                    // restore memory target to normal
                    if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                        let _ = core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(0));
                    }
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
async fn close_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    crash_log::log_info("close_tab", &format!("id={}", id));
    // remove from state FIRST so layout_webviews won't try to position a dying webview
    let state = app.state::<WebviewState>();
    state.tabs.lock().remove(&id);
    if let Some(wv) = app.get_webview(&id) {
        if let Err(e) = wv.close() {
            crash_log::log_error("close_tab", &format!("wv.close() failed for {}: {}", id, e));
        }
    } else {
        crash_log::log_warn("close_tab", &format!("webview not found: {}", id));
    }
    Ok(())
}

#[tauri::command]
async fn open_glance(app: tauri::AppHandle, url: String, glance_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let total_w = size.width as f64 / scale;
    let total_h = size.height as f64 / scale;
    let content_w = total_w - sidebar_w;
    let content_h = total_h - top_offset;

    // 85% width, 80% height, centered in content area
    let glance_w = content_w * 0.85;
    let glance_h = content_h * 0.80;
    let glance_x = sidebar_w + (content_w - glance_w) / 2.0;
    let glance_y = top_offset + (content_h - glance_h) / 2.0;

    // top bar is 40px rendered by React overlay, so offset webview content down
    let bar_h = 40.0;
    let wv_x = glance_x;
    let wv_y = glance_y + bar_h;
    let wv_w = glance_w;
    let wv_h = glance_h - bar_h;

    let webview_url = tauri::WebviewUrl::External(
        url.parse().map_err(|e: url::ParseError| e.to_string())?
    );

    let bs = app.state::<BlockerState>();
    let shortcut_s = bs.shortcut_script.clone();
    let media_s = bs.media_script.clone();
    let fingerprint_s = bs.fingerprint_script.clone();
    let vault_s = bs.vault_script.clone();
    let glance_s = bs.glance_script.clone();

    let mut builder = tauri::WebviewBuilder::new(&glance_id, webview_url);
    builder = builder.initialization_script(&shortcut_s);
    builder = builder.initialization_script(&media_s);
    builder = builder.initialization_script(&fingerprint_s);
    builder = builder.initialization_script(&vault_s);
    builder = builder.initialization_script(&glance_s);

    let _webview = window.add_child(
        builder,
        tauri::LogicalPosition::new(wv_x, wv_y),
        tauri::LogicalSize::new(wv_w, wv_h),
    ).map_err(|e| e.to_string())?;

    // register as panel so layout_webviews skips it
    let ps = app.state::<PanelState>();
    ps.ids.lock().insert(glance_id);

    Ok(())
}

#[tauri::command]
async fn close_glance(app: tauri::AppHandle, glance_id: String) -> Result<(), String> {
    // unregister from panels
    let ps = app.state::<PanelState>();
    ps.ids.lock().remove(&glance_id);

    // destroy webview
    if let Some(wv) = app.get_webview(&glance_id) {
        let _ = wv.close();
    }
    Ok(())
}

#[tauri::command]
async fn promote_glance(app: tauri::AppHandle, glance_id: String) -> Result<(), String> {
    // unregister from panels
    let ps = app.state::<PanelState>();
    ps.ids.lock().remove(&glance_id);

    // register as a normal tab in WebviewState using the glance_id as tab id
    // (the webview label IS the glance_id, so layout_webviews can find it)
    let ws = app.state::<WebviewState>();
    ws.tabs.lock().insert(glance_id, false);

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
async fn vault_retry_autofill(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WebviewState>();
    let tabs = state.tabs.lock().clone();
    for (tab_id, _) in &tabs {
        if let Some(wv) = app.get_webview(tab_id) {
            let _ = wv.eval("if(window.__bushidoVaultRetry)window.__bushidoVaultRetry()");
        }
    }
    Ok(())
}

#[tauri::command]
async fn layout_webviews(app: tauri::AppHandle, panes: Vec<PaneRectArg>, focused_tab_id: String, sidebar_w: f64, top_offset: f64) -> Result<(), String> {
    let state = app.state::<WebviewState>();
    let panel_state = app.state::<PanelState>();
    let panel_ids = panel_state.ids.lock().clone();
    let tabs = state.tabs.lock().clone();

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
async fn toggle_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    let win = app.get_window("main").ok_or("no window")?;
    let fs = win.is_fullscreen().map_err(|e| e.to_string())?;
    win.set_fullscreen(!fs).map_err(|e| e.to_string())
}

#[tauri::command]
async fn zoom_tab(app: tauri::AppHandle, id: String, factor: f64) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let _ = wv.with_webview(move |wv| {
            #[cfg(windows)]
            unsafe { let _ = wv.controller().SetZoomFactor(factor); }
        });
    }
    Ok(())
}

#[tauri::command]
async fn print_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.eval("window.print()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn toggle_devtools(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.with_webview(|webview| {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
                let core = webview.controller().CoreWebView2().unwrap();
                let _ = core.OpenDevToolsWindow();
            }));
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("{}", e))?;
        cb.set_text(text).map_err(|e| format!("{}", e))
    }).join().unwrap_or(Err("thread panicked".into()))
}

#[tauri::command]
async fn set_tab_pinned(app: tauri::AppHandle, id: String, pinned: bool) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        let js = format!("window.__bushidoPinned = {};", pinned);
        let _ = wv.eval(&js);
    }
    Ok(())
}

#[tauri::command]
async fn find_in_page(app: tauri::AppHandle, id: String, query: String, forward: bool) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        if query.is_empty() {
            wv.eval("window.getSelection().removeAllRanges()").map_err(|e| e.to_string())?;
        } else {
            let dir = if forward { "false" } else { "true" };
            let escaped = query.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n").replace('\r', "\\r");
            let js = format!(
                "window.find('{}', false, {}, true, false, false, false)",
                escaped, dir
            );
            wv.eval(&js).map_err(|e| e.to_string())?;
            let count_js = format!(
                "(function(){{var q='{}';var t=(document.body.innerText||'').toLowerCase();var c=t.split(q.toLowerCase()).length-1;window.chrome.webview.postMessage(JSON.stringify({{__bushido:'match-count',count:c}}))}})()",
                escaped
            );
            let _ = wv.eval(&count_js);
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
    ps.ids.lock().insert(id);
    Ok(())
}

#[tauri::command]
async fn unregister_panel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let ps = app.state::<PanelState>();
    ps.ids.lock().remove(&id);
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

fn permissions_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("permissions.json")
}

fn load_permissions(app: &tauri::AppHandle) -> HashMap<String, bool> {
    let path = permissions_path(app);
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, bool>>(&data) {
                return map;
            }
        }
    }
    HashMap::new()
}

fn save_permissions(app: &tauri::AppHandle, perms: &HashMap<String, bool>) {
    let path = permissions_path(app);
    if let Ok(json) = serde_json::to_string(perms) {
        let _ = fs::write(&path, json);
    }
}

#[tauri::command]
async fn toggle_whitelist(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let (whitelisted, snapshot) = {
        let mut sites = ws.sites.lock();
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
    let sites = ws.sites.lock();
    Ok(sites.iter().cloned().collect())
}

#[tauri::command]
async fn is_whitelisted(app: tauri::AppHandle, domain: String) -> Result<bool, String> {
    let ws = app.state::<WhitelistState>();
    let sites = ws.sites.lock();
    Ok(sites.contains(&domain))
}

#[tauri::command]
async fn respond_permission(app: tauri::AppHandle, request_id: String, allow: bool, remember: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;

        let perm_state = app.state::<PermissionState>();
        let pending = perm_state.pending.lock()
            .remove(&request_id);
        let pending = pending.ok_or("Permission request not found")?;

        let state_val = COREWEBVIEW2_PERMISSION_STATE(if allow { 1 } else { 2 });
        unsafe {
            let _ = pending.args.SetState(state_val);
            let _ = pending.deferral.Complete();
        }

        if remember {
            let mut uri_pw = windows::core::PWSTR::null();
            unsafe { let _ = pending.args.Uri(&mut uri_pw); }
            let uri = if !uri_pw.is_null() { unsafe { uri_pw.to_string().unwrap_or_default() } } else { String::new() };
            let domain = url::Url::parse(&uri)
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
                .unwrap_or_default();

            let mut kind_val = COREWEBVIEW2_PERMISSION_KIND(0);
            unsafe { let _ = pending.args.PermissionKind(&mut kind_val); }
            let kind_str = match kind_val.0 {
                1 => "microphone", 2 => "camera", 3 => "geolocation",
                4 => "notifications", 5 => "othersensors", 6 => "clipboardread",
                7 => "multipledownloads", 8 => "filereadwrite", 9 => "autoplay",
                10 => "localfonts", 11 => "midi", 12 => "windowmanagement",
                _ => "unknown",
            };
            let kind_key = format!("{}:{}", domain, kind_str);

            let mut saved = perm_state.saved.lock();
            saved.insert(kind_key, allow);
            save_permissions(&app, &saved);
        }
    }

    Ok(())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedPermissionEntry {
    domain: String,
    permission: String,
    allowed: bool,
}

#[tauri::command]
async fn get_permissions(app: tauri::AppHandle) -> Result<Vec<SavedPermissionEntry>, String> {
    let ps = app.state::<PermissionState>();
    let saved = ps.saved.lock();
    let result: Vec<SavedPermissionEntry> = saved.iter().map(|(key, &allowed)| {
        let parts: Vec<&str> = key.splitn(2, ':').collect();
        SavedPermissionEntry {
            domain: parts.first().unwrap_or(&"").to_string(),
            permission: parts.get(1).unwrap_or(&"unknown").to_string(),
            allowed,
        }
    }).collect();
    Ok(result)
}

#[tauri::command]
async fn revoke_permission(app: tauri::AppHandle, domain: String, permission: String) -> Result<(), String> {
    let ps = app.state::<PermissionState>();
    let mut saved = ps.saved.lock();
    let key = format!("{}:{}", domain, permission);
    saved.remove(&key);
    save_permissions(&app, &saved);
    Ok(())
}

#[tauri::command]
fn rebind_shortcut(app: tauri::AppHandle, action: String, old_combo: String, new_combo: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();

    // Unregister old (ignore error if it wasn't registered)
    if !old_combo.is_empty() {
        let _ = gs.unregister(old_combo.as_str());
    }

    // Register new
    gs.register(new_combo.as_str())
        .map_err(|e| format!("Failed to register {}: {}", new_combo, e))?;

    // Update the keybinding map
    let kb = app.state::<KeybindingState>();
    let mut map = kb.map.lock();
    let old_normalized = normalize_combo(&old_combo);
    let new_normalized = normalize_combo(&new_combo);
    map.remove(&old_normalized);
    map.insert(new_normalized, action);

    Ok(())
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
    // if sync enabled, write through SyncDoc
    let state = app.try_state::<sync::SyncState>();
    if let Some(state) = state {
        let mut doc_guard = state.sync_doc.lock().await;
        if let Some(ref mut doc) = *doc_guard {
            doc.write_full_from_json(&data)?;
            doc.save()?;
            drop(doc_guard); // release before notify
            sync::notify_sync_change(&state);
            return Ok(());
        }
    }
    // fallback: plain JSON
    fs::write(bookmarks_path(&app), data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_bookmarks(app: tauri::AppHandle) -> Result<String, String> {
    // if sync enabled, read from SyncDoc
    let state = app.try_state::<sync::SyncState>();
    if let Some(state) = state {
        let doc_guard = state.sync_doc.lock().await;
        if let Some(ref doc) = *doc_guard {
            return doc.read_bookmarks_as_json();
        }
    }
    // fallback: plain JSON
    let p = bookmarks_path(&app);
    if p.exists() { fs::read_to_string(&p).map_err(|e| e.to_string()) } else { Ok(r#"{"bookmarks":[],"folders":[]}"#.into()) }
}

#[tauri::command]
async fn start_download(app: tauri::AppHandle, url: String, filename: String, download_dir: String, cookies: Option<String>, mime_routing: Option<Vec<downloads::MimeRoute>>) -> Result<String, String> {
    let dir = if download_dir.is_empty() {
        dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().to_string()
    } else {
        download_dir
    };
    let rl = app.state::<std::sync::Arc<downloads::RateLimiter>>();
    downloads::start(app.clone(), url, filename, dir, cookies, mime_routing.unwrap_or_default(), rl.inner().clone()).await
}

#[tauri::command]
async fn pause_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    downloads::pause(&app, &id)
}

#[tauri::command]
async fn resume_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let rl = app.state::<std::sync::Arc<downloads::RateLimiter>>();
    downloads::resume(app.clone(), id, rl.inner().clone()).await
}

#[tauri::command]
async fn reorder_download(app: tauri::AppHandle, id: String, priority: u32) -> Result<(), String> {
    downloads::set_priority(&app, &id, priority)
}

#[tauri::command]
async fn set_bandwidth_limit(app: tauri::AppHandle, limit: u64) -> Result<(), String> {
    let rl = app.state::<std::sync::Arc<downloads::RateLimiter>>();
    rl.limit_bps.store(limit, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn cancel_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    downloads::cancel(&app, &id)
}

#[tauri::command]
async fn get_downloads(app: tauri::AppHandle) -> Result<Vec<downloads::DlItem>, String> {
    let dm = app.state::<downloads::DownloadManager>();
    let downloads = dm.downloads.lock();
    Ok(downloads.values().cloned().collect())
}

#[tauri::command]
async fn open_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dm = app.state::<downloads::DownloadManager>();
    let path = {
        let downloads = dm.downloads.lock();
        let item = downloads.get(&id).ok_or("not found")?;
        item.file_path.clone()
    };
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_download_folder(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dm = app.state::<downloads::DownloadManager>();
    let path = {
        let downloads = dm.downloads.lock();
        let item = downloads.get(&id).ok_or("not found")?;
        item.file_path.clone()
    };
    let parent = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
    tauri_plugin_opener::open_path(&parent, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebView2 browser args — must be set before any webview creation
    // SECURITY: clear first to prevent injection from pre-existing env (e.g. --remote-debugging-port)
    #[cfg(windows)]
    {
        std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-quic --site-per-process --origin-agent-cluster=true \
             --disable-dns-prefetch --disable-background-networking \
             --enable-features=ThirdPartyStoragePartitioning,PartitionedCookies \
             --disable-features=UserAgentClientHint \
             --renderer-process-limit=4 \
             --js-flags=--max-old-space-size=512 \
             --purge-v8-memory \
             --disable-low-res-tiling");
    }

    // init data dir and crash logging FIRST
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.bushido.browser");
    let _ = std::fs::create_dir_all(&data_dir);
    crash_log::init(&data_dir);
    crash_log::log_info("startup", &format!("Bushido Browser v0.9.2 starting, pid={}", std::process::id()));

    // init adblock-rust engine (cached binary or cold compile)
    let engine = blocker::init_engine(&data_dir);

    let cosmetic_script = include_str!("content_blocker.js").to_string();
    let cookie_script = include_str!("cookie_blocker.js").to_string();
    let shortcut_script = include_str!("shortcut_bridge.js").to_string();
    let media_script = include_str!("media_listener.js").to_string();
    let fingerprint_script = include_str!("fingerprint.js").to_string();
    let vault_script = include_str!("vault_autofill.js").to_string();
    let glance_script = include_str!("glance_listener.js").to_string();

    let sync_data_dir = data_dir.clone();

    // Load keybindings from settings.json (or use defaults)
    let mut keybinding_map: HashMap<String, String> = HashMap::new();
    let mut shortcut_combos: Vec<String> = Vec::new();
    {
        let settings_p = data_dir.join("settings.json");
        let user_bindings: Option<HashMap<String, String>> = if settings_p.exists() {
            fs::read_to_string(&settings_p).ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("keybindings").cloned())
                .and_then(|kb| serde_json::from_value(kb).ok())
        } else {
            None
        };

        // Build action→combo from user settings or defaults
        let mut action_to_combo: Vec<(String, String)> = Vec::new();
        if let Some(ref ub) = user_bindings {
            for (action, combo) in DEFAULT_KEYBINDINGS {
                let combo_str = ub.get(*action).map(|s| s.as_str()).unwrap_or(combo);
                action_to_combo.push((action.to_string(), combo_str.to_string()));
            }
        } else {
            for (action, combo) in DEFAULT_KEYBINDINGS {
                action_to_combo.push((action.to_string(), combo.to_string()));
            }
        }

        for (action, combo) in &action_to_combo {
            let normalized = normalize_combo(combo);
            keybinding_map.insert(normalized, action.clone());
            shortcut_combos.push(combo.clone());
        }
    }
    let keybinding_state = KeybindingState {
        map: Mutex::new(keybinding_map),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WebviewState {
            tabs: Mutex::new(HashMap::new()),
        })
        .manage(PanelState {
            ids: Mutex::new(HashSet::new()),
        })
        .manage(downloads::DownloadManager::new())
        .manage(std::sync::Arc::new(downloads::RateLimiter::new(0)))
        .manage(keybinding_state)
        .manage(BlockerState {
            engine,
            cosmetic_script,
            cookie_script,
            shortcut_script,
            media_script,
            fingerprint_script,
            vault_script,
            glance_script,
        })
        .plugin({
            tauri_plugin_global_shortcut::Builder::new()
            .with_shortcuts(shortcut_combos.iter().map(|s| s.as_str()))
            .unwrap_or_else(|e| {
                eprintln!("Warning: failed to register global shortcuts: {}", e);
                tauri_plugin_global_shortcut::Builder::new()
            })
            .with_handler(|app, shortcut, event| {
                use tauri_plugin_global_shortcut::ShortcutState;
                if event.state != ShortcutState::Pressed { return; }
                let normalized = shortcut.to_string().to_lowercase();
                let kb_state = app.state::<KeybindingState>();
                let action = {
                    let map = kb_state.map.lock();
                    map.get(&normalized).cloned()
                };
                if let Some(action) = action {
                    if let Some(win) = app.get_webview("main") {
                        let js = format!("window.__bushidoGlobalShortcut && window.__bushidoGlobalShortcut('{}')", action);
                        let _ = win.eval(&js);
                    }
                }
            })
            .build()
        })
        .setup(|app| {
            // boost process priority for UI responsiveness during heavy filtering
            #[cfg(windows)]
            {
                use windows::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS};
                unsafe { let _ = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS); }
            }

            let sites = load_whitelist(&app.handle());
            app.manage(WhitelistState {
                sites: Mutex::new(sites),
            });

            let saved_perms = load_permissions(&app.handle());
            app.manage(PermissionState {
                saved: Mutex::new(saved_perms),
                #[cfg(windows)]
                pending: Arc::new(Mutex::new(HashMap::new())),
            });

            // init vault
            let vault_path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("vault.db");
            let vault_state = vault::VaultState::new(vault_path);
            let _ = vault_state.init_db();
            app.manage(vault_state);

            // Initialize sync state
            let sync_state = match sync::keys::load_identity(&sync_data_dir) {
                Ok(Some(identity)) => {
                    // Read syncEnabled from the app settings (Tauri app_data_dir), NOT sync_data_dir
                    let settings_p = app.path().app_data_dir()
                        .unwrap_or_else(|_| sync_data_dir.clone())
                        .join("settings.json");
                    let sync_enabled = if settings_p.exists() {
                        fs::read_to_string(&settings_p).ok()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                            .and_then(|v| v.get("syncEnabled")?.as_bool())
                            .unwrap_or(false)
                    } else { false };

                    if sync_enabled {
                        let device_name = fs::read_to_string(&settings_p).ok()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                            .and_then(|v| v.get("syncDeviceName")?.as_str().map(String::from))
                            .unwrap_or_else(|| hostname::get()
                                .map(|h| h.to_string_lossy().to_string())
                                .unwrap_or_else(|_| "My PC".into()));
                        let state = sync::SyncState::from_identity(identity, device_name, sync_data_dir);
                        // Start discovery automatically
                        if let Ok(mut disc) = sync::discovery::DiscoveryService::new() {
                            let _ = disc.register(&state.device_id, &state.device_name, &state.fingerprint);
                            let _ = disc.start_browsing(app.handle().clone(), state.device_id.clone());
                            *state.discovery.lock() = Some(disc);
                            *state.status.lock() = sync::SyncStatus::Discovering;
                        }
                        state
                    } else {
                        sync::SyncState::new_disabled(sync_data_dir)
                    }
                }
                _ => sync::SyncState::new_disabled(sync_data_dir),
            };
            app.manage(sync_state);

            // Start TCP listener if sync is enabled
            {
                let ss = app.state::<sync::SyncState>();
                if ss.enabled {
                    sync::start_tcp_listener(app.handle().clone());
                }
            }

            // Init SyncDoc + migration + sync debounce + health check if sync enabled
            {
                let ss = app.state::<sync::SyncState>();
                if ss.enabled {
                    match sync::sync_doc::SyncDoc::init(&ss.app_data_dir, ss.peer_id, &ss.device_id) {
                        Ok(mut doc) => {
                            let _ = doc.maybe_migrate_json(&ss.app_data_dir);
                            *ss.sync_doc.blocking_lock() = Some(doc);
                            sync::start_sync_debounce(app.handle().clone());
                            sync::start_health_check(app.handle().clone());
                            sync::start_compaction(app.handle().clone());
                        }
                        Err(e) => eprintln!("[sync] SyncDoc init failed: {}", e),
                    }
                }
            }

            // restore pending downloads from manifests
            let pending = downloads::load_pending(&app.handle());
            if !pending.is_empty() {
                let dm = app.state::<downloads::DownloadManager>();
                let mut downloads = dm.downloads.lock();
                for item in pending {
                    downloads.insert(item.id.clone(), item);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_tab,
            suspend_tab,
            resume_tab,
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
            toggle_fullscreen,
            zoom_tab,
            print_tab,
            toggle_devtools,
            copy_text_to_clipboard,
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
            respond_permission,
            get_permissions,
            revoke_permission,
            rebind_shortcut,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            get_downloads,
            open_download,
            open_download_folder,
            reorder_download,
            set_bandwidth_limit,
            register_panel,
            unregister_panel,
            position_panel,
            import::detect_browsers,
            import::import_bookmarks,
            import::import_history,
            screenshot::capture_visible,
            screenshot::capture_preview_for_select,
            screenshot::capture_area,
            screenshot::capture_fullpage,
            screenshot::save_screenshot,
            screenshot::copy_image_to_clipboard,
            screenshot::generate_qr_code,
            crash_log::read_crash_log,
            crash_log::clear_crash_log,
            sync::get_sync_status,
            sync::enable_sync,
            sync::disable_sync,
            sync::get_discovered_peers,
            sync::set_device_name,
            sync::start_pairing,
            sync::enter_pairing_code,
            sync::remove_device,
            sync::simulate_pairing,
            sync::force_sync,
            sync::simulate_sync,
            sync::sync_add_bookmark,
            sync::sync_remove_bookmark,
            sync::sync_add_folder,
            sync::sync_remove_folder,
            sync::sync_rename_folder,
            sync::sync_move_bookmark,
            sync::sync_add_history,
            sync::sync_write_setting,
            sync::sync_write_tabs,
            sync::sync_get_all_tabs,
            sync::sync_set_data_types,
            sync::send_tab_to_device,
            sync::reset_sync_data,
            vault::vault_has_master_password,
            vault::vault_setup,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_is_unlocked,
            vault::vault_save_entry,
            vault::vault_get_entries,
            vault::vault_delete_entry,
            vault::vault_update_entry,
            vault::vault_generate_password,
            vault_retry_autofill,
            open_glance,
            close_glance,
            promote_glance,
            set_tab_pinned
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            crash_log::log_error("startup", &format!("Tauri run() failed: {}", e));
            eprintln!("FATAL: Bushido failed to start: {}", e);
        });
}
