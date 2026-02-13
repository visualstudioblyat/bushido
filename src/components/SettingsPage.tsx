import { memo, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BushidoSettings } from "../types";
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

const SHORTCUTS = [
  { keys: "Ctrl+T", desc: "New tab" },
  { keys: "Ctrl+W", desc: "Close tab" },
  { keys: "Ctrl+K", desc: "Command palette" },
  { keys: "Ctrl+L", desc: "Focus address bar" },
  { keys: "Ctrl+F", desc: "Find in page" },
  { keys: "Ctrl+D", desc: "Bookmark page" },
  { keys: "Ctrl+H", desc: "History" },
  { keys: "Ctrl+B", desc: "Toggle sidebar" },
  { keys: "Ctrl+Shift+B", desc: "Compact mode" },
  { keys: "Ctrl+Shift+R", desc: "Reader mode" },
  { keys: "Ctrl+Tab", desc: "Next tab" },
  { keys: "Ctrl+Shift+Tab", desc: "Previous tab" },
  { keys: "Ctrl+1–9", desc: "Switch workspace" },
];

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

  // Fetch sync status on mount and when syncEnabled changes
  useEffect(() => {
    invoke<SyncInfo>("get_sync_status").then(setSyncInfo).catch(() => {});
  }, [settings.syncEnabled]);

  // Listen for peer discovery + pairing events
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

  const set = useCallback(<K extends keyof BushidoSettings>(key: K, value: BushidoSettings[K]) => {
    onUpdate({ [key]: value });
    if (SECURITY_KEYS.includes(key)) setSecurityDirty(true);
  }, [onUpdate]);

  return (
    <div className="settings-page">
      <div className="settings-container">
        <h1 className="settings-title">Settings</h1>

        {/* General */}
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
              <span>On startup</span>
            </div>
            <Select
              value={settings.onStartup}
              options={[
                { value: "restore", label: "Restore previous session" },
                { value: "newtab", label: "Open new tab" },
              ]}
              onChange={(v: BushidoSettings["onStartup"]) => set("onStartup", v)}
            />
          </div>
          <div className="settings-row">
            <div className="settings-label"><span>Show top sites</span></div>
            <Toggle checked={settings.showTopSites} onChange={v => set("showTopSites", v)} />
          </div>
          <div className="settings-row">
            <div className="settings-label"><span>Show clock</span></div>
            <Toggle checked={settings.showClock} onChange={v => set("showClock", v)} />
          </div>
          <div className="settings-row">
            <div className="settings-label"><span>Show greeting</span></div>
            <Toggle checked={settings.showGreeting} onChange={v => set("showGreeting", v)} />
          </div>
        </section>

        {/* Downloads */}
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

        {/* Privacy */}
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
        </section>

        {/* Sync */}
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
              </div>
            </>
          )}
        </section>

        {/* Security */}
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

        {/* Appearance */}
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
              <span>Tab suspend timeout</span>
              <span className="settings-hint">Suspend inactive tabs after this time</span>
            </div>
            <Select
              value={settings.suspendTimeout}
              options={SUSPEND_OPTIONS}
              onChange={(v: number) => set("suspendTimeout", v)}
            />
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <section className="settings-section">
          <h2 className="settings-section-title">Keyboard Shortcuts</h2>
          <div className="settings-shortcuts">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="settings-shortcut-row">
                <kbd className="settings-kbd">{s.keys}</kbd>
                <span className="settings-shortcut-desc">{s.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* About */}
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
