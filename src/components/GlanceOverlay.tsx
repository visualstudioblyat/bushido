import { useEffect, useCallback } from "react";

interface GlanceOverlayProps {
  url: string;
  title: string;
  sidebarWidth: number;
  topOffset: number;
  onClose: () => void;
  onExpand: () => void;
  onSplit: () => void;
}

export default function GlanceOverlay({ url, title, sidebarWidth, topOffset, onClose, onExpand, onSplit }: GlanceOverlayProps) {
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
            <span className="glance-url-domain">{domain}</span>
            {path !== "/" && path}
          </div>
          <button className="glance-btn" onClick={onSplit} title="Open in split view">Split</button>
          <button className="glance-btn expand" onClick={onExpand} title="Open as tab">Expand</button>
          <button className="glance-btn close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
      </div>
    </>
  );
}
