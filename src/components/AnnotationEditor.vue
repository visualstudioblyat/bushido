<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";

// Vue port of src/components/AnnotationEditor.tsx.
type Tool = "pen" | "arrow" | "rect" | "highlight" | "blur" | "text" | "eraser";

const props = defineProps<{ imageData: string }>();
const emit = defineEmits<{ close: [] }>();

const tool = ref<Tool>("pen");
const color = ref("#ef4444");
const thickness = ref(3);
const saving = ref(false);
const copied = ref(false);
const canvasReady = ref(false);

const baseCanvasRef = ref<HTMLCanvasElement | null>(null);
const annCanvasRef = ref<HTMLCanvasElement | null>(null);
const wrapRef = ref<HTMLDivElement | null>(null);
const textRef = ref<HTMLInputElement | null>(null);

// reactive so the template's wrap/preview sizing updates once the image loads
const size = ref({ w: 0, h: 0 });

// transient drag state — non-reactive by design (Vue refs capture current value in closures)
let drawing = false;
let start = { x: 0, y: 0 };
let last = { x: 0, y: 0 };

// undo/redo — heavy ImageData kept out of reactivity; only lengths are reactive
let undoStack: ImageData[] = [];
let redoStack: ImageData[] = [];
const undoLen = ref(0);
const redoLen = ref(0);

// text tool
const textInput = ref<{ x: number; y: number; value: string } | null>(null);

// SVG preview for shapes while dragging
const preview = ref<{ sx: number; sy: number; ex: number; ey: number } | null>(null);

// Load image into base canvas
onMounted(() => {
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
    size.value = { w, h };

    nextTick(() => {
      const base = baseCanvasRef.value;
      const ann = annCanvasRef.value;
      if (base && ann) {
        base.width = w;
        base.height = h;
        base.getContext("2d")!.drawImage(img, 0, 0, w, h);
        ann.width = w;
        ann.height = h;
        undoStack = [ann.getContext("2d")!.getImageData(0, 0, w, h)];
        redoStack = [];
        undoLen.value = 1;
        redoLen.value = 0;
        canvasReady.value = true;
      }
    });
  };
  img.src = `data:image/png;base64,${props.imageData}`;
});

function pushUndo() {
  const ctx = annCanvasRef.value?.getContext("2d");
  const { w, h } = size.value;
  if (!ctx || !w) return;
  undoStack.push(ctx.getImageData(0, 0, w, h));
  if (undoStack.length > 21) undoStack.shift();
  redoStack = [];
  undoLen.value = undoStack.length;
  redoLen.value = 0;
}

function undo() {
  const ctx = annCanvasRef.value?.getContext("2d");
  if (!ctx || undoStack.length <= 1) return;
  redoStack.push(undoStack.pop()!);
  ctx.putImageData(undoStack[undoStack.length - 1], 0, 0);
  undoLen.value = undoStack.length;
  redoLen.value = redoStack.length;
}

function redo() {
  const ctx = annCanvasRef.value?.getContext("2d");
  if (!ctx || redoStack.length === 0) return;
  const next = redoStack.pop()!;
  undoStack.push(next);
  ctx.putImageData(next, 0, 0);
  undoLen.value = undoStack.length;
  redoLen.value = redoStack.length;
}

// Keyboard shortcuts
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  if (e.ctrlKey && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
}
onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

