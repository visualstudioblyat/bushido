# Bushido —Changelog

—-

## v0.10.3

**2026-02-15**

Sites kept throwing Chromium's ugly default permission dialogs for camera, mic, location —totally broke the Bushido look. Now there's a glass banner that slides in from the top. Allow or deny, optionally remember per-site. Settings > Permissions shows everything you've saved and lets you revoke.

Also built out the download manager: drag-to-reorder queue priority, global bandwidth throttle (so a big download doesn't eat your whole connection), and MIME-based auto-sort so images go to Pictures, PDFs go to Documents, etc. All configurable in Settings > Downloads.

### Added

- **Permission prompts** —WebView2 `PermissionRequested` COM handler with deferral pattern. Intercepts camera, microphone, geolocation, notifications, clipboard, MIDI, window management requests. Custom glass UI slides in below the titlebar. "Remember" checkbox saves per-site decisions to disk. LocalFonts auto-denied (fingerprint risk), MultipleDownloads auto-allowed.
- **Permissions in Settings** —Settings > Permissions shows all saved per-site permission decisions in a table. Domain, permission type, allowed/denied, revoke button. Revoking means the site gets prompted again next time.
- **Download queue priority** —drag-to-reorder in the download panel. Higher priority downloads get served first. Mousedown-based drag (same pattern as tab reorder), not HTML5 drag API.
- **Bandwidth throttle** —global rate limiter across all active downloads. Token-bucket algorithm with `AtomicU64`, shared via `Arc`. Options: Unlimited, 512KB/s, 1MB/s, 2MB/s, 5MB/s, 10MB/s. Set in Settings > Downloads, takes effect immediately.
- **MIME auto-sort** —downloads check Content-Type from the HEAD response and route to user-configured folders. Default rules for `image/`, `video/`, `audio/`, `application/pdf`. Falls back to extension-based detection if Content-Type is missing. Empty folder = use default download location.

### Changed

- **`.cargo/config.toml`** —`jobs = 2` to prevent LLVM OOM on large `lib.rs` compilation. Single-threaded LLVM (`-j 1`) works but is slow; 2 jobs is the sweet spot for machines with limited paging.

—-

## v0.10.2

**2026-02-14**

Whitelisting a site for ads also killed fingerprint protection. Both lived in the same script. Ripped all fingerprint spoofs into their own `fingerprint.js` that injects unconditionally, rewrote the weak spots while I was in there.

Also: settings got a real layout (11 tabbed sections instead of one scroll), every shortcut you'd expect from Chrome is wired up, and the UI got a visual pass.

### Added

- **Fingerprint protection decoupled from ad blocker** —moved from `content_blocker.js` into `fingerprint.js`. Whitelisting a site for ads no longer strips fingerprint resistance.

- **New fingerprint spoofs** —`deviceMemory`, `maxTouchPoints`, `pdfViewerEnabled`, `cookieEnabled`, `devicePixelRatio`, screen normalized to 1920x1080, `getShaderPrecisionFormat` stripped.

- **Improved existing spoofs** —canvas PRNG replaced (LCG → xorshift128+, the old one had a detectable pattern). WebGL vendor/renderer now randomized per-session from a pool of 4 Intel iGPU strings instead of one hardcoded value. Audio fingerprint hooks expanded from just `getFloatFrequencyData` to also cover `getFloatTimeDomainData`, `getChannelData`, and `startRendering`. toString hardening on everything.

- **Desktop UA spoof** —tabs report as Chrome 131 instead of leaking `Edg/` and `WebView2/` in the user agent string.

- **Daily driver shortcuts** —zoom (Ctrl+=/-/0), print (Ctrl+P), reopen closed tab (Ctrl+Shift+T), fullscreen (F11), reload (Ctrl+R), downloads (Ctrl+J), devtools (Ctrl+Shift+I). Global shortcuts, work even when a webpage has focus.

- **Tab context menu** —duplicate tab, close tabs below.

- **Find bar match count**.

- **Tabbed settings page** —11 sections with a left sidebar nav instead of one long scroll. New sections: New Tab, Tabs, Permissions (stub). Bunch of new settings (search suggestions, homepage URL, default zoom, confirm quit, autoplay policy, etc.).

- **Keyboard shortcuts in Settings** —grouped by category, click-to-record UI, conflict detection, persists to `settings.json`. Runtime rebinding on the Rust side isn't wired yet so you need a restart.

- **Visual polish** —studied what makes Arc and Zen feel premium, applied it. `letter-spacing: -0.02em` globally, mesh gradient sidebar (accent-tinted radial gradients + SVG noise texture), glass panels bumped to `blur(20px) saturate(180%) brightness(1.1)` with hairline inset borders, spring physics via CSS `linear()` on hover states, active tab/workspace glows, URL bar pill shape with accent focus ring.

---

## v0.10.1

**2026-02-12**

### Added

- **Drag-to-Split** —drag any tab from the sidebar toward the content area to split. Preview zones show where the tab will land (left, right, top, bottom). Works with up to 4 panes. Mouse-based implementation —HTML5 drag events don't work over WebView2 native windows, so this uses the same `mousemove`/`mouseup` pattern as divider resizing.

- **Mouse-based tab reordering** —tab reordering in the sidebar converted from HTML5 drag-and-drop to mouse events. Drag vertically to reorder, drag horizontally toward content to split. Direction detection at 5px movement threshold.

—-

## v0.10.0

**2026-02-12**

I want my bookmarks on both my machines without trusting a cloud server. Every browser syncs through Google, Apple, or Mozilla's servers —my data leaves my network, sits in someone else's database, and I get a privacy policy instead of a guarantee. Bushido syncs over your local network. No accounts, no servers, no data leaving your house. Two machines on the same WiFi, end-to-end encrypted, zero trust required.

This release covers the full stack —device identity, network discovery, cryptographic pairing, and actual data sync. Bookmarks, history, settings, and open tabs all sync between paired devices using Loro CRDTs over Noise-encrypted TCP. Conflict-free merging means two people can edit bookmarks on different machines and nothing gets lost or duplicated.

### Added

- **LAN Sync —Device Identity** —first time you enable sync, Bushido generates a unique identity: device_id, CRDT peer_id, and an X25519 Noise keypair. Private key never leaves the machine. Encrypted with Windows DPAPI and saved to disk.
  <details>
  <summary>Why DPAPI?</summary>

  I needed to encrypt the Noise private key and paired device keys at rest. The options were: hardcode an encryption key (useless —anyone who reads the source has it), use a keyring/credential manager (platform-specific APIs, extra dependencies), or use DPAPI. DPAPI ties encryption to the Windows user account —I don't manage any master secret, Windows handles it. Another user on the same PC can't read the file, and copying `keys.dat` to another machine gives you garbage. One function call to encrypt, one to decrypt, zero key management on my end. The whole identity bundle is serialized with MessagePack (compact, handles raw bytes natively) and encrypted in one shot.
  </details>

- **LAN Sync —mDNS Discovery** —Bushido registers as `_bushido-sync._tcp.local.` on your network. Other instances appear in Settings → Sync → Discovered Devices automatically.
  <details>
  <summary>Why mDNS over manual IP?</summary>

  I considered having users type in IP addresses to connect, but that's not how anyone expects device pairing to work in 2026. AirDrop, Chromecast, Bluetooth —you turn it on and the other device just shows up. mDNS (multicast DNS / Bonjour) does exactly that. Bushido broadcasts a service with TXT records carrying the device_id, name, and fingerprint. At the same time it browses for other instances. When one appears, it fires a `peer-discovered` event to the UI. No IP addresses to type, no ports to remember, works on any network with multicast enabled.
  </details>

- **LAN Sync —SPAKE2 Pairing** —click "Pair" on a discovered device, get a 6-digit code. Walk over to the other machine and type it in. Zero-knowledge proof —the code never goes over the wire. HMAC-SHA256 confirmation, then Noise public keys exchanged via XChaCha20Poly1305.
  <details>
  <summary>Why SPAKE2? Why not just send the code?</summary>

  If you send the code over the network, anyone on the same WiFi can sniff it and pair with you instead. The whole point is proving both sides know the code *without transmitting it*. SPAKE2 (Password-Authenticated Key Exchange) does this —each side computes a 33-byte message derived from the code plus random ephemeral values, they exchange those, and each side independently derives the same 32-byte shared secret. An eavesdropper sees random bytes. A MITM gets caught at the HMAC confirmation step.

  I looked at three protocols: SRP requires storing a verifier on one side, which creates an asymmetry I didn't want —both devices should be equal. J-PAKE needs two round trips instead of one. SPAKE2 is one round trip, symmetric, and the `spake2` crate has a clean API on Ed25519. After key derivation, both sides compute `HMAC-SHA256(shared_key, "bushido-pair-confirm")` and compare. Wrong code = wrong key = wrong HMAC = instant abort. Right code = both sides encrypt their Noise public key with XChaCha20Poly1305 (24-byte random nonce, AEAD authenticated) and exchange. Tampering gets caught, not just eavesdropping.
  </details>

- **LAN Sync —TCP Listener** —port 22000, spawns a tokio task per connection. Wire format: 4-byte length prefix + MessagePack body, max 64KB.
  <details>
  <summary>Why MessagePack over JSON?</summary>

  The pairing messages carry raw byte arrays —SPAKE2 outputs (33 bytes), HMAC digests (32 bytes), encrypted keys (variable). With JSON I'd have to base64-encode every binary field, adding ~33% overhead and an encode/decode step on both sides. MessagePack handles `Vec<u8>` natively as binary. It's also faster to parse, but that's not why I chose it —the binary field support is what matters here.
  </details>

- **LAN Sync —Rate Limiting** —max 3 failed pairing attempts per device per 5-minute window. Brute-forcing a 6-digit code at that rate would take ~7.7 days, and the code changes each attempt.

- **LAN Sync —Noise Protocol Transport** —full `NoiseStream` wrapper for `Noise_XX_25519_ChaChaPoly_BLAKE2s`. All sync traffic between paired devices goes through this —same primitives as WireGuard: X25519 key exchange, ChaChaPoly encryption, BLAKE2s hashing. XX pattern means both sides prove their identity during the handshake with forward secrecy.

- **LAN Sync —Paired Devices** —Settings shows paired devices with name, fingerprint, and paired date. Remove button unpairs and deletes the stored key.

- **PairingWizard UI** —modal overlay: showing-code → entering-code → verifying → success/error. Glass styling, ESC to close.

- **Loopback Pairing Test** —`simulate_pairing` spawns a "Ghost Device" on localhost that runs the full SPAKE2 flow against your own TCP listener. Real crypto, real TCP, zero mocking.
  <details>
  <summary>The testing problem and how I solved it</summary>

  Testing pairing requires two machines on the same LAN. I don't always have two machines in front of me. Mocking the protocol would defeat the purpose —I need to know the real crypto works, not that a mock returns the right values. Running two instances on the same machine doesn't work either because they'd fight over port 22000 and mDNS would see itself.

  So I built a debug command that spawns a "Ghost Device" —a fake peer with its own freshly generated identity (device_id, Noise keypair, the works). It injects itself into the discovery peers list at `127.0.0.1:22000`, then after 500ms connects to your real TCP listener and runs `run_initiator` with a code it generated. From the UI, a device appears, the pairing wizard opens asking you to enter a code, and a Debug section shows you what code to type. The entire SPAKE2 → HMAC → XChaCha20 → key storage pipeline runs for real. If any of the crypto is wrong, it fails exactly like it would on two real machines. The only fake part is both endpoints are on localhost.
  </details>

- **LAN Sync —Bookmark Sync** —bookmarks sync between devices via Loro CRDT (LoroTree). Surgical operations —add, remove, move, rename folders —each one is a CRDT op, not a full overwrite. Two devices can edit bookmarks at the same time and merging just works. Migration from `bookmarks.json` happens automatically on first enable.

- **LAN Sync —History Sync** —history entries sync as a LoroMap with composite keys (`url|timestamp`). 90-day TTL, 50k entry cap, auto-compacted every 24h.

- **LAN Sync —Settings Sync** —universal settings (search engine, theme, privacy toggles) sync between devices. Device-local settings (compact mode, download location, suspend timeout) stay local. Diff-only —only changed keys get sent, not the entire settings object.

- **LAN Sync —Open Tabs Sync** —each device writes its open tabs to the CRDT every 30 seconds. Other devices see them in a "Synced Tabs" section in the sidebar. Click to open. Stale tabs from devices offline >7 days get cleaned up.

- **LAN Sync —Send Tab** —right-click any tab → "Send to [device name]". Sends the URL over the Noise-encrypted connection. Receiving device gets a toast notification with an "Open" button. URL validated against dangerous schemes before opening.

- **LAN Sync —Selective Sync** —toggle which data types sync: bookmarks, history, settings, open tabs. Each one independent.

- **LAN Sync —Health Check** —60-second background check restarts dead mDNS discovery or TCP listeners. Browser sleep/wake doesn't break sync.

- **LAN Sync —Reset** —danger zone button in settings. Backs up the current `sync.loro` file and creates a fresh CRDT. Local bookmarks preserved.

### Changed

- **Async coordination via oneshot channels** —TCP handler and UI code on different tokio tasks, bridged with `tokio::sync::oneshot` for the pairing code. 60-second timeout.
  <details>
  <summary>The coordination problem</summary>

  The pairing flow crosses two async boundaries. The TCP listener receives a `PairRequest` in a background tokio task. But the 6-digit code comes from the user typing it into the React UI, which goes through a Tauri command running on a different task entirely. I need to get the code from task B to task A without shared mutable state.

  I bridge them with a `tokio::sync::oneshot` channel. The TCP handler creates the channel, stores the `Sender` in `SyncState` behind a mutex, and awaits the `Receiver` with a 60-second timeout. When the user enters the code, `enter_pairing_code` takes the sender out of state and fires the code through. One shot, one value, no polling, no shared mutable string. If the timeout fires first, the pairing aborts cleanly.
  </details>

- **`std::sync::Mutex` over `tokio::sync::Mutex`** —never hold guards across `.await` points. Restructured every lock to grab-compute-drop.
  <details>
  <summary>The MutexGuard bug</summary>

  Tauri's `State<T>` requires `Send + Sync`. I'm sharing `SyncState` between Tauri commands (sync context) and tokio tasks (async context). My first attempt used `std::sync::Mutex` but held the guard across an `.await` —something like `let guard = state.lock(); do_something().await; drop(guard)`. The compiler rejected it: `MutexGuard` is `!Send`, and a future that holds a `!Send` value across an await point can't be spawned on a multi-threaded runtime.

  I considered switching to `tokio::sync::Mutex` (which has a `Send` guard), but it doesn't play nicely with Tauri's state system without wrapper gymnastics. Instead I restructured every mutex access: grab the lock, compute a bool or clone what I need into a local, drop the guard (end the block), *then* await. Every mutex access in `mod.rs` follows this `{ let guard = lock(); let result = ...; drop(guard); } // now safe to await` pattern. It's uglier but it's correct.
  </details>

### Errors I hit

These are real compiler errors I ran into while building this. Documenting them because the fixes aren't obvious from the error messages.

- **`tauri::Manager` trait** —`.state::<SyncState>()` on `AppHandle` gave `no method named state found`. Needed `use tauri::Manager` alongside `tauri::Emitter`. One missing import caused 13 cascading errors.

- **HMAC `E0034` ambiguity** —`HmacSha256::new_from_slice()` matches both `Mac::new_from_slice` and `KeyInit::new_from_slice`. Fix: fully-qualified `<HmacSha256 as Mac>::new_from_slice(key)`.

- **`AeadCore` for nonce generation** —`XChaCha20Poly1305::generate_nonce()` isn't on the struct, it's on the `AeadCore` trait. Error says "no function found" which is misleading. Fix: `use chacha20poly1305::aead::AeadCore`.

- **`abort_handle()` missing on Tauri's JoinHandle** —Tauri wraps tokio's handle but doesn't expose `abort_handle()`. Fix: store the full `JoinHandle<()>` and call `.abort()` directly.

- **Borrow-after-move on AppHandle** —`app.state()` borrows `app`, then moving `app` into an async block fails. Fix: clone the handle before the spawn, extract state values into locals before the closure.

### Security

- **Zero-knowledge pairing** —the 6-digit code never goes over the network. SPAKE2 proves both sides know it without revealing it.
- **AEAD key exchange** —Noise public keys encrypted with XChaCha20Poly1305 during pairing. Authenticated —tampering detected, not just eavesdropping.
  <details>
  <summary>Why XChaCha over regular ChaCha?</summary>

  Regular ChaCha20Poly1305 uses a 12-byte nonce. If you generate nonces randomly, you risk a collision after ~2^32 messages (birthday bound on 96 bits). A nonce collision is catastrophic —it leaks the XOR of two plaintexts. XChaCha20 uses a 24-byte nonce, which pushes the birthday bound to ~2^96. I can generate nonces with `OsRng` and never think about it. For a pairing flow that runs once per device pair, the 12-byte nonce would be fine statistically —but I'd rather not have to think about whether it's fine.
  </details>
- **DPAPI at rest** —all crypto material encrypted with Windows DPAPI before hitting disk. Tied to the user account, non-transferable.
- **Rate limiting** —3 attempts per device per 5 minutes. HashMap cleans up expired entries lazily.

—-

## v0.9.1

**2026-02-11**

Every tab is a WebView2 process. Each one eats 120-180MB. Open 7 heavy tabs and you're past 1.2GB before you've done anything useful. The old tab suspender was brutal about it —alive or destroyed, nothing in between. Destroy the webview and you save all the memory, but clicking the tab means a full page reload. Scroll position gone, form state gone, JS heap gone.

Edge solved this years ago with "sleeping tabs" —`ICoreWebView2_3::TrySuspend()`. Microsoft tested it across 13,000 devices and claims 83-85% memory reduction per tab. The tab freezes in place. Scripts stop, timers stop, the OS reclaims the renderer memory. But the DOM and JS heap stay intact. Call `Resume()` and it wakes up instantly —no network requests, no reload, scroll position right where you left it.

Bushido now has the same thing. Tabs go through three states instead of two: active → suspended → destroyed. The suspended tier sits in the gap where the old system was wasting the most memory.

### Added

- **Smart tab lifecycle** —active (full resources) → suspended at 2min idle (`TrySuspend`, ~85% memory saved, instant resume) → destroyed at 5min idle (0MB, full reload). The 2-5 minute window is where the real savings happen —those tabs were costing ~200MB each. Now they cost ~30MB, and clicking them doesn't reload the page.
- **`suspend_tab` command** —injects `document.querySelectorAll('video,audio').forEach(m=>m.pause())` first (WebView2 has a known bug where suspended tabs with playing media hit `AUDIO_RENDERER_ERROR` on resume —GitHub issue #3106), then calls `TrySuspend` through the COM layer.
- **`resume_tab` command** —`ICoreWebView2_3::Resume()`. That's it. One COM call, instant wake.

### Changed

- **Lifecycle check runs every 15s** —was 60s. The check is just timestamp math, no DOM work, so running it 4x more often costs nothing but catches idle tabs faster.
- **Tabs playing music never get suspended** —Spotify in a background tab stays alive. The old system only exempted pinned tabs and the active tab.
- **Split view tabs exempt** —`TrySuspend` requires the webview to be offscreen (`IsVisible = false`). Tabs in split panes are visible, so they can't be suspended anyway. Now they're explicitly skipped instead of silently failing.

—-

## v0.8.2

**2026-02-10**

v0.8.1 added the security settings page, but the underlying security implementation had gaps that production browsers (Firefox, Brave, Chromium) had already solved. v0.8.2 closes those gaps —informed by deep research into Firefox's `privacy.resistFingerprinting`, WebView2 COM safety patterns, and Chromium's `Sec-Fetch-*` header behavior.

The headline: a panic in any COM callback could crash the entire browser with a 0xc0000005 access violation. Every other change is important, but that one was a real defect.

### Security

- **COM callback safety** —all 5 COM event handlers (DownloadStarting, GetCookiesCompleted, WebResourceRequested, WebMessageReceived, ProcessFailed) wrapped in `std::panic::catch_unwind` + `AssertUnwindSafe`. A panic in any callback now returns gracefully instead of crossing the Rust/C++ FFI boundary into undefined behavior. This was the most critical fix —a malformed URL, unexpected null pointer, or edge case in the download handler would previously kill the process instantly.
- **Env var injection prevention** —`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` now cleared with `remove_var()` before `set_var()`. Previously, another process running before Bushido could pre-populate this with `--remote-debugging-port=9222` and remotely control every tab.
- **Dangerous URI scheme blocking** —`ms-msdt:`, `search-ms:`, `ms-officecmd:`, `ms-word:`, `ms-excel:`, `ms-powerpoint:`, `ms-cxh:`, `ms-cxh-full:` added to the scheme blocklist. `ms-msdt:` is the Follina exploit (CVE-2022-30190) —a link on any page could trigger Windows diagnostics with arbitrary PowerShell execution.
- **Accept-Language normalization** —set to `en-US,en;q=0.9` at the COM level on every outgoing request. Previously the JS spoof said `en-US` but the actual HTTP header leaked the real system locale —servers could see the mismatch.

### Changed

- **Stopped stripping Sec-Fetch-\* headers** —research confirmed Chromium's network stack overwrites `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, and `Sec-Fetch-User` after the `WebResourceRequested` handler runs. Stripping them was a no-op that wasted CPU on the hottest path in the browser. Removed the loop entirely.
- **Smarter hardwareConcurrency spoof** —was hardcoded to 4, now uses Firefox's RFP logic: returns 8 if real core count >= 8, else 4. Maintains a larger anonymity set while giving web apps enough workers for real work. The old value of 4 was a known Bushido/Brave signature.
- **Per-session canvas noise** —replaced static `d[i] ^ 1` XOR (same noise every time, hashable by trackers) with a per-session PRNG seed. Deterministic within a session (consistent for pages that check twice), unique across sessions (useless for cross-session tracking). Uses a linear congruential generator seeded from `Math.random()` at script injection time.
- **performance.now() clamped** —clamped to 16.67ms intervals (60fps frame boundary) with random jitter of 0–5 additional frames. Prevents Spectre-class timing attacks and high-resolution clock fingerprinting. Matches Firefox RFP's approach.

### Added

- **5 new fingerprint vectors blocked** (total now 23):
  - `speechSynthesis.getVoices()` → empty array (prevents TTS voice fingerprinting —high entropy)
  - `navigator.mediaDevices.enumerateDevices()` → empty array (prevents camera/mic hardware ID leaking)
  - `navigator.storage.estimate()` → fixed 1GB quota, 0 usage (prevents disk usage pattern fingerprinting)
  - `navigator.webdriver` → false (anti-automation detection flag)
  - `performance.memory` → fixed values (Chrome-only heap size fingerprint)
- **toString hardening** —all spoofed prototype methods (canvas, WebGL, AudioContext, performance.now) now return `function () { [native code] }` from `.toString()` and `.toLocaleString()`. Prevents detection by fingerprinting libraries that check whether browser APIs have been monkey-patched.

—-

## v0.8.1

**2026-02-10**

v0.8.0 added web panels, but the WebView2 hardening settings (DevTools, autofill, password save, status bar) were all-or-nothing —hardcoded on or off for every tab. Power users want DevTools. Privacy users want autofill disabled. v0.8.1 puts all 7 hardening options into the Settings page where you can toggle each one individually. All default to OFF so nothing breaks out of the box.

### Added

- **Security Settings section** —7 toggleable WebView2 hardening options in Settings → Security. Each one is OFF by default (power-user friendly). Paranoid users can flip them on:
  - **Disable DevTools** —`SetAreDevToolsEnabled(false)` on the WebView2 COM layer. Prevents F12 / Inspect Element in tabs.
  - **Disable status bar** —`SetIsStatusBarEnabled(false)`. Hides the URL preview on link hover.
  - **Disable autofill** —`SetIsGeneralAutofillEnabled(false)` via `ICoreWebView2Settings4`. Prevents form auto-completion.
  - **Disable password autosave** —`SetIsPasswordAutosaveEnabled(false)`. Browser won't offer to save passwords.
  - **Block service workers** —JS injection that rejects `navigator.serviceWorker.register()`. Prevents SW-based tracker bypass (breaks PWAs).
  - **Block font enumeration** —JS injection that stubs `document.fonts.check()`. Prevents sites from detecting installed fonts.
  - **Spoof CPU core count** —JS injection that reports `navigator.hardwareConcurrency` as 4. Reduces fingerprint surface.
- **Reload banner** —when any security toggle changes, a banner appears: "Reload all tabs to apply changes" with a Reload button. Clicking it destroys and recreates every webview with the new settings. Settings are per-webview (applied at creation time), so existing tabs need a reload to pick up changes.
- **Crash recovery** —`ProcessFailed` COM handler detects renderer crashes, emits `tab-crashed` to React. Crashed tabs show a red "!" badge in the sidebar. Click to destroy and recreate the webview with the same URL.
- **Error boundary** —`react-error-boundary` wraps the entire app. Render errors show fallback UI with "Try again" instead of a white screen.
- **Global rejection handler** —`window.onunhandledrejection` catches fire-and-forget `invoke()` failures. Logs to console instead of silently breaking.

### Security

- **Host objects disabled** —`SetAreHostObjectsAllowed(false)` on every child webview. Prevents pages from accessing projected Rust methods.
- **Always-on header stripping** —`WebResourceRequested` runs for ALL tabs (even with ad blocker off). Strips `Sec-CH-UA-*` (10 variants), `Sec-Fetch-*` (4), `X-Client-Data`, `X-Requested-With`. Referer normalized to origin only.
- **BROWSER_ARGS** —`--disable-quic --site-per-process --origin-agent-cluster=true --disable-dns-prefetch --disable-background-networking --enable-features=ThirdPartyStoragePartitioning,PartitionedCookies --disable-features=UserAgentClientHint`.
- **Process priority** —Rust process boosted to `ABOVE_NORMAL_PRIORITY_CLASS` for UI responsiveness during heavy filtering.
- **Max 50 tabs** —enforced at the top of `create_tab`. Prevents resource exhaustion.

### Changed

- **Settings sections reorganized** —"Privacy" and "Security" are now separate sections. Privacy covers HTTPS-only, ad blocker, cookie rejection, clear-on-exit. Security covers the 7 WebView2 hardening toggles.
- **`WebResourceRequested` restructured** —moved outside the `if block_enabled` gate. Header stripping runs unconditionally; adblock check is conditional inside. Disabling ad blocker no longer disables privacy header stripping.

—-

## v0.8.0

**2026-02-10**

Vivaldi and Opera have sidebar panels. Edge has them too. They're all the same —a tiny webview pinned to the side so you can keep Spotify or Discord open without burning a tab. Bushido does the same thing, but panels get a mobile user agent by default so sites serve mobile layouts at 350px instead of cramming desktop into a phone-width column.

Click "+" in the panel row to pick from presets (Spotify, Discord, WhatsApp, YouTube Music, X) or paste any URL. Click the favicon to toggle. Right-click to remove. Panels persist across restarts. Only one open at a time —it slides between the sidebar and your content area.

### Added

- **Web Panels** —persistent sidebar webviews that survive tab switches. Pin any site as a side panel, toggle with one click. 350px fixed width, positioned between sidebar and content area. Session save/restore included.
- **Mobile UA on panels** —panel webviews get a Chrome Android user agent via `WebviewBuilder::user_agent()`. Sites serve mobile-friendly layouts instead of trying to cram a desktop page into 350px. Regular tabs are unaffected.
- **Panel site picker** —"+" button opens a dropdown with 6 presets and a custom URL input. No more cloning the current tab URL —you pick what goes in the panel.
- **`PanelState` isolation** —panels tracked in a separate `HashSet<String>` so `layout_webviews` doesn't hide them at (-9999, -9999) every time the tab layout recalculates.

### Security

- **URL scheme blocklist** —`javascript:`, `data:`, `file:`, `vbscript:`, `blob:` schemes now blocked in `create_tab`, `navigate_tab`, and the `on_navigation` callback. Defense-in-depth with a React-side `sanitizePanelUrl()` that validates before any `invoke` call.
- **Panel URL sanitization** —strips control characters, rejects dangerous schemes, validates via `URL()` parse. Blocks `bushido://` URLs from being opened as panels (no webview for internal pages).

### Changed

- **`create_tab` takes `is_panel` param** —controls whether the webview gets mobile UA. All 8 call sites updated. Session restore passes `isPanel: true` for restored panels.

—-

## v0.7.0

**2026-02-10**

Every browser tab you open is a separate process talking to the main UI. Until now, those tabs communicated back to Bushido's core by flickering `document.title` —a hack that worked but leaked IPC traffic to every script on the page, raced with real title updates, and capped message size at ~1024 characters. v0.7.0 rips all of that out and replaces it with WebView2's native `postMessage` channel. Zero title flicker, zero race conditions, zero spoofing surface. The title bar is just a title bar again.

Also: split view got a full rewrite. The old version was two panes. The new one is a recursive tree —split horizontally or vertically, up to 4 panes, drag dividers to resize. And there's a media player bar in the sidebar now.

### Added

- **Split View v2** (`Ctrl+\`) —tree-based pane layout. Split any pane horizontally or vertically, up to 4 panes. Drag dividers to resize (min 15% per pane). Session restore preserves your layout. `syncLayout()` replaces all legacy `switch_tab`/`resize_webviews` calls with a single flat-rect layout pass.
- **Media Controls** —sidebar mini player bar. Detects audio/video playing in any tab, shows title + play/pause + mute buttons. Click the bar to switch to that tab. Persists across tab switches. Polling-based detection (1.5s) because YouTube's video element doesn't fire standard events in WebView2 initialization scripts.

### Security

- **postMessage IPC migration** —all child-to-Rust communication (`shortcut_bridge.js`, `media_listener.js`, `detect_video`) migrated from `document.title` encoding to `window.chrome.webview.postMessage`. Registered a `WebMessageReceivedEventHandler` in the WebView2 COM layer alongside the existing download handler. Messages use a `__bushido` JSON namespace with server-side whitelist validation. Eliminates title flicker, race conditions, length limits, and spoofing vectors (Security.txt §6.1).
- **Title sanitization** —`on_document_title_changed` now strips `<` and `>` from all tab titles before emitting to React. Prevents stored XSS via malicious `<title>` tags (§5.1).
- **find_in_page hardening** —added `\n`/`\r` escaping to search queries. Prevents string context breakout in the `window.find()` eval (§3.1).
- **Guard variable hardening** —all 4 injection scripts (`shortcut_bridge.js`, `media_listener.js`, `content_blocker.js`, `cookie_blocker.js`) now use `Object.defineProperty(configurable: false)`. Malicious pages can no longer delete or override the guard to re-inject listeners (§3.2).
- **Download path traversal fix** —`Path::file_name()` extracts only the basename before deduplication. Filenames containing `../` can no longer write outside the download directory (§5.2).
- **Media title sanitization** —React-side tag stripping on `tab-media-state` event payload, matching the pattern used for tab titles.

### Changed

- **`on_document_title_changed` is clean** —no more `__BUSHIDO_MEDIA__`, `__BUSHIDO_VIDEO__`, or `__BUSHIDO_SHORTCUT__` prefix interception. Title handler is a straight pass-through with sanitization.
- **Dead code removed** —`app_title2`, `tab_id_title2` clones, sequence counters, URL encoding/decoding for title IPC —all gone.

—-

## v0.6.1

**2026-02-10**

### Added

- **Split View** (`Ctrl+\`) —two tabs side-by-side, 50/50. Right-click any tab → "split with this tab", or press the shortcut and it picks the most recently used tab. Click the split tab in the sidebar to swap panes. Navigate to an internal page or press `Ctrl+\` again to exit. Each workspace has its own split state, and it persists across restarts.

### Changed

- **Tab suspender skips split tab** —the tab showing in the right pane won't get suspended while it's visible.
- **Opening a new tab exits split** —keeps it simple, you're starting a new task.

—-

## v0.6.0

**2026-02-10**

Chrome and Edge ship with basic ad blockers that catch maybe 30% of what you'd want blocked. Firefox relies on uBlock Origin —which still works, but Manifest V3 has been tightening what extensions can do. Bushido now runs a real content blocking engine at the WebView2 COM level —140,000+ filter rules from EasyList and EasyPrivacy, sub-millisecond matching, and it intercepts requests before the browser even starts the connection. No extension, no flag to enable, no way for page JavaScript to bypass it.

### Added

- **adblock-rust engine** —production-grade content blocking compiled from EasyList + EasyPrivacy (~140k rules). First startup compiles the filter lists in ~400ms and caches the binary to disk. Every startup after that loads in ~5ms. Median per-request matching is 0.041ms —you won't notice it.
- **WebView2 COM-level network blocking** —all sub-resource requests (scripts, images, iframes, XHR, fetch, CSS, fonts, websockets) are intercepted via `WebResourceRequestedEventHandler` before the connection is established. This is unbypassable —page JavaScript can't override it the way it can with fetch/XHR monkey-patching. The old JS injection approach caught maybe 60% of trackers. This catches everything EasyList knows about.
- **Blocked count from Rust** —the shield badge count now comes directly from the COM handler via atomic counter, not from JS title encoding. More accurate, no race conditions, works even when JS is slow to load.

### Changed

- **Content script stripped to cosmetic-only** —all the JavaScript network interception is gone. The page script now only handles things that have to happen in the page: hiding ad containers with CSS, WebRTC leak prevention, fingerprint resistance, and privacy headers. Everything else moved to the native layer where it can't be bypassed.
- **Blocking engine replaced** —the old hardcoded domain list (~250 entries) is gone. The new engine compiles the full EasyList and EasyPrivacy rulesets into an optimized binary format with wildcard matching, resource type filtering, and exception rules. Not even close to the same thing.

### Removed

- `{{BLOCKED_DOMAINS_SET}}` template replacement —no more injecting domain lists into JS
- `__BUSHIDO_BLOCKED__:` title encoding for blocked counts —replaced by Rust-side atomic counter
- All JS-level network interception (fetch override, XHR override, setAttribute override, sendBeacon override, Image.src override, Script.src override, Iframe.src override)

—-

## v0.5.2

**2026-02-10**

Chrome has parallel downloading behind a flag (`chrome://flags/#enable-parallel-downloading`), but it's off by default and most people don't know it exists. Even when enabled, it's a simplified implementation —no crash recovery, no manifest persistence, no cookie-aware resumption. Close Chrome mid-download and your progress is gone. IDM ($25) solves all of this but it's a separate app with a browser extension. Bushido does it natively.

### Added

- **Parallel chunked downloads** —large files (>1MB) split into up to 6 simultaneous segments. Each one grabs its own byte range and writes to the file at the exact offset using `seek_write`. Saturates your bandwidth the way IDM does, except it's built into the browser. No extensions, no separate app, no $25 license fee.
- **Dynamic segment splitting** —when a fast segment finishes early, the orchestrator finds the segment with the most bytes remaining and splits it at the midpoint. New worker picks up the second half. IDM does this too. Zero idle connections means zero wasted bandwidth.
- **Cookie extraction for authenticated downloads** —bushido grabs all cookies for that URL via `ICoreWebView2_2::CookieManager` and passes them to reqwest. Downloading from Google Drive, Dropbox, or anything behind a login actually works. Third-party download managers like IDM and FDM solve this with browser extensions, but that's another thing to install and keep updated. Bushido doesn't need an extension —it is the browser, so cookies are right there.
- **Segment count badge** —download panel shows "6x" (or however many active connections) next to the speed while a chunked download is running. You can see it working.
- **Retry failed downloads** —failed downloads get a retry button right in the panel. Click it and it restarts from scratch.

### Changed

- **Download manifests are v2** —manifests now store per-segment progress and cookies. `#[serde(default)]` on the new fields so v1 manifests still load fine. Pause a chunked download, close the browser, reopen —each segment resumes from where it left off. Most browsers lose your progress if you close mid-download.
- **Small files stay single-stream** —if the server doesn't support Range headers, or the file is under 1MB, it falls back to a single connection. No unnecessary overhead for small stuff.

—-

## v0.5.1

**2026-02-10**

Every major browser ships a download manager, but they're all basically the same —a progress bar, a single connection, and a prayer that your connection holds. Close the browser mid-download? Start over. Bushido's download engine is built from scratch in Rust with pause/resume that actually persists to disk, crash recovery via manifest files, and a UI that stays out of your way.

### Added

- **Download Manager** —bushido intercepts every download via WebView2's `DownloadStarting` COM event. Suppresses the default browser UI, routes it through our own Rust engine. Pause, resume, cancel, open file, open folder. Progress bar, speed readout, ETA. Manifest files (`.part.json`) persist progress to disk so downloads survive crashes —Edge and Chrome don't do this, if the browser closes mid-download you start over. Range header support means paused downloads pick up where they left off, not from byte zero. Filename deduplication handles the `report.pdf` → `report (1).pdf` thing automatically.
- **Download panel** —slide-over panel in the sidebar. Shows all active, paused, completed, and failed downloads. Badge on the download button shows active count. No separate page, no popup that disappears when you click away.
- **Download location setting** —pick your download folder in settings. Optional "ask every time" toggle.

—-

## v0.5.0

**2026-02-09**

### Added

- **New Tab Page** —`bushido://newtab` is a real page now. Clock, greeting that knows what time of day it is, search bar, top sites grid. All React-rendered, no webview spawned. Toggle any of it off in settings.
- **Command Palette** (`Ctrl+K`) —type to search your tabs, bookmarks, history, or pick from 7 actions. Fuzzy matching, arrow keys, enter to go. Shows recent stuff when you haven't typed anything yet.
- **Reader Mode** (`Ctrl+Shift+R`) —strips pages down to just the text and images. Pick your font, theme (dark/light/sepia), line width. Click again to exit.
- **Picture-in-Picture** —bushido watches for videos on the page. When it finds one, PiP button shows up in the sidebar. One click, video pops out. Shadow DOM so sites can't block the button.
- **Tab Suspender** —tabs you haven't touched in 5 minutes get put to sleep. Webview destroyed, zzz badge on the tab. Click it and it comes back. Pinned tabs never sleep.
- **Settings** (`bushido://settings`) —gear icon in sidebar. Search engine, startup behavior, privacy toggles, download location, appearance, shortcuts reference, about. Saved to disk, loads before anything else on startup.
- **Search engine selector** —swap between Google, DuckDuckGo, Brave, Bing, or drop in your own URL. Works in the URL bar and the NTP search.
- **Clear data on exit** —toggle in privacy settings. When enabled, clears browsing data when you close the browser.

### Changed

- **Settings aren't fake anymore** —every toggle does what it says. Turn off ad blocker? Content scripts stop injecting. Turn off HTTPS-only? HTTP works again. Set startup to "new tab"? Session doesn't restore. All of it flows through to Rust.
- **Settings load first** —`Promise.all` grabs settings and session in parallel, but settings get applied before any tabs are created. No more race condition.
- **Compact mode stays in sync** —flip it in settings, `Ctrl+Shift+B` knows. Flip it with the shortcut, settings knows. They're the same state now.
- **Suspend timeout is configurable** —was hardcoded to 5 minutes, now reads from settings. Set it to 30 or turn it off entirely.

### Security

- **CSP locked down** —strict policy in tauri.conf.json. Separate `devCsp` so Vite HMR still works during dev.
- **Killed `tauri-plugin-shell`** —replaced with `tauri-plugin-opener`. The old one had a CVE (CVE-2025-31477).
- **Nuked `eval_tab`** —used to let the frontend run arbitrary JS on any webview. Replaced with 3 named commands (`detect_video`, `toggle_reader`, `toggle_pip`). That's it, nothing else gets evaled.
- **Title sanitization** —HTML tags get stripped from tab titles. No more `<script>` in your tab name.

—-

## v0.4.0

**2026-02-09**

### Changed

- **Killed the toolbar** —everything lives in the sidebar now. Nav buttons, URL bar, shield, bookmarks. Zen-style vertical layout. Webview gets the full height, titlebar is just the page title + window controls.
- **Sidebar is 300px** —was 260. URL bar is 38px tall, flat and transparent. Search icon instead of a lock. No inset shadows, no glow rings.
- **Nav buttons are ghost-style** —no background or border, just icons. Back/forward sit together, reload pushed right. Matches everything else in the sidebar.
- **Nuked every `transition: all`** —26 of them. Each one now lists only the properties that actually change. Browser doesn't have to watch everything anymore.

### Added

- **Top sites grid** —click the URL bar and your 8 most-visited sites pop up in a 4×2 grid with favicons. Frecency-ranked. Falls back to defaults (Google, YouTube, GitHub, etc.) if you're fresh.
- **Extensions panel** —little icon in the URL bar opens a Zen-style dropdown. Quick actions row (bookmark, screenshot, reader, share), extensions grid with the shield blocker, "+" button. "Manage" link fades in on hover.
- **History** (`Ctrl+H`) —slide-over panel with search, date grouping, clear by range.
- **Bookmarks** (`Ctrl+D`) —star in sidebar header, collapsible section, right-click to remove.
- **Frecency suggestions** —type in the URL bar and get ranked results from history + bookmarks. Arrow keys to navigate.

### Removed

- `Toolbar.tsx` —absorbed into Sidebar
- Tab search input —URL bar filters tabs when focused now
- "TABS" / "pinned" section labels and count badges
- `--toolbar-height` CSS variable

—-

## v0.3.1

**2026-02-08**

### Changed

- **Sidebar virtualization** —tab list only renders what's visible now. Doesn't matter if you have 10 tabs or 200, the sidebar stays fast. Scroll is smooth because we're not asking React to paint 200 DOM nodes.
- **Memoized everything that matters** —derived state, tree building, filtered lists, callback props. Components don't re-render unless their actual data changed. Toolbar doesn't flinch when the sidebar updates.
- **Progress bar runs on the GPU now** —was animating `width` and `left` which triggers layout reflow every frame. Switched to `transform: translateX() scaleX()`. Composited, no jank.
- **Event listener cleanup actually works** —Tauri's `listen()` returns a promise. Old code pushed unlisten functions after resolve, so if the component unmounted fast enough they'd leak. Fixed.
- **Vite builds are tighter** —target `esnext` instead of es2021, manual chunks split React and Tauri into separate bundles

### Added

- **Live changelog on the landing page** —release notes page fetches `CHANGELOG.md` straight from this repo at runtime. One source of truth, no manual sync, no redeploy needed to update.

—-

## v0.3.0

**2026-02-08** | [Compare](https://github.com/visualstudioblyat/bushido/compare/84a9d35...d4e31de)

### Added

- **Compact Mode** (`Ctrl+Shift+B`) —sidebar collapses to a peek strip, hover left edge to reveal. Toolbar auto-hides. Works even when a webpage has focus.
- **Workspaces** —colored dot switcher, `Ctrl+1-9` to jump, drag tabs between workspaces. Right-click to rename, recolor, delete.
- **Tab Search** —filter by title or URL
- **Tree Tabs** —nest tabs, collapse/expand branches, "open child tab" in context menu
- **Shield Whitelist** —click shield to disable blocking per-site, persisted to disk

### Theme

- Spring easing micro-interactions on tabs, buttons, pinned items
- Frosted glass context menus with `backdrop-filter: blur(24px)`
- Breathing glow on active tab indicator
- Rounded window corners, inset light borders, layered shadows
- Scrollbar thumb hidden until hover

### Changed

- Sidebar layout is now absolute-positioned with a flex spacer —no native resize calls on toggle
- Session format upgraded to workspace-aware (backwards compatible)
- Ad blocker conditionally injected per whitelist

—-

## v0.2.0

**2026-02-08**

### Added

- Ad & tracker blocking (~1000 domains)
- Content blocker —fetch/XHR override, CSS hiding, DOM mutation observer
- Cookie banner auto-rejection (8+ frameworks)
- HTTPS-only mode
- Shield badge with blocked count
- Privacy headers, WebRTC leak prevention

—-

## v0.1.0

**2026-02-07**

### Added

- Tauri v2 + React/TypeScript shell
- Tab management, pinning, drag reorder, context menus
- Sidebar, toolbar, URL bar, find in page
- Session save/restore
- Custom app icon
