<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

// Vue port of src/components/ScreenshotOverlay.tsx.
type Phase = "pick" | "selecting" | "capturing" | "result";

const props = defineProps<{
  tabId: string;
  tabUrl: string;
  preview: string;
}>();
const emit = defineEmits<{
  close: [];
  annotate: [data: string];
  restoreWebview: [];
}>();

const phase = ref<Phase>("pick");
const resultData = ref("");
const error = ref("");
const saving = ref(false);
const copied = ref(false);
const saved = ref("");

// Area select — everything via canvas, no <img> coordinate issues
const canvasRef = ref<HTMLCanvasElement | null>(null);
let previewImg: HTMLImageElement | null = null;
let drag = { active: false, sx: 0, sy: 0, ex: 0, ey: 0 };
const selBox = ref<{ x: number; y: number; w: number; h: number } | null>(null);

// ESC to close
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); emit("close"); }
}
onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

// --- Canvas-based area select ---
function drawCanvas(sx: number, sy: number, ex: number, ey: number) {
  const canvas = canvasRef.value;
  const img = previewImg;
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
}

function startAreaSelect() {
  if (!props.preview) { error.value = "No preview available"; return; }

  // Load preview image, then init canvas
  const img = new Image();
  img.onload = () => {
    previewImg = img;
    selBox.value = null;
    phase.value = "selecting";

    // Init canvas on next frame when it's mounted
    requestAnimationFrame(() => {
      const canvas = canvasRef.value;
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      drawCanvas(0, 0, 0, 0);
    });
  };
  img.src = `data:image/png;base64,${props.preview}`;
}

// Mouse handlers for canvas area select (flush: post → canvas is mounted)
watch(phase, (p, _prev, onCleanup) => {
  if (p !== "selecting") return;
  const canvas = canvasRef.value;
  if (!canvas) return;

  const onDown = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    drag = { active: true, sx: x, sy: y, ex: x, ey: y };
    selBox.value = null;
  };

  const onMove = (e: MouseEvent) => {
    if (!drag.active) return;
    const r = canvas.getBoundingClientRect();
    drag.ex = Math.max(0, Math.min(e.clientX - r.left, r.width));
    drag.ey = Math.max(0, Math.min(e.clientY - r.top, r.height));
    drawCanvas(drag.sx, drag.sy, drag.ex, drag.ey);
  };

  const onUp = () => {
    if (!drag.active) return;
    drag.active = false;
    const x = Math.min(drag.sx, drag.ex), y = Math.min(drag.sy, drag.ey);
    const w = Math.abs(drag.ex - drag.sx), h = Math.abs(drag.ey - drag.sy);
    if (w > 10 && h > 10) {
      selBox.value = { x, y, w, h };
    }
  };

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  onCleanup(() => {
    canvas.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  });
}, { flush: "post" });

function confirmAreaSelection() {
  const img = previewImg;
  const canvas = canvasRef.value;
  const box = selBox.value;
  if (!box || !img || !canvas) return;

  const scaleX = img.naturalWidth / canvas.width;
  const scaleY = img.naturalHeight / canvas.height;
  const sx = box.x * scaleX, sy = box.y * scaleY;
  const sw = box.w * scaleX, sh = box.h * scaleY;

  const crop = document.createElement("canvas");
  crop.width = Math.round(sw);
  crop.height = Math.round(sh);
  const ctx = crop.getContext("2d")!;
  ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, crop.width, crop.height);
  resultData.value = crop.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  phase.value = "result";
}

// --- Simple actions ---
function captureVisible() {
  if (!props.preview) { error.value = "No preview available"; return; }
  resultData.value = props.preview;
  phase.value = "result";
}

async function captureFullPage() {
  phase.value = "capturing";
  error.value = "";
  try {
    emit("restoreWebview");
    await new Promise(r => setTimeout(r, 200));
    resultData.value = await invoke<string>("capture_fullpage", { id: props.tabId });
    invoke("layout_webviews", { panes: [], focusedTabId: props.tabId, sidebarW: 0, topOffset: 0 });
    phase.value = "result";
  } catch (e: any) {
    invoke("layout_webviews", { panes: [], focusedTabId: props.tabId, sidebarW: 0, topOffset: 0 });
    error.value = e?.toString() || "Full page capture failed";
    phase.value = "pick";
  }
}

