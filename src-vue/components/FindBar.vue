<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Vue port of src/components/FindBar.tsx.
const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ close: [] }>();

const query = ref("");
const matchCount = ref<number | null>(null);
const activeIdx = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
let unlisten: (() => void) | undefined;

onMounted(async () => {
  inputRef.value?.focus();
  // filter against the latest props.tabId at event time, so the listener
  // doesn't need to be re-created when the tab changes
  unlisten = await listen<{ id: string; count: number }>("match-count", (e) => {
    if (e.payload.id === props.tabId) matchCount.value = e.payload.count;
  });
});
onBeforeUnmount(() => unlisten?.());

function find(forward = true) {
  invoke("find_in_page", { id: props.tabId, query: query.value, forward });
  const count = matchCount.value;
  if (count && count > 0) {
    if (forward) activeIdx.value = activeIdx.value >= count ? 1 : activeIdx.value + 1;
    else activeIdx.value = activeIdx.value <= 1 ? count : activeIdx.value - 1;
  }
}

function close() {
  invoke("find_in_page", { id: props.tabId, query: "", forward: true });
  matchCount.value = null;
  activeIdx.value = 0;
  emit("close");
}

// reset index when query changes
watch(query, (q) => {
  if (!q) { matchCount.value = null; activeIdx.value = 0; }
  else activeIdx.value = 1;
});

const countLabel = computed(() =>
  matchCount.value !== null
    ? (matchCount.value > 0 ? `${Math.min(activeIdx.value, matchCount.value)} of ${matchCount.value}` : "no matches")
    : null);
</script>

<template>
  <div class="find-bar">
    <input
      ref="inputRef"
      v-model="query"
      class="find-input"
      placeholder="find in page..."
      spellcheck="false"
      @keydown="e => { if (e.key === 'Enter') find(!e.shiftKey); if (e.key === 'Escape') close(); }"
    />
    <span v-if="countLabel !== null" :class="`find-count ${matchCount === 0 ? 'find-count-none' : 'find-count-active'}`">{{ countLabel }}</span>
    <button class="find-btn" title="Previous" @click="find(false)">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 8L6 4L10 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button class="find-btn" title="Next" @click="find(true)">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button class="find-btn" title="Close (Esc)" @click="close">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</template>
