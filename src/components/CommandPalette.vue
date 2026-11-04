<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import type { Tab, Bookmark, HistoryEntry } from "../types";

// Vue port of src/components/CommandPalette.tsx.
interface CmdResult {
  id: string;
  type: "tab" | "bookmark" | "history" | "action";
  title: string;
  subtitle: string;
  favicon?: string;
  score?: number;
}

const props = defineProps<{
  tabs: Tab[];
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  sidebarW: number;
}>();
const emit = defineEmits<{
  selectTab: [id: string];
  navigate: [url: string];
  action: [action: string];
  close: [];
}>();

const ACTIONS: CmdResult[] = [
  { id: "action-new-tab", type: "action", title: "New Tab", subtitle: "Ctrl+T" },
  { id: "action-close-tab", type: "action", title: "Close Tab", subtitle: "Ctrl+W" },
  { id: "action-settings", type: "action", title: "Settings", subtitle: "" },
  { id: "action-toggle-compact", type: "action", title: "Toggle Compact Mode", subtitle: "Ctrl+Shift+B" },
  { id: "action-toggle-sidebar", type: "action", title: "Toggle Sidebar", subtitle: "Ctrl+B" },
  { id: "action-reader-mode", type: "action", title: "Reader Mode", subtitle: "Ctrl+Shift+R" },
  { id: "action-history", type: "action", title: "Open History", subtitle: "Ctrl+H" },
  { id: "action-bookmark", type: "action", title: "Bookmark Page", subtitle: "Ctrl+D" },
  { id: "action-clear-history", type: "action", title: "Clear All History", subtitle: "" },
  { id: "action-screenshot", type: "action", title: "Screenshot", subtitle: "Ctrl+Shift+S" },
];

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 25 : 0;
}

const query = ref("");
const selectedIdx = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  inputRef.value?.focus();
});

const results = computed<CmdResult[]>(() => {
  if (!query.value.trim()) return ACTIONS;

  const q = query.value.trim();
  const items: (CmdResult & { score: number })[] = [];

  // tabs
  for (const t of props.tabs) {
    const s = Math.max(fuzzyScore(q, t.title), fuzzyScore(q, t.url));
    if (s > 0) items.push({ id: `tab-${t.id}`, type: "tab", title: t.title, subtitle: t.url, favicon: t.favicon, score: s + 10 });
  }

  // bookmarks
  for (const b of props.bookmarks) {
    const s = Math.max(fuzzyScore(q, b.title), fuzzyScore(q, b.url));
    if (s > 0) items.push({ id: `bm-${b.id}`, type: "bookmark", title: b.title, subtitle: b.url, favicon: b.favicon, score: s + 5 });
  }

  // history (top 200 to keep it fast)
  const histSlice = props.history.slice(0, 200);
  for (const h of histSlice) {
    const s = Math.max(fuzzyScore(q, h.title), fuzzyScore(q, h.url));
    if (s > 0) items.push({ id: `hist-${h.url}`, type: "history", title: h.title || h.url, subtitle: h.url, favicon: h.favicon, score: s });
  }

  // actions
  for (const a of ACTIONS) {
    const s = fuzzyScore(q, a.title);
    if (s > 0) items.push({ ...a, score: s + 20 });
  }

  // dedupe by url for bookmarks/history
  const seen = new Set<string>();
  const deduped = items.filter(item => {
    if (item.type === "tab") return true;
    if (item.type === "action") return true;
    if (seen.has(item.subtitle)) return false;
    seen.add(item.subtitle);
    return true;
  });

  return deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 12);
});

watch(results, () => {
  selectedIdx.value = 0;
});

// scroll selected into view (flush: post → after DOM update, like the React effect)
watch(selectedIdx, () => {
  const list = listRef.value;
  if (!list) return;
  const selected = list.children[selectedIdx.value] as HTMLElement | undefined;
  if (selected) selected.scrollIntoView({ block: "nearest" });
}, { flush: "post" });

function executeResult(result: CmdResult) {
  if (result.type === "tab") {
    emit("selectTab", result.id.replace("tab-", ""));
  } else if (result.type === "bookmark" || result.type === "history") {
    emit("navigate", result.subtitle);
  } else if (result.type === "action") {
    emit("action", result.id);
  }
  emit("close");
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const r = results.value[selectedIdx.value];
    if (r) {
      executeResult(r);
    } else if (query.value.trim()) {
      emit("navigate", query.value.trim());
      emit("close");
    }
  } else if (e.key === "Escape") {
    emit("close");
  }
}
</script>

<template>
  <div class="cmd-overlay" :style="{ paddingLeft: `${sidebarW}px` }" @click="emit('close')">
    <div class="cmd-palette" @click.stop>
      <div class="cmd-input-wrap">
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <input
          ref="inputRef"
          v-model="query"
          class="cmd-input"
          placeholder="search tabs, bookmarks, history, or actions..."
          spellcheck="false"
          @keydown="handleKeyDown"
        />
      </div>
      <div ref="listRef" class="cmd-results">
        <div v-if="results.length === 0" class="cmd-empty">no results found</div>
        <template v-else>
          <div
            v-for="(r, i) in results"
            :key="r.id"
            :class="`cmd-result ${i === selectedIdx ? 'selected' : ''}`"
            @click="executeResult(r)"
            @mouseenter="selectedIdx = i"
          >
            <span class="cmd-result-type">{{ r.type }}</span>
            <div v-if="r.favicon && r.type !== 'action'" class="cmd-result-icon">
              <img :src="r.favicon" alt="" width="14" height="14" />
            </div>
            <div v-else-if="r.type === 'action'" class="cmd-result-icon cmd-action-icon">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <div class="cmd-result-text">
              <span class="cmd-result-title">{{ r.title }}</span>
              <span v-if="r.subtitle && r.type !== 'action'" class="cmd-result-subtitle">{{ r.subtitle }}</span>
            </div>
            <span v-if="r.type === 'action' && r.subtitle" class="cmd-result-shortcut">{{ r.subtitle }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
