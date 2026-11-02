<script setup lang="ts">
import { ref, computed } from "vue";
import type { HistoryEntry } from "../../src/types";

// Vue port of src/components/HistoryPanel.tsx.
// React's optional onRemoveEntry callback becomes the `removable` prop
// (to gate the delete button) plus the `removeEntry` emit.
const props = defineProps<{ history: HistoryEntry[]; removable?: boolean }>();
const emit = defineEmits<{
  select: [url: string];
  close: [];
  clear: [range: "hour" | "today" | "all"];
  removeEntry: [url: string];
}>();

const search = ref("");
const clearOpen = ref(false);

function groupByDate(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400_000;

  const groups: Map<string, HistoryEntry[]> = new Map();

  for (const entry of entries) {
    let label: string;
    if (entry.lastVisitAt >= todayStart) {
      label = "today";
    } else if (entry.lastVisitAt >= yesterdayStart) {
      label = "yesterday";
    } else {
      const d = new Date(entry.lastVisitAt);
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const dayDiff = Math.floor((todayStart - entry.lastVisitAt) / 86400_000);
      if (dayDiff < 7) {
        label = days[d.getDay()];
      } else {
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }

  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const filtered = computed(() => {
  if (!search.value) return props.history;
  const q = search.value.toLowerCase();
  return props.history.filter(h => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q));
});

const groups = computed(() => groupByDate(filtered.value));

function handleClear(range: "hour" | "today" | "all") {
  emit("clear", range);
  clearOpen.value = false;
}
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <button class="history-back-btn" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="history-title">history</span>
      <div class="history-clear-wrap">
        <button class="history-clear-btn" @click="clearOpen = !clearOpen">clear</button>
        <div v-if="clearOpen" class="history-clear-dropdown">
          <button class="ctx-item" @click="handleClear('hour')">last hour</button>
          <button class="ctx-item" @click="handleClear('today')">today</button>
          <div class="ctx-divider" />
          <button class="ctx-item ctx-danger" @click="handleClear('all')">all time</button>
        </div>
      </div>
    </div>

    <div class="history-search">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
        <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <input
        v-model="search"
        placeholder="search history..."
        spellcheck="false"
      />
      <button v-if="search" class="tab-search-clear" @click="search = ''">×</button>
    </div>

    <div class="history-list">
      <div v-if="groups.length === 0" class="history-empty">
        {{ search ? "no matches" : "no history yet" }}
      </div>
      <div v-for="g in groups" :key="g.label">
        <div class="history-group-label">{{ g.label }}</div>
        <div
          v-for="(entry, i) in g.entries"
          :key="`${entry.url}-${i}`"
          class="history-entry"
          @click="emit('select', entry.url)"
        >
          <div class="tab-favicon">
            <img v-if="entry.favicon" :src="entry.favicon" alt="" width="14" height="14" />
            <span v-else class="tab-favicon-placeholder">{{ (entry.title || entry.url || "?")[0] }}</span>
          </div>
          <div class="history-entry-text">
            <span class="history-entry-title">{{ entry.title || entry.url }}</span>
            <span class="history-entry-url">{{ entry.url }}</span>
          </div>
          <span class="history-entry-time">{{ formatTime(entry.lastVisitAt) }}</span>
          <button
            v-if="removable"
            class="history-entry-delete"
            title="Remove from history"
            @click.stop="emit('removeEntry', entry.url)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
