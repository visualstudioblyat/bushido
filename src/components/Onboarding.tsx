import { useState, useCallback, useEffect, useTransition, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import logoSrc from "../assets/logo.png";

/* ── Types ── */
interface BrowserInfo { name: string; has_bookmarks: boolean; has_history: boolean; }
interface ImportedBookmark { title: string; url: string; folder: string; }
interface ImportedHistory { title: string; url: string; visit_count: number; last_visit: number; }

interface Props {
  onComplete: () => void;
  onImportBookmarks: (bookmarks: ImportedBookmark[]) => void;
  onImportHistory: (history: ImportedHistory[]) => void;
  onThemeChange: (accent: string, mode: "dark" | "light") => void;
  initialAccent: string;
  initialMode: "dark" | "light";
}

/* ── Constants ── */
const ACCENT_COLORS = [
  "#6366f1", "#f43f5e", "#22c55e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#14b8a6",
];

const STEPS = 5;

/* ── SVG Icons ── */
const ChromeIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
    <line x1="12" y1="8" x2="12" y2="2"/>
    <line x1="8.54" y1="14" x2="3.07" y2="17"/>
    <line x1="15.46" y1="14" x2="20.93" y2="17"/>
  </svg>
);

const EdgeIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.42 3.12 7.24"/>
    <path d="M20.5 14.5c.32-.8.5-1.62.5-2.5 0-4.97-4.03-9-9-9-2.07 0-3.98.7-5.5 1.88"/>
    <path d="M12 22c3.04 0 5.76-1.51 7.39-3.83"/>
    <circle cx="14" cy="13" r="4"/>
  </svg>
);

const FirefoxIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M17 8c-1-2-3-3-5-3s-4 1.5-4.5 3.5c-.3 1.2 0 2.5.8 3.5 1 1.2 2.5 2 4.2 2 2.5 0 4.5-1.5 5-3.5.3-1-.1-2-.5-2.5z"/>
  </svg>
);

const GlobeIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
  </svg>
);

const BROWSER_ICONS: Record<string, () => JSX.Element> = { Chrome: ChromeIcon, Edge: EdgeIcon, Firefox: FirefoxIcon };

const FEATURES = [
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/></svg>,
    title: "Command Palette",
    desc: "Ctrl+K to search tabs, bookmarks, history, and run actions instantly.",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>,
    title: "Split View",
    desc: "View two pages side-by-side. Drag a tab to split your workspace.",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    title: "Reader Mode",
    desc: "Ctrl+Shift+R strips clutter for distraction-free reading.",
  },
  {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>,
    title: "Ad Blocker",
    desc: "Built-in tracker & ad blocking at the network level. Unbypassable.",
  },
];

