import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type Tool = "pen" | "arrow" | "rect" | "highlight" | "blur" | "text" | "eraser";

interface Props {
  imageData: string; // base64 PNG
  onClose: () => void;
}

export default function AnnotationEditor({ imageData, onClose }: Props) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ef4444");
  const [thickness, setThickness] = useState(3);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const annCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  // drag state via refs to avoid stale closures
  const drawingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const lastRef = useRef({ x: 0, y: 0 });
  const toolRef = useRef<Tool>(tool);
  const colorRef = useRef(color);
  const thicknessRef = useRef(thickness);
  toolRef.current = tool;
  colorRef.current = color;
  thicknessRef.current = thickness;

  // undo/redo
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  // text tool
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const textRef = useRef<HTMLInputElement>(null);

  // SVG preview for shapes while dragging
  const [preview, setPreview] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);

  // Load image into base canvas
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const maxW = window.innerWidth - 64;
      const maxH = window.innerHeight - 120; // toolbar (~50px) + padding
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxW) { h = (h * maxW) / w; w = maxW; }
      if (h > maxH) { w = (w * maxH) / h; h = maxH; }
      w = Math.round(w);
      h = Math.round(h);
      sizeRef.current = { w, h };

      const base = baseCanvasRef.current;
      const ann = annCanvasRef.current;
      if (base && ann) {
        base.width = w;
        base.height = h;
        base.getContext("2d")!.drawImage(img, 0, 0, w, h);
        ann.width = w;
        ann.height = h;
        undoStack.current = [ann.getContext("2d")!.getImageData(0, 0, w, h)];
        redoStack.current = [];
        setUndoLen(1);
        setRedoLen(0);
        setCanvasReady(true);
      }
    };
    img.src = `data:image/png;base64,${imageData}`;
  }, [imageData]);

  const pushUndo = useCallback(() => {
    const ctx = annCanvasRef.current?.getContext("2d");
    const { w, h } = sizeRef.current;
    if (!ctx || !w) return;
    undoStack.current.push(ctx.getImageData(0, 0, w, h));
    if (undoStack.current.length > 21) undoStack.current.shift();
    redoStack.current = [];
    setUndoLen(undoStack.current.length);
    setRedoLen(0);
  }, []);

  const undo = useCallback(() => {
    const ctx = annCanvasRef.current?.getContext("2d");
    if (!ctx || undoStack.current.length <= 1) return;
    redoStack.current.push(undoStack.current.pop()!);
    ctx.putImageData(undoStack.current[undoStack.current.length - 1], 0, 0);
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
  }, []);

  const redo = useCallback(() => {
    const ctx = annCanvasRef.current?.getContext("2d");
    if (!ctx || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    ctx.putImageData(next, 0, 0);
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, undo, redo]);

  // Mouse handling via native listeners (avoids stale closure issues)
  useEffect(() => {
    if (!canvasReady) return;
    const ann = annCanvasRef.current;
    const wrap = wrapRef.current;
    if (!ann || !wrap) return;

    const getPos = (e: MouseEvent) => {
      const r = ann.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: MouseEvent) => {
      const pos = getPos(e);
      const t = toolRef.current;

      if (t === "text") {
        setTextInput({ x: pos.x, y: pos.y, value: "" });
        return;
      }

      drawingRef.current = true;
      startRef.current = pos;
      lastRef.current = pos;

      const ctx = ann.getContext("2d")!;
      if (t === "pen" || t === "highlight" || t === "eraser") {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    };

    const onMove = (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const pos = getPos(e);
      lastRef.current = pos;
      const t = toolRef.current;
      const ctx = ann.getContext("2d")!;

      if (t === "pen") {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = thicknessRef.current;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (t === "highlight") {
        ctx.globalAlpha = 0.3;
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = 20;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (t === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = thicknessRef.current * 4;
        ctx.lineCap = "round";
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (t === "arrow" || t === "rect" || t === "blur") {
        setPreview({ sx: startRef.current.x, sy: startRef.current.y, ex: pos.x, ey: pos.y });
      }
    };

    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      setPreview(null);

      const t = toolRef.current;
      const ctx = ann.getContext("2d")!;
      const s = startRef.current;
      const p = lastRef.current;

      if (t === "arrow") {
        const dx = p.x - s.x, dy = p.y - s.y;
        const angle = Math.atan2(dy, dx);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 5) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = colorRef.current;
          ctx.lineWidth = thicknessRef.current;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          const headLen = Math.min(len * 0.3, 16);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - headLen * Math.cos(angle - Math.PI / 6), p.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(p.x - headLen * Math.cos(angle + Math.PI / 6), p.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fillStyle = colorRef.current;
          ctx.fill();
        }
      } else if (t === "rect") {
        const w = p.x - s.x, h = p.y - s.y;
        if (Math.abs(w) > 3 && Math.abs(h) > 3) {
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = colorRef.current;
          ctx.lineWidth = thicknessRef.current;
          ctx.strokeRect(s.x, s.y, w, h);
        }
      } else if (t === "blur") {
        const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y);
        const w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
        if (w > 5 && h > 5) {
          const baseCtx = baseCanvasRef.current?.getContext("2d");
          if (baseCtx) {
            const block = 8;
            const imgData = baseCtx.getImageData(x, y, w, h);
            const d = imgData.data;
            for (let by = 0; by < h; by += block) {
              for (let bx = 0; bx < w; bx += block) {
                let r = 0, g = 0, b = 0, a = 0, count = 0;
                for (let py = by; py < Math.min(by + block, h); py++) {
                  for (let px = bx; px < Math.min(bx + block, w); px++) {
                    const i = (py * w + px) * 4;
                    r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; count++;
                  }
                }
                r = Math.round(r / count); g = Math.round(g / count);
                b = Math.round(b / count); a = Math.round(a / count);
                for (let py = by; py < Math.min(by + block, h); py++) {
                  for (let px = bx; px < Math.min(bx + block, w); px++) {
                    const i = (py * w + px) * 4;
                    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
                  }
                }
              }
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.putImageData(imgData, x, y);
          }
        }
      }

      // Push undo for all tools
      const { w, h } = sizeRef.current;
      if (w) {
        undoStack.current.push(ctx.getImageData(0, 0, w, h));
        if (undoStack.current.length > 21) undoStack.current.shift();
        redoStack.current = [];
        setUndoLen(undoStack.current.length);
        setRedoLen(0);
      }
    };

    wrap.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      wrap.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [canvasReady]);

  // Text input commit
  const commitText = useCallback(() => {
    if (!textInput || !textInput.value.trim()) { setTextInput(null); return; }
    const ctx = annCanvasRef.current?.getContext("2d");
    if (!ctx) { setTextInput(null); return; }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = colorRef.current;
    const fontSize = Math.max(14, thicknessRef.current * 5);
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.fillText(textInput.value, textInput.x, textInput.y + fontSize);
    setTextInput(null);
    pushUndo();
  }, [textInput, pushUndo]);

  useEffect(() => { if (textInput) textRef.current?.focus(); }, [textInput]);

  // Export composite
  const exportImage = useCallback((): string | null => {
    const base = baseCanvasRef.current;
    const ann = annCanvasRef.current;
    const { w, h } = sizeRef.current;
    if (!base || !ann || !w) return null;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(ann, 0, 0);
    return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }, []);

  const handleCopy = useCallback(async () => {
    const b64 = exportImage();
    if (!b64) return;
    setCopied(false);
    try {
      await invoke("copy_image_to_clipboard", { data: b64 });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [exportImage]);

  const handleSave = useCallback(async () => {
    const b64 = exportImage();
    if (!b64) return;
    setSaving(true);
    try { await invoke("save_screenshot", { data: b64, suggestedName: "" }); } catch { /* ignore */ }
    setSaving(false);
  }, [exportImage]);

  // Shape preview SVG overlay
  const renderPreview = () => {
    if (!preview) return null;
    const t = tool;
    const { sx, sy, ex, ey } = preview;
    const { w, h } = sizeRef.current;
    const svgStyle: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: w, height: h, pointerEvents: "none" };

    if (t === "arrow") {
      return (
        <svg style={svgStyle}>
          <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={thickness} strokeLinecap="round" />
        </svg>
      );
    }
    const x = Math.min(sx, ex), y = Math.min(sy, ey);
    const rw = Math.abs(ex - sx), rh = Math.abs(ey - sy);
    if (t === "rect") {
      return (
        <svg style={svgStyle}>
          <rect x={x} y={y} width={rw} height={rh} stroke={color} strokeWidth={thickness} fill="none" />
        </svg>
      );
    }
    if (t === "blur") {
      return (
        <svg style={svgStyle}>
          <rect x={x} y={y} width={rw} height={rh} stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="4 2" fill="rgba(0,0,0,0.15)" />
        </svg>
      );
    }
    return null;
  };

  const tools: { id: Tool; label: string; icon: JSX.Element }[] = [
    { id: "pen", label: "Pen", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 2L14 6L6 14H2V10L10 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
    { id: "arrow", label: "Arrow", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 3M13 3H7M13 3V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id: "rect", label: "Rectangle", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg> },
    { id: "highlight", label: "Highlight", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="12" height="4" rx="1" fill="currentColor" opacity="0.3"/><path d="M3 8H13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.4"/></svg> },
    { id: "blur", label: "Blur/Redact", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.3"/><g opacity="0.5"><rect x="4" y="5" width="3" height="3" fill="currentColor"/><rect x="9" y="5" width="3" height="3" fill="currentColor"/><rect x="4" y="8" width="3" height="3" fill="currentColor"/><rect x="9" y="8" width="3" height="3" fill="currentColor"/></g></svg> },
    { id: "text", label: "Text", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4H12M8 4V13M6 13H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
    { id: "eraser", label: "Eraser", icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 14H14M4.5 11.5L11.5 4.5L14 7L8.5 12.5L4.5 12.5L4.5 11.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
  ];

  return (
    <div className="annotation-editor">
      <div className="ann-toolbar">
        <div className="ann-tool-group">
          {tools.map(t => (
            <button
              key={t.id}
              className={`ann-tool-btn ${tool === t.id ? "active" : ""}`}
              onClick={() => { if (textInput) commitText(); setTool(t.id); }}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="ann-divider" />

        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="ann-color-input" title="Color" />
        <input type="range" min={1} max={10} value={thickness} onChange={e => setThickness(Number(e.target.value))} className="ann-thickness-slider" title={`Thickness: ${thickness}`} />

        <div className="ann-divider" />

        <button className="ann-tool-btn" onClick={undo} disabled={undoLen <= 1} title="Undo (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6H11C12.7 6 14 7.3 14 9C14 10.7 12.7 12 11 12H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M7 3L4 6L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button className="ann-tool-btn" onClick={redo} disabled={redoLen === 0} title="Redo (Ctrl+Y)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 6H5C3.3 6 2 7.3 2 9C2 10.7 3.3 12 5 12H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M9 3L12 6L9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>

        <div style={{ flex: 1 }} />

        <button className="ss-btn" onClick={handleCopy}>{copied ? "Copied" : "Copy"}</button>
        <button className="ss-btn" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        <button className="ss-btn" onClick={onClose}>Close</button>
      </div>

      <div className="ann-canvas-area">
        <div
          ref={wrapRef}
          className="ann-canvas-wrap"
          style={canvasReady ? { width: sizeRef.current.w, height: sizeRef.current.h } : undefined}
        >
          <canvas ref={baseCanvasRef} className="ann-base-canvas" />
          <canvas ref={annCanvasRef} className="ann-draw-canvas" />
          {renderPreview()}
          {textInput && (
            <input
              ref={textRef}
              className="ann-text-input"
              style={{ left: textInput.x, top: textInput.y, color, fontSize: Math.max(14, thickness * 5) }}
              value={textInput.value}
              onChange={e => setTextInput(prev => prev ? { ...prev, value: e.target.value } : null)}
              onBlur={commitText}
              onKeyDown={e => { if (e.key === "Enter") commitText(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
