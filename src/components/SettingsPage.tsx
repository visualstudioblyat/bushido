import { memo, useCallback, useState } from "react";
import { BushidoSettings } from "../types";

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

export default memo(function SettingsPage({ settings, onUpdate, onReloadAllTabs, onThemeChange }: Props) {
  const [securityDirty, setSecurityDirty] = useState(false);

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
            <div className="settings-about-version">v0.9.0</div>
            <div className="settings-about-desc">A minimal, privacy-focused browser built with Tauri.</div>
          </div>
        </section>
      </div>
    </div>
  );
});
