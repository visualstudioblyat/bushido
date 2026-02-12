import { useState, useCallback, useEffect, useTransition, memo } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BrowserInfo {
  name: string;
  has_bookmarks: boolean;
  has_history: boolean;
}

interface ImportedBookmark {
  title: string;
  url: string;
  folder: string;
}

interface ImportedHistory {
  title: string;
  url: string;
  visit_count: number;
  last_visit: number;
}

interface Props {
  onComplete: () => void;
  onImportBookmarks: (bookmarks: ImportedBookmark[]) => void;
  onImportHistory: (history: ImportedHistory[]) => void;
  onThemeChange: (accent: string, mode: "dark" | "light") => void;
  initialAccent: string;
  initialMode: "dark" | "light";
}

const ACCENT_COLORS = [
  "#6366f1", "#f43f5e", "#22c55e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#14b8a6",
];

const BROWSER_ICONS: Record<string, string> = {
  Chrome: "\uD83C\uDF10",
  Edge: "\uD83D\uDD35",
  Firefox: "\uD83E\uDD8A",
};

const FEATURES = [
  { icon: "\u2318", title: "Command Palette", desc: "Ctrl+K to search tabs, bookmarks, history, and run actions instantly." },
  { icon: "\u25A8", title: "Split View", desc: "View two pages side-by-side. Drag tabs to split the screen." },
  { icon: "\uD83D\uDCD6", title: "Reader Mode", desc: "Ctrl+Shift+R strips clutter for distraction-free reading." },
  { icon: "\uD83D\uDEE1\uFE0F", title: "Ad Blocker", desc: "Built-in tracker & ad blocking at the network level. Unbypassable." },
];