// Mouse handling — wired once the canvas is ready (flush: post → wrap is mounted/sized)
watch(canvasReady, (ready, _p, onCleanup) => {
  if (!ready) return;
  const ann = annCanvasRef.value;
  const wrap = wrapRef.value;
  if (!ann || !wrap) return;

  const getPos = (e: MouseEvent) => {
    const r = ann.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: MouseEvent) => {
    const pos = getPos(e);
    const t = tool.value;

    if (t === "text") {
      textInput.value = { x: pos.x, y: pos.y, value: "" };
      return;
    }

    drawing = true;
    start = pos;
    last = pos;

    const ctx = ann.getContext("2d")!;
    if (t === "pen" || t === "highlight" || t === "eraser") {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }
  };

  const onMove = (e: MouseEvent) => {
    if (!drawing) return;
    const pos = getPos(e);
    last = pos;
    const t = tool.value;
    const ctx = ann.getContext("2d")!;

    if (t === "pen") {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color.value;
      ctx.lineWidth = thickness.value;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (t === "highlight") {
      ctx.globalAlpha = 0.3;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color.value;
      ctx.lineWidth = 20;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (t === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = thickness.value * 4;
      ctx.lineCap = "round";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    } else if (t === "arrow" || t === "rect" || t === "blur") {
      preview.value = { sx: start.x, sy: start.y, ex: pos.x, ey: pos.y };
    }
  };

  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    preview.value = null;

    const t = tool.value;
    const ctx = ann.getContext("2d")!;
    const s = start;
    const p = last;

    if (t === "arrow") {
      const dx = p.x - s.x, dy = p.y - s.y;
      const angle = Math.atan2(dy, dx);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 5) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = color.value;
        ctx.lineWidth = thickness.value;
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
        ctx.fillStyle = color.value;
        ctx.fill();
      }
    } else if (t === "rect") {
      const w = p.x - s.x, h = p.y - s.y;
      if (Math.abs(w) > 3 && Math.abs(h) > 3) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = color.value;
        ctx.lineWidth = thickness.value;
        ctx.strokeRect(s.x, s.y, w, h);
      }
    } else if (t === "blur") {
      const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y);
      const w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
      if (w > 5 && h > 5) {
        const baseCtx = baseCanvasRef.value?.getContext("2d");
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
    const { w, h } = size.value;
    if (w) {
      undoStack.push(ctx.getImageData(0, 0, w, h));
      if (undoStack.length > 21) undoStack.shift();
      redoStack = [];
      undoLen.value = undoStack.length;
      redoLen.value = 0;
    }
  };

  wrap.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  onCleanup(() => {
    wrap.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  });
}, { flush: "post" });

// Text input commit
function commitText() {
  const ti = textInput.value;
  if (!ti || !ti.value.trim()) { textInput.value = null; return; }
  const ctx = annCanvasRef.value?.getContext("2d");
  if (!ctx) { textInput.value = null; return; }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color.value;
  const fontSize = Math.max(14, thickness.value * 5);
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.fillText(ti.value, ti.x, ti.y + fontSize);
  textInput.value = null;
  pushUndo();
}

watch(textInput, (ti) => { if (ti) nextTick(() => textRef.value?.focus()); });

function selectTool(id: Tool) {
  if (textInput.value) commitText();
  tool.value = id;
}

