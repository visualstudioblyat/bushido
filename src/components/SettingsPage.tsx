import { memo, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BushidoSettings, DEFAULT_SETTINGS } from "../types";
import PairingWizard from "./PairingWizard";

interface Props {
  settings: BushidoSettings;
  onUpdate: (patch: Partial<BushidoSettings>) => void;
  onReloadAllTabs: () => void;
  onThemeChange: (accent: string, mode: "dark" | "light") => void;
}

const SEARCH_ENGINES: { value: BushidoSettings["searchEngine"]; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "brave", label: "Brave Search" },
  { value: "bing", label: "Bing" },
  { value: "custom", label: "Custom" },
];

const SUSPEND_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 0, label: "Never" },
];

const ZOOM_OPTIONS: { value: number; label: string }[] = [
  { value: 80, label: "80%" },
  { value: 90, label: "90%" },
  { value: 100, label: "100%" },
  { value: 110, label: "110%" },
  { value: 125, label: "125%" },
  { value: 150, label: "150%" },
];

const TOP_SITE_ROW_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 row" },
  { value: 2, label: "2 rows" },
  { value: 3, label: "3 rows" },
];

const AUTOPLAY_OPTIONS: { value: BushidoSettings["autoplayPolicy"]; label: string }[] = [
  { value: "block-all", label: "Block all media" },
  { value: "block-audio", label: "Block audio only" },
  { value: "allow", label: "Allow" },
];

const SHORTCUT_GROUPS: { group: string; items: { action: string; desc: string }[] }[] = [
  { group: "Tab Management", items: [
    { action: "new-tab", desc: "New tab" },
    { action: "close-tab", desc: "Close tab" },
    { action: "reopen-tab", desc: "Reopen closed tab" },
  ]},
  { group: "Navigation", items: [
    { action: "focus-url", desc: "Focus address bar" },
    { action: "find", desc: "Find in page" },
    { action: "command-palette", desc: "Command palette" },
    { action: "reload", desc: "Reload page" },
    { action: "fullscreen", desc: "Toggle fullscreen" },
  ]},
  { group: "Features", items: [
    { action: "bookmark", desc: "Bookmark page" },
    { action: "history", desc: "History" },
    { action: "downloads", desc: "Downloads" },
    { action: "toggle-compact", desc: "Compact mode" },
    { action: "reader-mode", desc: "Reader mode" },
    { action: "devtools", desc: "Developer tools" },
    { action: "split-view", desc: "Split view" },
    { action: "print", desc: "Print page" },
    { action: "screenshot", desc: "Screenshot" },
  ]},
  { group: "Zoom", items: [
    { action: "zoom-in", desc: "Zoom in" },
    { action: "zoom-out", desc: "Zoom out" },
    { action: "zoom-reset", desc: "Reset zoom" },
  ]},
];

/** Build a combo string from a KeyboardEvent, e.g. "Ctrl+Shift+T" */
function comboFromEvent(e: KeyboardEvent): string | null {
  // Ignore lone modifier keys
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  // Normalize key names
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key === "Escape") return null; // Escape cancels recording
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("+");
}

