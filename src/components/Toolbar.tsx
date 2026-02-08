import { useState, useEffect, RefObject } from "react";

interface Props {
  url: string;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  loading: boolean;
  inputRef: RefObject<HTMLInputElement>;
  blockedCount: number;
  whitelisted: boolean;
  onToggleWhitelist: () => void;
  compact: boolean;
}

export default function Toolbar({ url, onNavigate, onBack, onForward, onReload, loading, inputRef, blockedCount, whitelisted, onToggleWhitelist, compact }: Props) {
  const [input, setInput] = useState(url);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setInput(url);
  }, [url, focused]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onNavigate(input.trim());
      inputRef.current?.blur();
    }
  };

  const displayUrl = focused ? input : (() => {
    try {
      const u = new URL(input);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch { return input; }
  })();

  return (
    <div className={`toolbar ${compact ? "compact" : ""}`}>
      <div className="nav-buttons">
        <button className="nav-btn" onClick={onBack} title="Back (Alt+←)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={onForward} title="Forward (Alt+→)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={onReload} title="Reload (Ctrl+R)">
          {loading ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M13 8A5 5 0 1 1 8 3M13 3V8H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      <form className="url-form" onSubmit={submit}>
        <div className={`url-bar ${focused ? "focused" : ""}`}>
          {!focused && !loading && (
            <svg className="url-lock" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 5V4a2 2 0 1 1 4 0v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          )}
          <input
            ref={inputRef}
            className="url-input"
            value={focused ? input : displayUrl}
            onChange={e => setInput(e.target.value)}
            onFocus={() => { setFocused(true); setInput(url); }}
            onBlur={() => setFocused(false)}
            placeholder="search or enter url"
            spellCheck={false}
          />
        </div>
        {loading && <div className="url-progress" />}
      </form>

      <div
        className={`shield-badge ${whitelisted ? "shield-off" : ""}`}
        title={whitelisted ? "shields down (click to enable)" : `${blockedCount} tracker${blockedCount !== 1 ? 's' : ''} blocked (click to disable for this site)`}
        onClick={onToggleWhitelist}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1L2 4V7.5C2 11.1 4.5 14.4 8 15.2C11.5 14.4 14 11.1 14 7.5V4L8 1Z"
                stroke={whitelisted ? "var(--text-dim)" : blockedCount > 0 ? "var(--success)" : "var(--text-dim)"}
                strokeWidth="1.3" strokeLinejoin="round" fill={whitelisted ? "none" : "none"}/>
          {whitelisted ? (
            <path d="M5 5.5L11 10.5M11 5.5L5 10.5" stroke="var(--text-dim)" strokeWidth="1.2"
                  strokeLinecap="round"/>
          ) : blockedCount > 0 ? (
            <path d="M5.5 8L7 9.5L10.5 6" stroke="var(--success)" strokeWidth="1.3"
                  strokeLinecap="round" strokeLinejoin="round"/>
          ) : null}
        </svg>
        {!whitelisted && blockedCount > 0 && (
          <span className="shield-count">{blockedCount > 99 ? '99+' : blockedCount}</span>
        )}
      </div>
    </div>
  );
}
