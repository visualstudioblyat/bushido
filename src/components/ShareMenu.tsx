import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  url: string;
  onClose: () => void;
}

export default function ShareMenu({ url, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // close on ESC or click outside
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const clickHandler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", handler, true);
    setTimeout(() => window.addEventListener("mousedown", clickHandler), 0);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("mousedown", clickHandler);
    };
  }, [onClose]);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  const showQr = useCallback(async () => {
    if (qrData) { setQrData(null); return; }
    setQrLoading(true);
    try {
      const b64: string = await invoke("generate_qr_code", { url });
      setQrData(b64);
    } catch { /* ignore */ }
    setQrLoading(false);
  }, [url, qrData]);

  return (
    <>
      {/* QR modal overlay */}
      {qrData && (
        <div className="ss-qr-modal" onClick={() => setQrData(null)}>
          <div className="ss-qr-card" onClick={e => e.stopPropagation()}>
            <img src={`data:image/png;base64,${qrData}`} alt="QR Code" />
            <div className="ss-qr-url">{url}</div>
            <button className="ss-btn" onClick={() => setQrData(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="share-menu" ref={menuRef}>
        <div className="share-menu-title">Share</div>
        <button className="share-menu-item" onClick={copyLink}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="4.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <rect x="1.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button className="share-menu-item" onClick={showQr} disabled={qrLoading}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1"/>
            <rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1"/>
            <rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1"/>
            <rect x="9" y="9" width="3" height="3" fill="currentColor"/>
          </svg>
          {qrLoading ? "Generating..." : "QR Code"}
        </button>
      </div>
    </>
  );
}
