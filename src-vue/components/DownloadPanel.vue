<script setup lang="ts">
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { DownloadItem } from "../../src/types";

// Vue port of src/components/DownloadPanel.tsx.
// Note: the React version reads `dropIdx` through a stale closure at mouseup
// (always null at drag start), so its priority-reorder branch never fired.
// This port reads the refs' current values instead — reorder actually works.
const props = defineProps<{ downloads: DownloadItem[] }>();
const emit = defineEmits<{
  pause: [id: string];
  resume: [id: string];
  cancel: [id: string];
  open: [id: string];
  openFolder: [id: string];
  clearCompleted: [];
  close: [];
  retry: [id: string];
}>();

const hasCompleted = computed(() => props.downloads.some(d => d.state === "completed"));
const dragIdx = ref<number | null>(null);
const dropIdx = ref<number | null>(null);
let dragStartY = 0;
let dragActive = false;

// sort by priority asc, then newest first
const sorted = computed(() =>
  [...props.downloads].sort((a, b) => (a.priority || 0) - (b.priority || 0) || b.createdAt - a.createdAt));

function progress(d: DownloadItem): number {
  if (!d.totalBytes) return 0;
  return Math.min(100, (d.receivedBytes / d.totalBytes) * 100);
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps === 0) return "";
  return `${formatBytes(bps)}/s`;
}

function formatEta(total: number | null, received: number, speed: number): string {
  if (!total || speed === 0) return "";
  const remaining = total - received;
  const secs = Math.ceil(remaining / speed);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function onDragStart(e: MouseEvent, idx: number) {
  dragStartY = e.clientY;
  dragActive = false;
  dragIdx.value = idx;

  const onMove = (me: MouseEvent) => {
    if (!dragActive && Math.abs(me.clientY - dragStartY) < 5) return;
    dragActive = true;
    const items = document.querySelectorAll<HTMLElement>(".download-item");
    let target = -1;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (me.clientY >= rect.top && me.clientY < rect.bottom) { target = i; break; }
    }
    dropIdx.value = target >= 0 ? target : null;
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    const from = dragIdx.value;
    const to = dropIdx.value;
    if (dragActive && to !== null && from !== null && to !== from) {
      // reorder: reassign priorities based on new order
      const reordered = [...sorted.value];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      reordered.forEach((d, i) => {
        const newPri = i * 10;
        if (d.priority !== newPri) {
          invoke("reorder_download", { id: d.id, priority: newPri });
        }
      });
    }
    dragIdx.value = null;
    dropIdx.value = null;
    dragActive = false;
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
</script>

<template>
  <div class="download-panel">
    <div class="download-header">
      <button class="history-back-btn" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="download-title">downloads</span>
      <button v-if="hasCompleted" class="download-clear-btn" @click="emit('clearCompleted')">clear</button>
    </div>

    <div class="download-list">
      <div v-if="sorted.length === 0" class="history-empty">no downloads</div>
      <div
        v-for="(d, i) in sorted"
        :key="d.id"
        :class="`download-item${dragIdx === i ? ' dragging' : ''}${dropIdx === i ? ' drop-target' : ''}`"
        @mousedown="e => { if (e.button === 0) onDragStart(e, i); }"
      >
        <div class="download-item-info">
          <span class="download-item-name" :title="d.fileName">{{ d.fileName }}</span>
          <div class="download-item-meta">
            <template v-if="d.state === 'downloading'">
              <span>{{ formatBytes(d.receivedBytes) }}{{ d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : "" }}</span>
              <span v-if="d.speed > 0" class="download-speed">{{ formatSpeed(d.speed) }}</span>
              <span v-if="d.segments > 1" class="download-segments">{{ d.segments }}x</span>
              <span v-if="d.speed > 0" class="download-eta">{{ formatEta(d.totalBytes, d.receivedBytes, d.speed) }}</span>
            </template>
            <span v-if="d.state === 'paused'" class="download-paused-label">paused — {{ formatBytes(d.receivedBytes) }}{{ d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : "" }}</span>
            <span v-if="d.state === 'completed'" class="download-done-label">{{ d.totalBytes ? formatBytes(d.totalBytes) : "done" }}</span>
            <span v-if="d.state === 'failed'" class="download-error-label">{{ d.error || "failed" }}</span>
          </div>
        </div>

        <div v-if="(d.state === 'downloading' || d.state === 'paused') && d.totalBytes" class="download-progress-track">
          <div class="download-progress-fill" :style="{ width: `${progress(d)}%` }" />
        </div>

        <div class="download-actions">
          <template v-if="d.state === 'downloading'">
            <button class="download-action-btn" title="pause" @click="emit('pause', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="1" width="3" height="10" rx="0.5" fill="currentColor"/>
                <rect x="7" y="1" width="3" height="10" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
            <button class="download-action-btn danger" title="cancel" @click="emit('cancel', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </template>
          <template v-if="d.state === 'paused'">
            <button v-if="d.supportsRange" class="download-action-btn" title="resume" @click="emit('resume', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 1L10 6L3 11V1Z" fill="currentColor"/>
              </svg>
            </button>
            <button class="download-action-btn danger" title="cancel" @click="emit('cancel', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </template>
          <template v-if="d.state === 'completed'">
            <button class="download-action-btn" title="open file" @click="emit('open', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 11V1H7L10 4V11H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                <path d="M7 1V4H10" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="download-action-btn" title="open folder" @click="emit('openFolder', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 3V10H11V4H6L5 3H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>
          </template>
          <template v-if="d.state === 'failed'">
            <button class="download-action-btn" title="retry" @click="emit('retry', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M10 6A4 4 0 1 1 6 2M10 2V6H6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="download-action-btn danger" title="remove" @click="emit('cancel', d.id)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
