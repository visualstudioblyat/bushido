<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

// Vue port of src/components/ShareMenu.tsx.
const props = defineProps<{ url: string }>();
const emit = defineEmits<{ close: [] }>();

const copied = ref(false);
const qrData = ref<string | null>(null);
const qrLoading = ref(false);
const menuRef = ref<HTMLDivElement | null>(null);

// close on ESC or click outside
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
function onClick(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  // defer mousedown so the click that opened the menu doesn't close it
  setTimeout(() => window.addEventListener("mousedown", onClick), 0);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("mousedown", onClick);
});

async function copyLink() {
  await navigator.clipboard.writeText(props.url);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

async function showQr() {
  if (qrData.value) { qrData.value = null; return; }
  qrLoading.value = true;
  try {
    qrData.value = await invoke<string>("generate_qr_code", { url: props.url });
  } catch { /* ignore */ }
  qrLoading.value = false;
}
</script>

<template>
  <!-- QR modal overlay -->
  <div v-if="qrData" class="ss-qr-modal" @click="qrData = null">
    <div class="ss-qr-card" @click.stop>
      <img :src="`data:image/png;base64,${qrData}`" alt="QR Code" />
      <div class="ss-qr-url">{{ url }}</div>
      <button class="ss-btn" @click="qrData = null">Close</button>
    </div>
  </div>

  <div ref="menuRef" class="share-menu">
    <div class="share-menu-title">Share</div>
    <button class="share-menu-item" @click="copyLink">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="4.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/>
        <rect x="1.5" y="4.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/>
      </svg>
      {{ copied ? "Copied!" : "Copy link" }}
    </button>
    <button class="share-menu-item" :disabled="qrLoading" @click="showQr">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1"/>
        <rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1"/>
        <rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1"/>
        <rect x="9" y="9" width="3" height="3" fill="currentColor"/>
      </svg>
      {{ qrLoading ? "Generating..." : "QR Code" }}
    </button>
  </div>
</template>