async function copyToClipboard() {
  if (!resultData.value) return;
  copied.value = false;
  try {
    await invoke("copy_image_to_clipboard", { data: resultData.value });
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch (e: any) { error.value = e?.toString() || "Copy failed"; }
}

async function saveToFile() {
  if (!resultData.value) return;
  saving.value = true; saved.value = "";
  try {
    saved.value = await invoke<string>("save_screenshot", { data: resultData.value, suggestedName: "" });
  } catch (e: any) { error.value = e?.toString() || "Save failed"; }
  saving.value = false;
}

function copyLink() {
  navigator.clipboard.writeText(props.tabUrl);
}
</script>

<template>
  <div class="screenshot-overlay">
    <!-- MODE PICKER -->
    <div v-if="phase === 'pick'" class="ss-backdrop" @click="emit('close')">
      <div class="ss-mode-picker" @click.stop>
        <div class="ss-mode-title">Screenshot</div>
        <div v-if="error" class="ss-error">{{ error }}</div>
        <div class="ss-mode-buttons">
          <button class="ss-mode-btn" @click="startAreaSelect">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M4 7V4H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20 7V4H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 17V20H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20 17V20H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Area</span>
          </button>
          <button class="ss-mode-btn" @click="captureVisible">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
            </svg>
            <span>Visible</span>
          </button>
          <button class="ss-mode-btn" @click="captureFullPage">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" stroke-width="2"/>
              <line x1="9" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="9" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="9" y1="14" x2="13" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span>Full page</span>
          </button>
        </div>
        <div class="ss-mode-hint">Ctrl+Shift+S</div>
      </div>
    </div>

    <!-- CAPTURING SPINNER -->
    <div v-else-if="phase === 'capturing'" class="ss-backdrop">
      <div class="ss-spinner-wrap">
        <div class="ss-spinner" />
        <span>Capturing...</span>
      </div>
    </div>

    <!-- AREA SELECT — pure canvas -->
    <div v-else-if="phase === 'selecting'" style="position: absolute; inset: 0; background: #000; cursor: crosshair;">
      <canvas
        ref="canvasRef"
        style="position: absolute; inset: 0; width: 100%; height: 100%;"
      />
      <div class="ss-area-toolbar">
        <template v-if="selBox">
          <button class="ss-btn ss-btn-primary" @click="confirmAreaSelection">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7L6 11L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Capture
          </button>
          <button class="ss-btn" @click="emit('close')">Cancel</button>
        </template>
        <span v-else class="ss-area-hint">Click and drag to select an area</span>
      </div>
    </div>

    <!-- RESULT VIEW -->
    <div v-else-if="phase === 'result' && resultData" class="ss-backdrop" @click="emit('close')">
      <div class="ss-result" @click.stop>
        <img
          :src="`data:image/png;base64,${resultData}`"
          class="ss-result-img"
          alt="Screenshot"
        />
        <div class="ss-result-toolbar">
          <button class="ss-btn" @click="copyToClipboard">
            <template v-if="copied">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L6 11L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copied
            </template>
            <template v-else>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/></svg> Copy
            </template>
          </button>
          <button class="ss-btn" :disabled="saving" @click="saveToFile">
            <template v-if="saved">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L6 11L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Saved
            </template>
            <template v-else>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V9M7 9L4 6M7 9L10 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10V12H12V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Save
            </template>
          </button>
          <button class="ss-btn" @click="emit('annotate', resultData)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 1.5L12.5 5.5L5 13H1V9L8.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
            Annotate
          </button>
          <button class="ss-btn" @click="copyLink">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1V7M7 1L4.5 3.5M7 1L9.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 8V12H12V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Copy link
          </button>
          <div style="flex: 1;" />
          <button class="ss-btn" @click="emit('close')">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div v-if="error" class="ss-error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