/* ── Component ── */
export default memo(function Onboarding({ onComplete, onImportBookmarks, onImportHistory, onThemeChange, initialAccent, initialMode }: Props) {
  /* Navigation state */
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  /* Import state */
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [selectedBrowser, setSelectedBrowser] = useState<string | null>(null);
  const [importBookmarks, setImportBookmarks] = useState(true);
  const [importHistoryFlag, setImportHistoryFlag] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [, startTransition] = useTransition();

  /* Theme state */
  const [accent, setAccent] = useState(initialAccent);
  const [mode, setMode] = useState<"dark" | "light">(initialMode);

  /* Detect browsers on mount */
  useEffect(() => {
    invoke<BrowserInfo[]>("detect_browsers").then(list => {
      setBrowsers(list);
      if (list.length > 0) setSelectedBrowser(list[0].name);
    }).catch(() => {});
  }, []);

  /* Navigation */
  const goNext = useCallback(() => setStep(s => Math.min(s + 1, STEPS - 1)), []);
  const goBack = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);

  const handleFinish = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onComplete(), 600);
  }, [exiting, onComplete]);

  /* Import */
  const handleImport = useCallback(async () => {
    if (!selectedBrowser || importing) return;
    setImporting(true);
    setImportStatus("Importing...");
    try {
      if (importBookmarks) {
        setImportStatus("Importing bookmarks...");
        const bm = await invoke<ImportedBookmark[]>("import_bookmarks", { browser: selectedBrowser });
        startTransition(() => onImportBookmarks(bm));
      }
      if (importHistoryFlag) {
        setImportStatus("Importing history...");
        const hist = await invoke<ImportedHistory[]>("import_history", { browser: selectedBrowser });
        startTransition(() => onImportHistory(hist));
      }
      setImportDone(true);
      setImportStatus("Import complete!");
    } catch (e: any) {
      setImportStatus(`Import failed: ${e?.message || e}`);
    }
    setImporting(false);
  }, [selectedBrowser, importing, importBookmarks, importHistoryFlag, onImportBookmarks, onImportHistory]);

  /* Theme */
  const handleAccent = useCallback((color: string) => {
    setAccent(color);
    onThemeChange(color, mode);
  }, [mode, onThemeChange]);

  const handleMode = useCallback((m: "dark" | "light") => {
    setMode(m);
    onThemeChange(accent, m);
  }, [accent, onThemeChange]);

  /* Keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (step === 1 && importing) return;
        if (step === STEPS - 1) handleFinish();
        else goNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (step === STEPS - 1) handleFinish();
        else setStep(STEPS - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault(); goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault(); goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, importing, goNext, goBack, handleFinish]);

  return (
    <div className={`ob-overlay${exiting ? " ob-exiting" : ""}`}>
      <div className="ob-container">
        <div className="ob-track" style={{ transform: `translateX(-${step * 100}%)` }}>

          {/* ── Welcome ── */}
          <div className="ob-step">
            <img src={logoSrc} alt="Bushido" className="ob-logo-img" />
            <h1 className="ob-wordmark">Bushido</h1>
            <p className="ob-tagline">your browser. your rules.</p>
            <p className="ob-subtitle">Private by default. No accounts. No tracking. No compromises.</p>
            <button className="ob-btn-primary" onClick={goNext}>Get Started</button>
          </div>

          {/* ── Import ── */}
          <div className="ob-step">
            <h2 className="ob-screen-title">Import Your Data</h2>
            <p className="ob-subtitle">Bring your bookmarks and history from another browser.</p>

            {browsers.length === 0 ? (
              <p className="ob-subtitle">No browsers detected.</p>
            ) : (
              <div className="ob-browsers">
                {browsers.map(b => {
                  const Icon = BROWSER_ICONS[b.name] || GlobeIcon;
                  return (
                    <div key={b.name} className={`ob-browser-row${selectedBrowser === b.name ? " selected" : ""}`} onClick={() => setSelectedBrowser(b.name)}>
                      <div className="ob-browser-icon"><Icon /></div>
                      <div className="ob-browser-name">{b.name}</div>
                      <div className="ob-browser-meta">
                        {b.has_bookmarks && "bookmarks"}{b.has_bookmarks && b.has_history && " + "}{b.has_history && "history"}
                      </div>
                      <div className="ob-radio">
                        {selectedBrowser === b.name && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedBrowser && (
              <div className="ob-import-opts">
                <div className={`ob-import-opt${importBookmarks ? " selected" : ""}`} onClick={() => setImportBookmarks(v => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    {importBookmarks
                      ? <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5"/>
                      : <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"/>}
                    {importBookmarks && <path d="M4 7L6 9L10 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
                  </svg>
                  Bookmarks
                </div>
                <div className={`ob-import-opt${importHistoryFlag ? " selected" : ""}`} onClick={() => setImportHistoryFlag(v => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    {importHistoryFlag
                      ? <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5"/>
                      : <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"/>}
                    {importHistoryFlag && <path d="M4 7L6 9L10 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
                  </svg>
                  History
                </div>
              </div>
            )}

            {importing && (
              <div className="ob-progress">
                <div className="ob-progress-fill" style={{ width: importDone ? "100%" : "60%" }} />
              </div>
            )}
            <div className="ob-import-status">{importStatus}</div>

            <div className="ob-btn-row">
              <button className="ob-btn-secondary" onClick={goBack}>Back</button>
              {!importDone ? (
                <button
                  className="ob-btn-primary"
                  onClick={handleImport}
                  disabled={importing || !selectedBrowser || (!importBookmarks && !importHistoryFlag)}
                  style={{ opacity: importing || !selectedBrowser ? 0.5 : 1 }}
                >{importing ? "Importing..." : "Import"}</button>
              ) : (
                <button className="ob-btn-primary" onClick={goNext}>Continue</button>
              )}
              <button className="ob-skip" onClick={goNext}>Skip</button>
            </div>
          </div>

          {/* ── Theme ── */}
          <div className="ob-step">
            <h2 className="ob-screen-title">Make It Yours</h2>
            <p className="ob-subtitle">Pick an accent color and theme.</p>

            <div className="ob-colors">
              {ACCENT_COLORS.map(c => (
                <button key={c} className={`ob-color${accent === c ? " active" : ""}`} style={{ background: c }} onClick={() => handleAccent(c)} />
              ))}
            </div>

            <div className="ob-theme-toggle">
              <div className={`ob-theme-pill${mode === "light" ? " right" : ""}`} />
              <button className={`ob-theme-btn${mode === "dark" ? " active" : ""}`} onClick={() => handleMode("dark")}>Dark</button>
              <button className={`ob-theme-btn${mode === "light" ? " active" : ""}`} onClick={() => handleMode("light")}>Light</button>
            </div>

            {/* Live preview — miniature Bushido layout */}
            <div className="ob-preview">
              <div className="ob-preview-browser" data-theme={mode}>
                {/* Titlebar */}
                <div className="ob-preview-titlebar">
                  <span className="ob-preview-title">Bushido</span>
                  <div className="ob-preview-winctrls">
                    <div className="ob-preview-winbtn"/>
                    <div className="ob-preview-winbtn"/>
                    <div className="ob-preview-winbtn ob-preview-winbtn-close"/>
                  </div>
                </div>
                <div className="ob-preview-body">
                  {/* Sidebar */}
                  <div className="ob-preview-sidebar">
                    <div className="ob-preview-nav">
                      <div className="ob-preview-navbtn"/><div className="ob-preview-navbtn"/><div className="ob-preview-navbtn"/>
                    </div>
                    <div className="ob-preview-urlbar" style={{ borderColor: `${accent}44` }}>
                      <div className="ob-preview-urlbar-icon"/>
                    </div>
                    <div className="ob-preview-tabs">
                      <div className="ob-preview-tab ob-preview-tab-active" style={{ borderLeftColor: accent, background: `${accent}18` }}/>
                      <div className="ob-preview-tab"/>
                      <div className="ob-preview-tab"/>
                      <div className="ob-preview-tab"/>
                    </div>
                    <div className="ob-preview-newtab">+ New Tab</div>
                  </div>
                  {/* Content area */}
                  <div className="ob-preview-content">
                    <div className="ob-preview-block" style={{ width: "50%", height: 10 }}/>
                    <div className="ob-preview-block" style={{ height: 32 }}/>
                    <div className="ob-preview-block" style={{ width: "75%", height: 8 }}/>
                    <div className="ob-preview-block" style={{ width: "60%", height: 8 }}/>
                  </div>
                </div>
              </div>
            </div>

            <div className="ob-btn-row">
              <button className="ob-btn-secondary" onClick={goBack}>Back</button>
              <button className="ob-btn-primary" onClick={goNext}>Continue</button>
            </div>
          </div>

          {/* ── Tour ── */}
          <div className="ob-step">
            <h2 className="ob-screen-title">Power Features</h2>
            <p className="ob-subtitle">A few things that make Bushido different.</p>

            <div className="ob-features">
              {FEATURES.map(f => (
                <div key={f.title} className="ob-feature">
                  <div className="ob-feature-icon">{f.icon}</div>
                  <div className="ob-feature-title">{f.title}</div>
                  <div className="ob-feature-desc">{f.desc}</div>
                </div>
              ))}
            </div>

            <div className="ob-btn-row">
              <button className="ob-btn-secondary" onClick={goBack}>Back</button>
              <button className="ob-btn-primary" onClick={goNext}>Continue</button>
            </div>
          </div>

          {/* ── Done ── */}
          <div className="ob-step">
            <div className="ob-done-check">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" stroke="var(--accent)" strokeWidth="2.5" opacity="0.2"/>
                <circle cx="32" cy="32" r="28" stroke="var(--accent)" strokeWidth="2.5" className="ob-check-circle"/>
                <path d="M20 33L28 41L44 23" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ob-check-mark"/>
              </svg>
            </div>
            <h1 className="ob-wordmark">You're all set.</h1>
            <p className="ob-tagline">Welcome to Bushido.</p>
            <button className="ob-btn-primary" onClick={handleFinish}>Start Browsing</button>
          </div>

        </div>

        {/* Dots */}
        <div className="ob-dots">
          {Array.from({ length: STEPS }, (_, i) => (
            <button key={i} className={`ob-dot${step === i ? " active" : ""}`} onClick={() => setStep(i)} />
          ))}
        </div>
      </div>
    </div>
  );
});