const TABS = [
  { id: "general", label: "General" },
  { id: "newtab", label: "New Tab" },
  { id: "downloads", label: "Downloads" },
  { id: "tabs", label: "Tabs" },
  { id: "privacy", label: "Privacy" },
  { id: "security", label: "Security" },
  { id: "permissions", label: "Permissions" },
  { id: "appearance", label: "Appearance" },
  { id: "sync", label: "Sync" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
] as const;

type TabId = typeof TABS[number]["id"];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`settings-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function Select({ value, options, onChange }: { value: string | number; options: { value: string | number; label: string }[]; onChange: (v: any) => void }) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={e => {
        const opt = options.find(o => String(o.value) === e.target.value);
        onChange(opt ? opt.value : e.target.value);
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

const ACCENT_COLORS = [
  "#6366f1", "#f43f5e", "#22c55e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#14b8a6",
];

const SECURITY_KEYS: (keyof BushidoSettings)[] = [
  "disableDevTools", "disableStatusBar", "disableAutofill", "disablePasswordSave",
  "blockServiceWorkers", "blockFontEnumeration", "spoofHardwareConcurrency",
];

interface SyncPeer {
  device_id: string;
  name: string;
  fingerprint: string;
  addresses: string[];
  port: number;
}

interface SyncInfo {
  enabled: boolean;
  device_id: string;
  device_name: string;
  fingerprint: string;
  status: string | { Error: { message: string } };
  peers: SyncPeer[];
  paired_devices: { device_id: string; name: string; fingerprint: string; paired_at: number }[];
}

export default memo(function SettingsPage({ settings, onUpdate, onReloadAllTabs, onThemeChange }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [securityDirty, setSecurityDirty] = useState(false);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [pairingWizard, setPairingWizard] = useState<{
    mode: "initiator" | "responder";
    peerDeviceId: string;
    peerDeviceName: string;
    code?: string;
  } | null>(null);
  const [simulateCode, setSimulateCode] = useState<string | null>(null);
  const [syncTypes, setSyncTypes] = useState({ bookmarks: true, history: true, settings: true, tabs: true });
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  useEffect(() => {
    invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
  }, [settings.syncEnabled]);

  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(listen<SyncPeer>("peer-discovered", () => {
      invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
    }));
    unsubs.push(listen<string>("peer-removed", () => {
      invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
    }));
    unsubs.push(listen<{ device_id: string; device_name: string }>("pair-request-received", e => {
      setPairingWizard({
        mode: "responder",
        peerDeviceId: e.payload.device_id,
        peerDeviceName: e.payload.device_name,
      });
    }));
    unsubs.push(listen("pair-complete", () => {
      invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
      setSimulateCode(null);
    }));
    return () => { unsubs.forEach(p => p.then(fn => fn())); };
  }, []);

  // Shortcut recording: listen for keydown when an action is being recorded
  useEffect(() => {
    if (!recordingAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) {
        // Escape or lone modifier — cancel
        if (e.key === "Escape") setRecordingAction(null);
        return;
      }

      const kb = settings.keybindings;

      // Conflict detection: check if another action already uses this combo
      const conflicting = Object.entries(kb).find(
        ([act, c]) => act !== recordingAction && c.toLowerCase() === combo.toLowerCase()
      );
      if (conflicting) {
        // Don't rebind — flash or ignore. Just cancel.
        setRecordingAction(null);
        return;
      }

      const oldCombo = kb[recordingAction];
      const newBindings = { ...kb, [recordingAction]: combo };

      // Call Rust to rebind the OS-level shortcut
      invoke("rebind_shortcut", {
        action: recordingAction,
        oldCombo: oldCombo,
        newCombo: combo,
      }).catch(err => console.error("Rebind failed:", err));

      // Update settings
      onUpdate({ keybindings: newBindings });
      setRecordingAction(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingAction, settings.keybindings, onUpdate]);

  const set = useCallback(<K extends keyof BushidoSettings>(key: K, value: BushidoSettings[K]) => {
    onUpdate({ [key]: value });
    if (SECURITY_KEYS.includes(key)) setSecurityDirty(true);
  }, [onUpdate]);

  const renderGeneral = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">General</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>Search engine</span>
        </div>
        <Select
          value={settings.searchEngine}
          options={SEARCH_ENGINES}
          onChange={(v: BushidoSettings["searchEngine"]) => set("searchEngine", v)}
        />
      </div>
      {settings.searchEngine === "custom" && (
        <div className="settings-row">
          <div className="settings-label">
            <span>Custom search URL</span>
            <span className="settings-hint">Use %s for the query</span>
          </div>
          <input
            className="settings-input"
            value={settings.customSearchUrl}
            onChange={e => set("customSearchUrl", e.target.value)}
            placeholder="https://search.example.com/?q=%s"
            spellCheck={false}
          />
        </div>
      )}
      <div className="settings-row">
        <div className="settings-label">
          <span>Search suggestions</span>
          <span className="settings-hint">Show search suggestions as you type</span>
        </div>
        <Toggle checked={settings.searchSuggestions} onChange={v => set("searchSuggestions", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>On startup</span>
        </div>
        <Select
          value={settings.onStartup}
          options={[
            { value: "restore", label: "Restore previous session" },
            { value: "newtab", label: "Open new tab" },
            { value: "custom", label: "Open specific page" },
          ]}
          onChange={(v: BushidoSettings["onStartup"]) => set("onStartup", v)}
        />
      </div>
      {settings.onStartup === "custom" && (
        <div className="settings-row">
          <div className="settings-label">
            <span>Homepage URL</span>
            <span className="settings-hint">Opens this page on startup</span>
          </div>
          <input
            className="settings-input"
            value={settings.customHomepageUrl}
            onChange={e => set("customHomepageUrl", e.target.value)}
            placeholder="https://example.com"
            spellCheck={false}
          />
        </div>
      )}
      <div className="settings-row">
        <div className="settings-label">
          <span>Default zoom level</span>
          <span className="settings-hint">Applied to new tabs</span>
        </div>
        <Select
          value={settings.defaultZoom}
          options={ZOOM_OPTIONS}
          onChange={(v: number) => set("defaultZoom", v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Confirm before quitting</span>
          <span className="settings-hint">Show a confirmation dialog when closing the browser</span>
        </div>
        <Toggle checked={settings.confirmBeforeQuit} onChange={v => set("confirmBeforeQuit", v)} />
      </div>
    </section>
  );

  const renderNewTab = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">New Tab</h2>
      <div className="settings-row">
        <div className="settings-label"><span>Show top sites</span></div>
        <Toggle checked={settings.showTopSites} onChange={v => set("showTopSites", v)} />
      </div>
      {settings.showTopSites && (
        <div className="settings-row">
          <div className="settings-label">
            <span>Top sites rows</span>
            <span className="settings-hint">Number of rows in the frecency grid</span>
          </div>
          <Select
            value={settings.topSiteRows}
            options={TOP_SITE_ROW_OPTIONS}
            onChange={(v: number) => set("topSiteRows", v)}
          />
        </div>
      )}
      <div className="settings-row">
        <div className="settings-label"><span>Show clock</span></div>
        <Toggle checked={settings.showClock} onChange={v => set("showClock", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label"><span>Show greeting</span></div>
        <Toggle checked={settings.showGreeting} onChange={v => set("showGreeting", v)} />
      </div>
    </section>
  );

  const renderDownloads = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Downloads</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>Download location</span>
          <span className="settings-hint">{settings.downloadLocation || "System default"}</span>
        </div>
        <input
          className="settings-input"
          value={settings.downloadLocation}
          onChange={e => set("downloadLocation", e.target.value)}
          placeholder="System default"
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label"><span>Ask where to save</span></div>
        <Toggle checked={settings.askDownloadLocation} onChange={v => set("askDownloadLocation", v)} />
      </div>
    </section>
  );

  const renderTabs = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Tabs</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>Tab suspend timeout</span>
          <span className="settings-hint">Suspend inactive tabs after this time</span>
        </div>
        <Select
          value={settings.suspendTimeout}
          options={SUSPEND_OPTIONS}
          onChange={(v: number) => set("suspendTimeout", v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Suspend excluded URLs</span>
          <span className="settings-hint">One URL per line. Tabs matching these won't be suspended.</span>
        </div>
        <textarea
          className="settings-textarea"
          value={settings.suspendExcludedUrls}
          onChange={e => set("suspendExcludedUrls", e.target.value)}
          placeholder={"mail.google.com\nspotify.com"}
          spellCheck={false}
          rows={3}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Select recently used tab on close</span>
          <span className="settings-hint">Switch to the last active tab instead of the adjacent one</span>
        </div>
        <Toggle checked={settings.selectRecentTabOnClose} onChange={v => set("selectRecentTabOnClose", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Confirm before closing multiple tabs</span>
          <span className="settings-hint">Show a warning when closing more than one tab at once</span>
        </div>
        <Toggle checked={settings.confirmCloseMultiple} onChange={v => set("confirmCloseMultiple", v)} />
      </div>
    </section>
  );

  const renderPrivacy = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Privacy</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>HTTPS-only mode</span>
          <span className="settings-hint">Upgrade all connections to HTTPS</span>
        </div>
        <Toggle checked={settings.httpsOnly} onChange={v => set("httpsOnly", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Ad blocker</span>
          <span className="settings-hint">Block ads and trackers</span>
        </div>
        <Toggle checked={settings.adBlocker} onChange={v => set("adBlocker", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Cookie banner auto-reject</span>
          <span className="settings-hint">Automatically dismiss cookie consent popups</span>
        </div>
        <Toggle checked={settings.cookieAutoReject} onChange={v => set("cookieAutoReject", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Clear data on exit</span>
          <span className="settings-hint">Clear history and cookies when closing the browser</span>
        </div>
        <Toggle checked={settings.clearDataOnExit} onChange={v => set("clearDataOnExit", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Block pop-ups</span>
          <span className="settings-hint">Prevent sites from opening new windows</span>
        </div>
        <Toggle checked={settings.blockPopups} onChange={v => set("blockPopups", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Block autoplay</span>
          <span className="settings-hint">Control media autoplay behavior</span>
        </div>
        <Select
          value={settings.autoplayPolicy}
          options={AUTOPLAY_OPTIONS}
          onChange={(v: BushidoSettings["autoplayPolicy"]) => set("autoplayPolicy", v)}
        />
      </div>
    </section>
  );

  const renderSecurity = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Security</h2>
      {securityDirty && (
        <div className="settings-reload-banner">
          <span>Reload all tabs to apply changes</span>
          <button className="settings-reload-btn" onClick={() => { onReloadAllTabs(); setSecurityDirty(false); }}>Reload</button>
        </div>
      )}
      <div className="settings-row">
        <div className="settings-label">
          <span>Disable DevTools</span>
          <span className="settings-hint">Prevents F12 / Inspect Element in tabs</span>
        </div>
        <Toggle checked={settings.disableDevTools} onChange={v => set("disableDevTools", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Disable status bar</span>
          <span className="settings-hint">Hides URL preview on link hover</span>
        </div>
        <Toggle checked={settings.disableStatusBar} onChange={v => set("disableStatusBar", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Disable autofill</span>
          <span className="settings-hint">Prevents form auto-completion</span>
        </div>
        <Toggle checked={settings.disableAutofill} onChange={v => set("disableAutofill", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Disable password autosave</span>
          <span className="settings-hint">Browser won't offer to save passwords</span>
        </div>
        <Toggle checked={settings.disablePasswordSave} onChange={v => set("disablePasswordSave", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Block service workers</span>
          <span className="settings-hint">Prevents sites from registering service workers (breaks PWAs)</span>
        </div>
        <Toggle checked={settings.blockServiceWorkers} onChange={v => set("blockServiceWorkers", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Block font enumeration</span>
          <span className="settings-hint">Prevents sites from detecting installed fonts</span>
        </div>
        <Toggle checked={settings.blockFontEnumeration} onChange={v => set("blockFontEnumeration", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Spoof CPU core count</span>
          <span className="settings-hint">Reports 4 cores instead of real count</span>
        </div>
        <Toggle checked={settings.spoofHardwareConcurrency} onChange={v => set("spoofHardwareConcurrency", v)} />
      </div>
    </section>
  );

  const renderPermissions = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Permissions</h2>
      <p className="settings-info-text">
        Permission prompts for camera, microphone, location, and notifications coming in a future update.
      </p>
    </section>
  );

  const renderAppearance = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Appearance</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>Accent color</span>
          <span className="settings-hint">Applied across the entire UI</span>
        </div>
        <div className="settings-colors">
          {ACCENT_COLORS.map(c => (
            <button
              key={c}
              className={`settings-color-dot${settings.accentColor === c ? " active" : ""}`}
              style={{ background: c }}
              onClick={() => onThemeChange(c, settings.themeMode)}
            />
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Theme</span>
          <span className="settings-hint">Dark or light mode</span>
        </div>
        <Select
          value={settings.themeMode}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(v: "dark" | "light") => onThemeChange(settings.accentColor, v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Compact mode</span>
          <span className="settings-hint">Auto-hide sidebar (Ctrl+Shift+B)</span>
        </div>
        <Toggle checked={settings.compactMode} onChange={v => set("compactMode", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Show media controls</span>
          <span className="settings-hint">Display the mini player in the sidebar</span>
        </div>
        <Toggle checked={settings.showMediaControls} onChange={v => set("showMediaControls", v)} />
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <span>Show domain only in URL bar</span>
          <span className="settings-hint">Hide the full path, show just the domain</span>
        </div>
        <Toggle checked={settings.showDomainOnly} onChange={v => set("showDomainOnly", v)} />
      </div>
    </section>
  );

  const renderSync = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">Sync</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>Enable LAN sync</span>
          <span className="settings-hint">Sync bookmarks, history, and settings between devices on your local network</span>
        </div>
        <Toggle checked={settings.syncEnabled} onChange={async v => {
          if (syncLoading) return;
          setSyncLoading(true);
          try {
            if (v) {
              const name = settings.syncDeviceName || (await invoke<SyncInfo>("get_sync_status").catch(() => null))?.device_name || "My PC";
              const info = await invoke<SyncInfo>("enable_sync", { deviceName: name });
              setSyncInfo(info);
              onUpdate({ syncEnabled: true, syncDeviceName: name });
            } else {
              await invoke("disable_sync");
              onUpdate({ syncEnabled: false });
              setSyncInfo(null);
            }
          } catch (e) {
            console.error("Sync toggle failed:", e);
          }
          setSyncLoading(false);
        }} />
      </div>
      {settings.syncEnabled && syncInfo && (
        <>
          <div className="settings-row">
            <div className="settings-label">
              <span>Device name</span>
              <span className="settings-hint">How this device appears to others</span>
            </div>
            <input
              className="settings-input"
              value={settings.syncDeviceName}
              onChange={e => {
                onUpdate({ syncDeviceName: e.target.value });
                invoke("set_device_name", { name: e.target.value }).catch(() => {});
              }}
              placeholder="My PC"
              spellCheck={false}
            />
          </div>
          <div className="settings-row">
            <div className="settings-label">
              <span>Device fingerprint</span>
              <span className="settings-hint">Unique identifier for pairing verification</span>
            </div>
            <span className="settings-mono">{syncInfo.fingerprint || "—"}</span>
          </div>
          <div className="settings-row">
            <div className="settings-label">
              <span>Status</span>
            </div>
            <span className="settings-sync-status">
              {typeof syncInfo.status === "string"
                ? syncInfo.status
                : syncInfo.status?.Error
                  ? `Error: ${(syncInfo.status as any).Error.message}`
                  : "Unknown"
              }
            </span>
          </div>
          {syncInfo.peers.length > 0 && (
            <div className="settings-subsection">
              <h3 className="settings-subsection-title">Discovered Devices</h3>
              {syncInfo.peers.map(p => (
                <div key={p.device_id} className="settings-peer-row">
                  <div className="settings-peer-info">
                    <span className="settings-peer-name">{p.name || "Unknown"}</span>
                    <span className="settings-peer-fp">{p.fingerprint}</span>
                    <span className="settings-peer-addr">{p.addresses[0]}:{p.port}</span>
                  </div>
                  <button className="settings-about-btn" onClick={async () => {
                    try {
                      const code = await invoke<string>("start_pairing", { peerId: p.device_id });
                      setPairingWizard({
                        mode: "initiator",
                        peerDeviceId: p.device_id,
                        peerDeviceName: p.name,
                        code,
                      });
                    } catch (e) {
                      console.error("Failed to start pairing:", e);
                    }
                  }}>
                    Pair
                  </button>
                </div>
              ))}
            </div>
          )}
          {syncInfo.peers.length === 0 && (
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-hint" style={{ fontStyle: "italic" }}>
                  {syncLoading ? "Starting sync service..." : "Searching for devices on your network..."}
                </span>
              </div>
            </div>
          )}
          {syncInfo.paired_devices.length > 0 && (
            <div className="settings-subsection">
              <h3 className="settings-subsection-title">Paired Devices</h3>
              {syncInfo.paired_devices.map(d => (
                <div key={d.device_id} className="settings-peer-row">
                  <div className="settings-peer-info">
                    <span className="settings-peer-name">{d.name}</span>
                    <span className="settings-peer-fp">{d.fingerprint}</span>
                    <span className="settings-peer-addr">
                      Paired {new Date(d.paired_at * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <button className="settings-remove-btn" onClick={async () => {
                    try {
                      await invoke("remove_device", { deviceId: d.device_id });
                      invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
                    } catch (e) {
                      console.error("Failed to remove device:", e);
                    }
                  }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="settings-subsection">
            <h3 className="settings-subsection-title">Data Types</h3>
            <div className="settings-row">
              <div className="settings-label"><span>Sync bookmarks</span></div>
              <Toggle checked={syncTypes.bookmarks} onChange={v => {
                const next = { ...syncTypes, bookmarks: v };
                setSyncTypes(next);
                invoke("sync_set_data_types", next).catch(() => {});
              }} />
            </div>
            <div className="settings-row">
              <div className="settings-label"><span>Sync history</span></div>
              <Toggle checked={syncTypes.history} onChange={v => {
                const next = { ...syncTypes, history: v };
                setSyncTypes(next);
                invoke("sync_set_data_types", next).catch(() => {});
              }} />
            </div>
            <div className="settings-row">
              <div className="settings-label"><span>Sync settings</span></div>
              <Toggle checked={syncTypes.settings} onChange={v => {
                const next = { ...syncTypes, settings: v };
                setSyncTypes(next);
                invoke("sync_set_data_types", next).catch(() => {});
              }} />
            </div>
            <div className="settings-row">
              <div className="settings-label"><span>Sync open tabs</span></div>
              <Toggle checked={syncTypes.tabs} onChange={v => {
                const next = { ...syncTypes, tabs: v };
                setSyncTypes(next);
                invoke("sync_set_data_types", next).catch(() => {});
              }} />
            </div>
          </div>
          <div className="settings-subsection">
            <h3 className="settings-subsection-title">Danger Zone</h3>
            <div className="settings-row">
              <div className="settings-label">
                <span>Reset sync data</span>
                <span className="settings-hint">Backs up current sync data and starts fresh. Bookmarks are preserved locally.</span>
              </div>
              <button className="settings-remove-btn" onClick={async () => {
                if (!confirm("Reset all sync data? Local data is preserved, but the CRDT history is wiped.")) return;
                try {
                  await invoke("reset_sync_data");
                  invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
                } catch (e) {
                  console.error("Reset failed:", e);
                }
              }}>
                Reset
              </button>
            </div>
          </div>
          <div className="settings-subsection">
            <h3 className="settings-subsection-title">Debug</h3>
            <div className="settings-row">
              <div className="settings-label">
                <span>Loopback pairing test</span>
                <span className="settings-hint">Spawn a fake device on localhost and run real SPAKE2 pairing</span>
              </div>
              <button className="settings-about-btn" onClick={async () => {
                try {
                  setSimulateCode(null);
                  const result = await invoke<{ device_id: string; device_name: string; code: string }>("simulate_pairing");
                  setSimulateCode(result.code);
                } catch (e) {
                  console.error("Simulate failed:", e);
                }
              }}>
                Simulate Peer
              </button>
            </div>
            {simulateCode && (
              <div className="settings-row">
                <div className="settings-label">
                  <span>Enter this code when prompted</span>
                </div>
                <span className="settings-mono" style={{ color: "var(--accent)", fontSize: 18, letterSpacing: 4 }}>{simulateCode}</span>
              </div>
            )}
            <div className="settings-row">
              <div className="settings-label">
                <span>Loopback sync test</span>
                <span className="settings-hint">Pair a ghost device then sync 3 sample bookmarks over Noise + Loro</span>
              </div>
              <button className="settings-about-btn" onClick={async () => {
                try {
                  setSimulateCode(null);
                  const result = await invoke<{ device_id: string; device_name: string; code: string; info: string }>("simulate_sync");
                  setSimulateCode(result.code);
                } catch (e) {
                  console.error("Simulate sync failed:", e);
                }
              }}>
                Simulate Sync
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );

  const renderShortcuts = () => {
    const kb = settings.keybindings;
    const isDefault = JSON.stringify(kb) === JSON.stringify(DEFAULT_SETTINGS.keybindings);

    return (
      <section className="settings-section">
        <h2 className="settings-section-title">Keyboard Shortcuts</h2>
        <p className="settings-hint" style={{ marginBottom: 12 }}>
          Click a shortcut to rebind it. Press Escape to cancel.
        </p>
        <div className="settings-shortcuts">
          {SHORTCUT_GROUPS.map(({ group, items }) => (
            <div key={group}>
              <div className="settings-shortcut-group">{group}</div>
              {items.map(({ action, desc }) => (
                <div
                  key={action}
                  className={`settings-shortcut-row settings-shortcut-rebindable${recordingAction === action ? " recording" : ""}`}
                  onClick={() => setRecordingAction(recordingAction === action ? null : action)}
                >
                  <span className="settings-shortcut-desc">{desc}</span>
                  <kbd className={`settings-kbd${recordingAction === action ? " recording" : ""}`}>
                    {recordingAction === action ? "Press keys..." : (kb[action] || "Unset")}
                  </kbd>
                </div>
              ))}
            </div>
          ))}

          <div className="settings-shortcut-group">Workspaces</div>
          <div className="settings-shortcut-row">
            <span className="settings-shortcut-desc">Switch workspace</span>
            <kbd className="settings-kbd">Ctrl+1–9</kbd>
          </div>
        </div>
        {!isDefault && (
          <button
            className="settings-about-btn"
            style={{ marginTop: 16 }}
            onClick={async () => {
              // Reset all shortcuts to defaults
              const defaults = DEFAULT_SETTINGS.keybindings;
              for (const [action, combo] of Object.entries(defaults)) {
                const oldCombo = kb[action];
                if (oldCombo && oldCombo !== combo) {
                  await invoke("rebind_shortcut", { action, oldCombo, newCombo: combo }).catch(() => {});
                }
              }
              onUpdate({ keybindings: { ...defaults } });
            }}
          >
            Reset to defaults
          </button>
        )}
      </section>
    );
  };

  const renderAbout = () => (
    <section className="settings-section">
      <h2 className="settings-section-title">About</h2>
      <div className="settings-about">
        <div className="settings-about-name">Bushido Browser</div>
        <div className="settings-about-version">v0.10.0</div>
        <div className="settings-about-desc">A minimal, privacy-focused browser built with Tauri.</div>
        <button
          className="settings-about-btn"
          style={{ marginTop: 12 }}
          onClick={() => {
            onUpdate({ onboardingComplete: false });
            setTimeout(() => window.location.reload(), 600);
          }}
        >Replay Onboarding</button>
      </div>
    </section>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "general": return renderGeneral();
      case "newtab": return renderNewTab();
      case "downloads": return renderDownloads();
      case "tabs": return renderTabs();
      case "privacy": return renderPrivacy();
      case "security": return renderSecurity();
      case "permissions": return renderPermissions();
      case "appearance": return renderAppearance();
      case "sync": return renderSync();
      case "shortcuts": return renderShortcuts();
      case "about": return renderAbout();
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`settings-nav-item${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {renderContent()}
        </div>
      </div>

      {pairingWizard && (
        <PairingWizard
          mode={pairingWizard.mode}
          peerDeviceId={pairingWizard.peerDeviceId}
          peerDeviceName={pairingWizard.peerDeviceName}
          code={pairingWizard.code}
          onClose={() => setPairingWizard(null)}
        />
      )}
    </div>
  );
});
