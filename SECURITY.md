# Security Policy

## Found a Bug?

Open an issue. This is fully open source — no private disclosure process, no embargo. If you find a security issue, just file it like any other bug.

## Security Model

Bushido is a Tauri v2 browser rendering untrusted web content in WebView2 child webviews. The security boundary is between the privileged React UI (main webview) and untrusted tab/panel webviews.

For the full technical breakdown of every mitigation, see the [Security Architecture](https://docs.bushido-browser.app/docs/privacy/security) docs page.

### What's Hardened

- **CSP enforced** on the main UI webview (blocks inline scripts, restricts connections)
- **postMessage IPC** — child-to-Rust communication via `window.chrome.webview.postMessage` with namespace validation and action whitelisting. No `document.title` encoding.
- **No arbitrary eval** — all child webview interactions use named Rust commands (`detect_video`, `toggle_reader`, `toggle_pip`). Zero `eval()` calls with user-controlled strings.
- **Title sanitization** — `<` and `>` stripped from all tab titles in Rust before reaching React. Prevents stored XSS via malicious `<title>` tags.
- **URL scheme blocklist** — `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` blocked in `create_tab`, `navigate_tab`, and `on_navigation`. Defense-in-depth with React-side validation.
- **Guard variable hardening** — all injection scripts use `Object.defineProperty(configurable: false)` so malicious pages can't delete or override them.
- **Network-level ad blocking** — WebView2 COM `WebResourceRequestedEventHandler` intercepts requests before connections are established. Page JavaScript cannot bypass it.
- **Download path traversal fix** — `Path::file_name()` extracts basename only. Filenames with `../` can't escape the download directory.
- **HTTPS-only mode** — HTTP connections upgraded or refused.
- **Shell plugin replaced** — `tauri-plugin-shell` replaced with `tauri-plugin-opener` (mitigates CVE-2025-31477).
- **Mutex poisoning recovery** — all `.lock().unwrap()` replaced with `.unwrap_or_else(|e| e.into_inner())` to prevent cascading panics.
- **Webview lifecycle safety** — `close_tab` removes from state before destroying the webview, preventing use-after-close races.
- **COM error recovery** — unsafe WebView2 COM operations use `match` with early return instead of `.unwrap()` panics.

### Known Limitations

- **Shared cookie jar** — all tabs share a single WebView2 User Data Folder. No per-site cookie isolation yet.
- **No isolated worlds on Windows** — WebView2 doesn't support script isolation. Injected scripts share the page's JavaScript namespace.
- **No Tauri isolation pattern** — not yet enabled. Would add a sandboxed iframe between untrusted content and the IPC bridge.
- **Fingerprinting resistance is basic** — `navigator.plugins`, `navigator.mimeTypes`, and `navigator.getBattery` are blocked. Canvas, WebGL, and AudioContext fingerprinting are not yet mitigated.

## Dependencies

- **WebView2** — Evergreen distribution, auto-updated by Windows. Engine-level patches (Spectre, sandbox escapes) come from Microsoft.
- **adblock-rust** — EasyList + EasyPrivacy filter rules. Updated with each Bushido release.
- **Tauri v2** — latest stable. Tauri security advisories are tracked.
