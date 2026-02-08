<p align="center">
  <img src="logo.png" alt="Bushido Logo" width="128" height="128">
</p>

<h1 align="center">Bushido Browser</h1>

<p align="center">
  <strong>Browse with Discipline.</strong>
</p>

<p align="center">
  <a href="https://github.com/visualstudioblyat/bushido/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
  <a href="https://github.com/visualstudioblyat/bushido/issues"><img alt="Issues" src="https://img.shields.io/github/issues/visualstudioblyat/bushido?style=flat-square&color=6366f1"></a>
</p>

<p align="center">
  Bushido is a privacy-first browser built on Tauri with native ad blocking, cookie banner rejection, and HTTPS-only mode — no extensions needed.
</p>

<p align="center">
  <a href="https://github.com/visualstudioblyat/bushido/releases">Download</a> •
  <a href="https://github.com/visualstudioblyat/bushido/issues">Report Bug</a> •
  <a href="https://github.com/visualstudioblyat/bushido/discussions">Feature Request</a>
</p>

---

## Why Bushido?

Google killed ad blockers with Manifest V3. Bushido doesn't care — blocking is built into the browser core, not an extension that can be neutered.

- **Native Ad & Tracker Blocking** — 2000+ domains blocked at the network and JS level. No extensions to install, no rules to configure.
- **Cookie Banner Rejection** — Automatically clicks "Reject All" on consent popups across 8+ frameworks. You never see them.
- **HTTPS-Only Mode** — All traffic upgraded to HTTPS. HTTP connections are refused.
- **Vertical Tab Sidebar** — Drag, pin, reorder. Session restore built in.
- **Minimal UI** — No bloat, no crypto wallets, no AI assistants, no sponsored tiles.

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React + TypeScript |
| Rendering | System WebView (WebView2 / WebKit) |
| Blocking | Rust `HashSet` + JS injection |

## Building from Source

```bash
# prerequisites: node.js, rust, tauri cli
npm install
npx tauri dev
```

## Contributing

Bushido is open source under the [MPL 2.0](LICENSE) license. Contributions welcome — open an issue or submit a PR.

## Roadmap

- [ ] Expanded filter lists (EasyList/EasyPrivacy integration)
- [ ] Workspaces & profile isolation
- [ ] Fingerprinting protection
- [ ] Custom themes
- [ ] Cross-platform builds (macOS, Linux)
