# Security Policy

## Found a Bug?

Open an issue. This is fully open source —no private disclosure process, no embargo. If you find a security issue, just file it like any other bug.

## Security Model

Bushido is a Tauri v2 browser rendering untrusted web content in WebView2 child webviews. The security boundary is between the privileged React UI (main webview) and untrusted tab/panel webviews.

For the full technical breakdown of every mitigation, see the [Security Architecture](https://docs.bushido-browser.app/docs/privacy/security) docs page.

### What's Hardened

**IPC Security**
- **postMessage origin validation** —child-to-Rust messages validated via `Source()` URI check. Only `https://` and `http://` origins accepted. Rejects `about:blank`, `data:`, `chrome-extension://` origins.
- **postMessage namespace validation** —only 3 namespaces (`shortcut`, `media`, `video`) with whitelisted action strings. Everything else silently dropped.
- **CSP enforced** on the main UI webview (blocks inline scripts, restricts connections).
- **No arbitrary eval** —zero `eval()` calls with user-controlled strings. Named Rust commands only.

**WebView2 Hardening (Always-On)**
- **Host objects disabled** —`SetAreHostObjectsAllowed(false)`. Prevents pages from accessing projected Rust methods.

**WebView2 Hardening (User-Configurable)**

These settings are toggleable in Settings → Security. All default to OFF (power-user friendly):

- **Disable DevTools** —`SetAreDevToolsEnabled(false)`.
- **Disable status bar** —`SetIsStatusBarEnabled(false)`.
- **Disable password autosave** —`SetIsPasswordAutosaveEnabled(false)` via `ICoreWebView2Settings4`.
- **Disable autofill** —`SetIsGeneralAutofillEnabled(false)`.
- **Block service workers** —JS injection rejects `navigator.serviceWorker.register()`.
- **Block font enumeration** —JS injection stubs `document.fonts.check()`.
- **Spoof CPU core count** —JS injection reports `navigator.hardwareConcurrency` as 4.

**Process Isolation**
- **Site-per-process** —`--site-per-process` flag ensures every site runs in its own renderer process.
- **Origin-keyed processes** —`--origin-agent-cluster=true` isolates different origins within the same site.
- **QUIC disabled** —`--disable-quic` forces TCP for all connections, ensuring `WebResourceRequested` can inspect all traffic.
- **DNS prefetch disabled** —`--disable-dns-prefetch` prevents DNS query leaks.
- **Background networking disabled** —`--disable-background-networking` prevents speculative connections.
- **CHIPS enabled** —`--enable-features=ThirdPartyStoragePartitioning,PartitionedCookies` partitions third-party cookies by top-level site.
- **Client Hints disabled** —`--disable-features=UserAgentClientHint`.
- **Process priority boost** —Rust process runs at `ABOVE_NORMAL_PRIORITY_CLASS` for UI responsiveness during heavy filtering.
- **Max 50 tabs** enforced server-side.

**Network Security**
- **Always-on header stripping** —`WebResourceRequested` runs for ALL tabs (even with adblock off), stripping: `Sec-CH-UA-*` (10 variants), `X-Client-Data`, `X-Requested-With`. `Sec-Fetch-*` intentionally NOT stripped (Chromium overwrites post-handler).
- **Referer normalization** —path stripped at COM level, only origin sent.
- **Accept-Language normalization** —set to `en-US,en;q=0.9` at COM level to match JS spoof.
- **Ad blocking at COM level** —adblock-rust with ~140k EasyList + EasyPrivacy rules. Unbypassable from JS.
- **HTTPS-only mode** —HTTP connections upgraded or refused.
- **Cookie banner auto-rejection** —8+ consent frameworks detected and dismissed.

**Fingerprinting Resistance**

Always-on via `content_blocker.js` (23 vectors):

- `navigator.plugins`, `mimeTypes`, `getBattery` —blocked
- `navigator.language` → en-US, `platform` → Win32
- `navigator.hardwareConcurrency` —spoofed (4 default, 8 if real >= 8, per Firefox RFP)
- `screen.availWidth/Height/colorDepth/pixelDepth` —normalized
- Canvas —per-session PRNG noise on `toDataURL`/`toBlob` (deterministic within session, unique across)
- WebGL —vendor/renderer spoofed to generic Intel UHD
- AudioContext —±0.01 noise on `getFloatFrequencyData`
- `performance.now()` —clamped to 16.67ms intervals + random jitter (anti-Spectre)
- `navigator.connection` —blocked
- WebRTC STUN/TURN —blocked
- `speechSynthesis.getVoices()` —returns empty (prevents TTS voice fingerprinting)
- `navigator.mediaDevices.enumerateDevices()` —returns empty (prevents hardware ID leaking)
- `navigator.storage.estimate()` —returns fixed values (prevents disk usage fingerprinting)
- `navigator.webdriver` —returns false (anti-automation detection)
- `performance.memory` —returns fixed values (Chrome-only heap size fingerprint)
- `Accept-Language` header —normalized to `en-US,en;q=0.9` at COM level
- Spoofed function `.toString()` —returns `[native code]` (anti-detection hardening)

**Input Sanitization**
- **Title sanitization** —`<` and `>` stripped from all tab titles in Rust.
- **URL scheme blocklist** —`javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `ms-msdt:`, `search-ms:`, `ms-officecmd:`, `ms-word:`, `ms-excel:`, `ms-powerpoint:`, `ms-cxh:`, `ms-cxh-full:` blocked in 3 places.
- **Guard variable hardening** —`Object.defineProperty(configurable: false)` on all injection scripts.
- **Download path traversal fix** —`Path::file_name()` extracts basename only.

**Crash Recovery & FFI Safety**
- **COM callback safety** —all 5 COM event handlers wrapped in `catch_unwind` + `AssertUnwindSafe` to prevent panics from crossing the Rust/C++ FFI boundary (prevents UB/0xc0000005 crashes).
- **ProcessFailed handler** —detects renderer crashes, emits `tab-crashed` event to React.
- **Crash UI** —crashed tabs show red "!" indicator, click to recreate webview.
- **Error boundary** —`react-error-boundary` catches render errors with fallback UI.
- **Global rejection handler** —`unhandledrejection` catches fire-and-forget invoke failures.
- **COM error recovery** —`match` with early return instead of `.unwrap()`.
- **Mutex poisoning recovery** —all `.lock().unwrap()` replaced with `.unwrap_or_else(|e| e.into_inner())`.
- **Env var injection prevention** —`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` cleared before setting to prevent pre-populated malicious flags.

**LAN Sync Security**
- **SPAKE2 zero-knowledge pairing** —6-digit code authenticated via SPAKE2 on Ed25519. The code is never transmitted. Both sides derive a shared secret that only matches if the same code was entered. Passive eavesdroppers and active MITMs learn nothing.
- **HMAC-SHA256 confirmation** —after SPAKE2 key derivation, both sides compute `HMAC-SHA256(shared_key, "bushido-pair-confirm")` and exchange results. Detects wrong codes and MITM attacks before any key material is exchanged.
- **XChaCha20Poly1305 key exchange** —Noise public keys encrypted with AEAD during pairing. 24-byte random nonce, authenticated ciphertext. Tampering detected, not just eavesdropping.
- **DPAPI key storage** —all sync keys (Noise private key, paired device public keys) encrypted at rest with Windows DPAPI (`CryptProtectData`). Tied to the Windows user account.
- **Rate-limited pairing** —max 3 failed attempts per device per 5-minute window. Brute-force protection on the 6-digit code space.
- **Noise Protocol transport** —`Noise_XX_25519_ChaChaPoly_BLAKE2s` encrypts all sync traffic (same primitives as WireGuard). XX pattern provides mutual authentication and forward secrecy.
- **TCP listener** —bound to port 22000, only accepts known message types. Unknown messages get `Close` with reason. 10-second timeout on initial message read.
- **Sync data sanitization** —all incoming titles stripped of HTML tags (`<` `>`), URLs validated against dangerous scheme blocklist (ms-msdt:, file:, javascript:, etc.), settings values validated as JSON before applying.
- **SendTab URL validation** —received tab URLs checked against the same dangerous scheme blocklist before emitting to the frontend. Titles sanitized before display.
- **Device-local settings isolation** —compactMode, suspendTimeout, downloadLocation, syncEnabled, onboardingComplete never leave the device regardless of sync state.

### Known Limitations

- **Shared cookie jar** —all tabs share a single WebView2 User Data Folder. Third-party cookies are partitioned via CHIPS, but first-party cookies are shared. Per-site UDF isolation requires significant architectural changes.
- **No isolated worlds on Windows** —WebView2 doesn't support Chrome's script isolation. Injected scripts share the page's JS namespace. Mitigated by running all blocking at COM level.
- **WebRTC data channels** —STUN/TURN servers are blocked via content script, but data channels may bypass network-level interception.
- **TLS/JA4 fingerprint** —Rust `reqwest` calls (filter list updates) have a non-browser TLS fingerprint. Minimal impact since these are internal-only requests.

## Dependencies

- **WebView2** —Evergreen distribution, auto-updated by Windows. Engine-level patches come from Microsoft.
- **adblock-rust** —EasyList + EasyPrivacy filter rules. Updated with each Bushido release.
- **Tauri v2** —latest stable.