export default memo(function Onboarding({ onComplete, onImportBookmarks, onImportHistory, onThemeChange, initialAccent, initialMode }: Props) {
  const [step, setStep] = useState(0);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [selectedBrowser, setSelectedBrowser] = useState<string | null>(null);
  const [importBookmarks, setImportBookmarks] = useState(true);
  const [importHistoryFlag, setImportHistoryFlag] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [accent, setAccent] = useState(initialAccent);
  const [mode, setMode] = useState<"dark" | "light">(initialMode);
  const [, startTransition] = useTransition();

  // detect browsers on mount
  useEffect(() => {
    invoke<BrowserInfo[]>("detect_browsers").then(list => {
      setBrowsers(list);
      if (list.length > 0) setSelectedBrowser(list[0].name);
    }).catch(() => {});
  }, []);

  const goNext = useCallback(() => setStep(s => Math.min(s + 1, 4)), []);
  const goBack = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);

  const handleSelectBrowser = useCallback((name: string) => {
    setSelectedBrowser(name);
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedBrowser || importing) return;
    setImporting(true);
    setImportStatus("Importing...");

    try {
      if (importBookmarks) {
        setImportStatus("Importing bookmarks...");
        const bookmarks = await invoke<ImportedBookmark[]>("import_bookmarks", { browser: selectedBrowser });
        startTransition(() => onImportBookmarks(bookmarks));
      }
      if (importHistoryFlag) {
        setImportStatus("Importing history...");
        const history = await invoke<ImportedHistory[]>("import_history", { browser: selectedBrowser });
        startTransition(() => onImportHistory(history));
      }
      setImportDone(true);
      setImportStatus("Import complete!");
    } catch (e: any) {
      setImportStatus(`Import failed: ${e?.message || e}`);
    }
    setImporting(false);
  }, [selectedBrowser, importing, importBookmarks, importHistoryFlag, onImportBookmarks, onImportHistory]);

  const handleAccent = useCallback((color: string) => {
    setAccent(color);
    onThemeChange(color, mode);
  }, [mode, onThemeChange]);

  const handleMode = useCallback((m: "dark" | "light") => {
    setMode(m);
    onThemeChange(accent, m);
  }, [accent, onThemeChange]);

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-container">
        <div className="onboarding-screens">
          <div className="onboarding-track" style={{ transform: `translateX(-${step * 100}%)` }}>

            {/* Screen 0: Welcome */}
            <div className="onboarding-screen">
              <div className="onboarding-logo">Bushido</div>
              <div className="onboarding-tagline">your browser. your rules.</div>
              <div className="onboarding-subtitle">
                Private by default. No accounts. No tracking. No compromises.
              </div>
              <button className="onboarding-btn" onClick={goNext}>Get Started</button>
            </div>

            {/* Screen 1: Import */}
            <div className="onboarding-screen">
              <div className="onboarding-logo" style={{ fontSize: 20 }}>Import Your Data</div>
              <div className="onboarding-subtitle">Bring your bookmarks and history from another browser.</div>

              {browsers.length === 0 ? (
                <div className="onboarding-subtitle">No browsers detected.</div>
              ) : (
                <div className="onboarding-browsers">
                  {browsers.map(b => (
                    <div
                      key={b.name}
                      className={`onboarding-browser-row${selectedBrowser === b.name ? " selected" : ""}`}
                      onClick={() => handleSelectBrowser(b.name)}
                    >
                      <div className="onboarding-browser-icon">{BROWSER_ICONS[b.name] || "\uD83C\uDF10"}</div>
                      <div className="onboarding-browser-name">{b.name}</div>
                      <div className="onboarding-browser-meta">
                        {b.has_bookmarks && "bookmarks"}{b.has_bookmarks && b.has_history && " + "}{b.has_history && "history"}
                      </div>
                      <div className="onboarding-check">
                        {selectedBrowser === b.name && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedBrowser && (
                <div className="onboarding-import-options">
                  <div
                    className={`onboarding-import-option${importBookmarks ? " selected" : ""}`}
                    onClick={() => setImportBookmarks(v => !v)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      {importBookmarks ? (
                        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5"/>
                      ) : (
                        <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"/>
                      )}
                      {importBookmarks && <path d="M4 7L6 9L10 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
                    </svg>
                    Bookmarks
                  </div>
                  <div
                    className={`onboarding-import-option${importHistoryFlag ? " selected" : ""}`}
                    onClick={() => setImportHistoryFlag(v => !v)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      {importHistoryFlag ? (
                        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5"/>
                      ) : (
                        <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"/>
                      )}
                      {importHistoryFlag && <path d="M4 7L6 9L10 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
                    </svg>
                    History
                  </div>
                </div>
              )}

              {importing && (
                <div className="onboarding-progress">
                  <div className="onboarding-progress-fill" style={{ width: "60%" }} />
                </div>
              )}
              <div className="onboarding-import-status">{importStatus}</div>

              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button className="onboarding-btn-secondary" onClick={goBack}>Back</button>
                {!importDone ? (
                  <button
                    className="onboarding-btn"
                    onClick={handleImport}
                    disabled={importing || !selectedBrowser || (!importBookmarks && !importHistoryFlag)}
                    style={{ opacity: importing || !selectedBrowser ? 0.5 : 1 }}
                  >
                    {importing ? "Importing..." : "Import"}
                  </button>
                ) : (
                  <button className="onboarding-btn" onClick={goNext}>Continue</button>
                )}
                <button className="onboarding-skip" onClick={goNext}>Skip</button>
              </div>
            </div>

            {/* Screen 2: Look */}
            <div className="onboarding-screen">
              <div className="onboarding-logo" style={{ fontSize: 20 }}>Make It Yours</div>
              <div className="onboarding-subtitle">Pick an accent color and theme.</div>

              <div className="onboarding-colors">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c}
                    className={`onboarding-color${accent === c ? " active" : ""}`}
                    style={{ background: c }}
                    onClick={() => handleAccent(c)}
                  />
                ))}
              </div>

              <div className="onboarding-theme-toggle">
                <button
                  className={`onboarding-theme-btn${mode === "dark" ? " active" : ""}`}
                  onClick={() => handleMode("dark")}
                >Dark</button>
                <button
                  className={`onboarding-theme-btn${mode === "light" ? " active" : ""}`}
                  onClick={() => handleMode("light")}
                >Light</button>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button className="onboarding-btn-secondary" onClick={goBack}>Back</button>
                <button className="onboarding-btn" onClick={goNext}>Continue</button>
              </div>
            </div>

            {/* Screen 3: Tour */}
            <div className="onboarding-screen">
              <div className="onboarding-logo" style={{ fontSize: 20 }}>Power Features</div>
              <div className="onboarding-subtitle">A few things that make Bushido different.</div>

              <div className="onboarding-features">
                {FEATURES.map(f => (
                  <div key={f.title} className="onboarding-feature">
                    <div className="onboarding-feature-icon">{f.icon}</div>
                    <div className="onboarding-feature-title">{f.title}</div>
                    <div className="onboarding-feature-desc">{f.desc}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button className="onboarding-btn-secondary" onClick={goBack}>Back</button>
                <button className="onboarding-btn" onClick={goNext}>Continue</button>
              </div>
            </div>

            {/* Screen 4: Done */}
            <div className="onboarding-screen">
              <div className="onboarding-logo">You're all set.</div>
              <div className="onboarding-tagline">Welcome to Bushido.</div>
              <button className="onboarding-btn" onClick={onComplete}>Start Browsing</button>
            </div>
          </div>
        </div>

        {/* Dots */}
        <div className="onboarding-dots">
          {[0, 1, 2, 3, 4].map(i => (
            <button key={i} className={`onboarding-dot${step === i ? " active" : ""}`} onClick={() => setStep(i)} />
          ))}
        </div>
      </div>
    </div>
  );
});
