import { useEffect, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface GlanceOverlayProps {
  url: string;
  title: string;
  glanceId?: string;
  sidebarWidth: number;
  topOffset: number;
  onClose: () => void;
  onExpand: () => void;
  onSplit: () => void;
}

export default function GlanceOverlay({ url, title, glanceId, sidebarWidth, topOffset, onClose, onExpand, onSplit }: GlanceOverlayProps) {
  const [loading, setLoading] = useState(true);

  // ESC to close
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // track loading state via tab-loading event
  useEffect(() => {
    if (!glanceId) return;
    setLoading(true);
    const unlisten = listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
      if (e.payload.id === glanceId) {
        setLoading(e.payload.loading);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [glanceId]);

  // extract domain for display
  let domain = "";
  let path = "";
  try {
    const u = new URL(url);
    domain = u.hostname;
    path = u.pathname + u.search;
  } catch {
    domain = url;
  }

  // compute frame position (85% x 80% centered in content area)
  const contentW = `calc(100vw - ${sidebarWidth}px)`;
  const contentH = `calc(100vh - ${topOffset}px)`;
  const frameStyle: React.CSSProperties = {
    left: `calc(${sidebarWidth}px + (${contentW}) * 0.075)`,
    top: `calc(${topOffset}px + (${contentH}) * 0.1)`,
    width: `calc((${contentW}) * 0.85)`,
    height: `calc((${contentH}) * 0.8)`,
  };

  return (
    <>
      <div className="glance-backdrop" onClick={onClose} />
      <div className="glance-frame" style={frameStyle}>
        <div className="glance-topbar">
          <div className="glance-url">
            {loading && (
              <span className="glance-spinner" style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                border: '2px solid var(--text-dim, #666)',
                borderTopColor: 'var(--accent, #6366f1)',
                borderRadius: '50%',
                animation: 'glance-spin 0.6s linear infinite',
                marginRight: 6,
                flexShrink: 0,
              }} />
            )}
            <span className="glance-url-domain">{domain}</span>
            {path !== "/" && path}
          </div>
          <button className="glance-btn" onClick={onSplit} title="Open in split view">Split</button>
          <button className="glance-btn expand" onClick={onExpand} title="Open as tab">Expand</button>
          <button className="glance-btn close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
      </div>
      <style>{`@keyframes glance-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
