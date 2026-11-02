import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type Phase = "pick" | "selecting" | "capturing" | "result";

interface Props {
  tabId: string;
  tabUrl: string;
  preview: string;
  onClose: () => void;
  onAnnotate: (data: string) => void;
  onRestoreWebview: () => void;
}

export default function ScreenshotOverlay({ tabId, tabUrl, preview, onClose, onAnnotate, onRestoreWebview }: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [resultData, setResultData] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState("");

  // Area select — everything via canvas, no <img> coordinate issues
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef({ active: false, sx: 0, sy: 0, ex: 0, ey: 0 });
  const [selBox, setSelBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // --- Canvas-based area select ---
  const drawCanvas = useCallback((sx: number, sy: number, ex: number, ey: number) => {
    const canvas = canvasRef.current;
    const img = previewImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;

    // Draw the full preview image stretched to canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Dark overlay
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cut out the selection (draw the bright region)
    const x = Math.min(sx, ex), y = Math.min(sy, ey);
    const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
    if (w > 2 && h > 2) {
      // Re-draw the bright image in the selection area
      const scaleX = img.naturalWidth / canvas.width;
      const scaleY = img.naturalHeight / canvas.height;
      ctx.drawImage(
        img,
        x * scaleX, y * scaleY, w * scaleX, h * scaleY,
        x, y, w, h
      );
      // Border
      ctx.strokeStyle = "var(--accent, #4f8fff)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Size label
      const label = `${Math.round(w)}x${Math.round(h)}`;
      ctx.font = "500 12px system-ui, sans-serif";
      const tm = ctx.measureText(label);
      const lx = x + w / 2 - tm.width / 2 - 6;
      const ly = y + h + 4;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(lx, ly, tm.width + 12, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 6, ly + 14);
    }
  }, []);

  const startAreaSelect = useCallback(() => {
    if (!preview) { setError("No preview available"); return; }

    // Load preview image, then init canvas
    const img = new Image();
    img.onload = () => {
      previewImgRef.current = img;
      setSelBox(null);
      setPhase("selecting");

      // Init canvas on next frame when it's mounted
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        drawCanvas(0, 0, 0, 0);
      });
    };
    img.src = `data:image/png;base64,${preview}`;
  }, [preview, drawCanvas]);

  // Mouse handlers for canvas area select
  useEffect(() => {
    if (phase !== "selecting") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      dragRef.current = { active: true, sx: x, sy: y, ex: x, ey: y };
      setSelBox(null);
    };

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      const r = canvas.getBoundingClientRect();
      d.ex = Math.max(0, Math.min(e.clientX - r.left, r.width));
      d.ey = Math.max(0, Math.min(e.clientY - r.top, r.height));
      drawCanvas(d.sx, d.sy, d.ex, d.ey);
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      const x = Math.min(d.sx, d.ex), y = Math.min(d.sy, d.ey);
      const w = Math.abs(d.ex - d.sx), h = Math.abs(d.ey - d.sy);
      if (w > 10 && h > 10) {
        setSelBox({ x, y, w, h });
      }
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [phase, drawCanvas]);

  const confirmAreaSelection = useCallback(() => {
    const img = previewImgRef.current;
    const canvas = canvasRef.current;
    if (!selBox || !img || !canvas) return;

    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;
    const sx = selBox.x * scaleX, sy = selBox.y * scaleY;
    const sw = selBox.w * scaleX, sh = selBox.h * scaleY;

    const crop = document.createElement("canvas");
    crop.width = Math.round(sw);
    crop.height = Math.round(sh);
    const ctx = crop.getContext("2d")!;
    ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, crop.width, crop.height);
    const b64 = crop.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    setResultData(b64);
    setPhase("result");
  }, [selBox]);

  // --- Simple actions ---
  const captureVisible = useCallback(() => {
    if (!preview) { setError("No preview available"); return; }
    setResultData(preview);
    setPhase("result");
  }, [preview]);

  const captureFullPage = useCallback(async () => {
    setPhase("capturing");
    setError("");
    try {
      onRestoreWebview();
      await new Promise(r => setTimeout(r, 200));
      const b64: string = await invoke("capture_fullpage", { id: tabId });
      invoke("layout_webviews", { panes: [], focusedTabId: tabId, sidebarW: 0, topOffset: 0 });
      setResultData(b64);
      setPhase("result");
    } catch (e: any) {
      invoke("layout_webviews", { panes: [], focusedTabId: tabId, sidebarW: 0, topOffset: 0 });
      setError(e?.toString() || "Full page capture failed");
      setPhase("pick");
    }
  }, [tabId, onRestoreWebview]);

  const copyToClipboard = useCallback(async () => {
    if (!resultData) return;
    setCopied(false);
    try {
      await invoke("copy_image_to_clipboard", { data: resultData });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e: any) { setError(e?.toString() || "Copy failed"); }
  }, [resultData]);

  const saveToFile = useCallback(async () => {
    if (!resultData) return;
    setSaving(true); setSaved("");
    try {
      const path: string = await invoke("save_screenshot", { data: resultData, suggestedName: "" });
      setSaved(path);
    } catch (e: any) { setError(e?.toString() || "Save failed"); }
    setSaving(false);
  }, [resultData]);

  return (
    <div className="screenshot-overlay">
      {/* MODE PICKER */}
      {phase === "pick" && (
        <div className="ss-backdrop" onClick={onClose}>
          <div className="ss-mode-picker" onClick={e => e.stopPropagation()}>
            <div className="ss-mode-title">Screenshot</div>
            {error && <div className="ss-error">{error}</div>}
            <div className="ss-mode-buttons">
              <button className="ss-mode-btn" onClick={startAreaSelect}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M4 7V4H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 7V4H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M4 17V20H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 17V20H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Area</span>
              </button>
              <button className="ss-mode-btn" onClick={captureVisible}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
                <span>Visible</span>
              </button>
              <button className="ss-mode-btn" onClick={captureFullPage}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <line x1="9" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="9" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="9" y1="14" x2="13" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>Full page</span>
              </button>
            </div>
            <div className="ss-mode-hint">Ctrl+Shift+S</div>
          </div>
        </div>
      )}

      {/* CAPTURING SPINNER */}
      {phase === "capturing" && (
        <div className="ss-backdrop">
          <div className="ss-spinner-wrap">
            <div className="ss-spinner" />
            <span>Capturing...</span>
          </div>
        </div>
      )}

      {/* AREA SELECT — pure canvas */}
      {phase === "selecting" && (
        <div style={{ position: "absolute", inset: 0, background: "#000", cursor: "crosshair" }}>
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
          <div className="ss-area-toolbar">
            {selBox ? (
              <>
                <button className="ss-btn ss-btn-primary" onClick={confirmAreaSelection}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7L6 11L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Capture
                </button>
                <button className="ss-btn" onClick={onClose}>Cancel</button>
              </>
            ) : (
              <span className="ss-area-hint">Click and drag to select an area</span>
            )}
          </div>
        </div>
      )}

      {/* RESULT VIEW */}
      {phase === "result" && resultData && (
        <div className="ss-backdrop" onClick={onClose}>
          <div className="ss-result" onClick={e => e.stopPropagation()}>
            <img
              src={`data:image/png;base64,${resultData}`}
              className="ss-result-img"
              alt="Screenshot"
            />
            <div className="ss-result-toolbar">
              <button className="ss-btn" onClick={copyToClipboard}>
                {copied ? (
                  <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L6 11L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg> Copy</>
                )}
              </button>
              <button className="ss-btn" onClick={saveToFile} disabled={saving}>
                {saved ? (
                  <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L6 11L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> Saved</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V9M7 9L4 6M7 9L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 10V12H12V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> Save</>
                )}
              </button>
              <button className="ss-btn" onClick={() => onAnnotate(resultData)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 1.5L12.5 5.5L5 13H1V9L8.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                Annotate
              </button>
              <button className="ss-btn" onClick={() => navigator.clipboard.writeText(tabUrl)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1V7M7 1L4.5 3.5M7 1L9.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 8V12H12V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Copy link
              </button>
              <div style={{ flex: 1 }} />
              <button className="ss-btn" onClick={onClose}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            {error && <div className="ss-error">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
