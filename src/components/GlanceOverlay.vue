<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { listen } from "@tauri-apps/api/event";

// Vue port of src/components/GlanceOverlay.tsx.
const props = defineProps<{
  url: string;
  title: string;
  glanceId?: string;
  sidebarWidth: number;
  topOffset: number;
}>();
const emit = defineEmits<{ close: []; expand: []; split: [] }>();

const loading = ref(true);

// ESC to close
function handleKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}
onMounted(() => window.addEventListener("keydown", handleKey));
onUnmounted(() => window.removeEventListener("keydown", handleKey));

// track loading state via tab-loading event
watch(() => props.glanceId, (id, _prev, onCleanup) => {
  loading.value = true;
  if (!id) return;
  let cancelled = false;
  const p = listen<{ id: string; loading: boolean }>("tab-loading", (e) => {
    if (!cancelled && e.payload.id === id) loading.value = e.payload.loading;
  });
  onCleanup(() => { cancelled = true; p.then(un => un()); });
}, { immediate: true });

// extract domain for display
const urlParts = computed(() => {
  try {
    const u = new URL(props.url);
    return { domain: u.hostname, path: u.pathname + u.search };
  } catch {
    return { domain: props.url, path: "" };
  }
});

// compute frame position (85% x 80% centered in content area)
const frameStyle = computed(() => {
  const contentW = `calc(100vw - ${props.sidebarWidth}px)`;
  const contentH = `calc(100vh - ${props.topOffset}px)`;
  return {
    left: `calc(${props.sidebarWidth}px + (${contentW}) * 0.075)`,
    top: `calc(${props.topOffset}px + (${contentH}) * 0.1)`,
    width: `calc((${contentW}) * 0.85)`,
    height: `calc((${contentH}) * 0.8)`,
  };
});
</script>

<template>
  <div class="glance-backdrop" @click="emit('close')" />
  <div class="glance-frame" :style="frameStyle">
    <div class="glance-topbar">
      <div class="glance-url">
        <span v-if="loading" class="glance-spinner" style="display: inline-block; width: 12px; height: 12px; border: 2px solid var(--text-dim, #666); border-top-color: var(--accent, #6366f1); border-radius: 50%; animation: glance-spin 0.6s linear infinite; margin-right: 6px; flex-shrink: 0;" />
        <span class="glance-url-domain">{{ urlParts.domain }}</span>
        <template v-if="urlParts.path !== '/'">{{ urlParts.path }}</template>
      </div>
      <button class="glance-btn" title="Open in split view" @click="emit('split')">Split</button>
      <button class="glance-btn expand" title="Open as tab" @click="emit('expand')">Expand</button>
      <button class="glance-btn close" title="Close (Esc)" @click="emit('close')">✕</button>
    </div>
  </div>
</template>

<style>
@keyframes glance-spin { to { transform: rotate(360deg); } }
</style>