// Export composite
function exportImage(): string | null {
  const base = baseCanvasRef.value;
  const ann = annCanvasRef.value;
  const { w, h } = size.value;
  if (!base || !ann || !w) return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(ann, 0, 0);
  return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

async function handleCopy() {
  const b64 = exportImage();
  if (!b64) return;
  copied.value = false;
  try {
    await invoke("copy_image_to_clipboard", { data: b64 });
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch { /* ignore */ }
}

async function handleSave() {
  const b64 = exportImage();
  if (!b64) return;
  saving.value = true;
  try { await invoke("save_screenshot", { data: b64, suggestedName: "" }); } catch { /* ignore */ }
  saving.value = false;
}

const tools: { id: Tool; label: string }[] = [
  { id: "pen", label: "Pen" },
  { id: "arrow", label: "Arrow" },
  { id: "rect", label: "Rectangle" },
  { id: "highlight", label: "Highlight" },
  { id: "blur", label: "Blur/Redact" },
  { id: "text", label: "Text" },
  { id: "eraser", label: "Eraser" },
];

// Static, trusted SVG markup (v-html) — keeps the toolbar a simple v-for.
const toolIcons: Record<Tool, string> = {
  pen: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 2L14 6L6 14H2V10L10 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  arrow: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 3M13 3H7M13 3V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  rect: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`,
  highlight: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="12" height="4" rx="1" fill="currentColor" opacity="0.3"/><path d="M3 8H13" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.4"/></svg>`,
  blur: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/><g opacity="0.5"><rect x="4" y="5" width="3" height="3" fill="currentColor"/><rect x="9" y="5" width="3" height="3" fill="currentColor"/><rect x="4" y="8" width="3" height="3" fill="currentColor"/><rect x="9" y="8" width="3" height="3" fill="currentColor"/></g></svg>`,
  text: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4H12M8 4V13M6 13H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  eraser: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 14H14M4.5 11.5L11.5 4.5L14 7L8.5 12.5L4.5 12.5L4.5 11.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
};
</script>

<template>
  <div class="annotation-editor">
    <div class="ann-toolbar">
      <div class="ann-tool-group">
        <button
          v-for="t in tools"
          :key="t.id"
          class="ann-tool-btn"
          :class="{ active: tool === t.id }"
          :title="t.label"
          @click="selectTool(t.id)"
          v-html="toolIcons[t.id]"
        />
      </div>

      <div class="ann-divider" />

      <input type="color" v-model="color" class="ann-color-input" title="Color" />
      <input
        type="range" min="1" max="10"
        v-model.number="thickness"
        class="ann-thickness-slider"
        :title="`Thickness: ${thickness}`"
      />

      <div class="ann-divider" />

      <button class="ann-tool-btn" :disabled="undoLen <= 1" title="Undo (Ctrl+Z)" @click="undo">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6H11C12.7 6 14 7.3 14 9C14 10.7 12.7 12 11 12H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M7 3L4 6L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="ann-tool-btn" :disabled="redoLen === 0" title="Redo (Ctrl+Y)" @click="redo">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 6H5C3.3 6 2 7.3 2 9C2 10.7 3.3 12 5 12H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9 3L12 6L9 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      <div style="flex: 1;" />

      <button class="ss-btn" @click="handleCopy">{{ copied ? "Copied" : "Copy" }}</button>
      <button class="ss-btn" :disabled="saving" @click="handleSave">{{ saving ? "Saving..." : "Save" }}</button>
      <button class="ss-btn" @click="emit('close')">Close</button>
    </div>

    <div class="ann-canvas-area">
      <div
        ref="wrapRef"
        class="ann-canvas-wrap"
        :style="canvasReady ? { width: `${size.w}px`, height: `${size.h}px` } : undefined"
      >
        <canvas ref="baseCanvasRef" class="ann-base-canvas" />
        <canvas ref="annCanvasRef" class="ann-draw-canvas" />

        <svg
          v-if="preview"
          :style="{ position: 'absolute', left: 0, top: 0, width: `${size.w}px`, height: `${size.h}px`, pointerEvents: 'none' }"
        >
          <line
            v-if="tool === 'arrow'"
            :x1="preview.sx" :y1="preview.sy" :x2="preview.ex" :y2="preview.ey"
            :stroke="color" :stroke-width="thickness" stroke-linecap="round"
          />
          <rect
            v-else-if="tool === 'rect'"
            :x="Math.min(preview.sx, preview.ex)" :y="Math.min(preview.sy, preview.ey)"
            :width="Math.abs(preview.ex - preview.sx)" :height="Math.abs(preview.ey - preview.sy)"
            :stroke="color" :stroke-width="thickness" fill="none"
          />
          <rect
            v-else-if="tool === 'blur'"
            :x="Math.min(preview.sx, preview.ex)" :y="Math.min(preview.sy, preview.ey)"
            :width="Math.abs(preview.ex - preview.sx)" :height="Math.abs(preview.ey - preview.sy)"
            stroke="rgba(255,255,255,0.5)" :stroke-width="1" stroke-dasharray="4 2" fill="rgba(0,0,0,0.15)"
          />
        </svg>

        <input
          v-if="textInput"
          ref="textRef"
          class="ann-text-input"
          :style="{ left: `${textInput.x}px`, top: `${textInput.y}px`, color, fontSize: `${Math.max(14, thickness * 5)}px` }"
          v-model="textInput.value"
          @blur="commitText"
          @keydown.enter="commitText"
        />
      </div>
    </div>
  </div>
</template>
