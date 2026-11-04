<script lang="ts">
// type exports live in a plain <script> block; <script setup> can't export
export interface NetworkEntry {
  url: string;
  resource_type: string;
  blocked: boolean;
  filter_rule: string | null;
  timestamp_ms: number;
}
</script>

<script setup lang="ts">
import { ref, computed } from "vue";

// Vue port of src/components/NetworkPanel.tsx.
const props = defineProps<{ entries: NetworkEntry[] }>();
const emit = defineEmits<{ close: []; clear: [] }>();

const TYPE_LABELS: Record<string, string> = {
  xmlhttprequest: "xhr",
  stylesheet: "css",
  script: "js",
  image: "img",
  font: "font",
  document: "doc",
  media: "media",
  fetch: "fetch",
  websocket: "ws",
  ping: "ping",
  other: "other",
};

const FILTERS = ["all", "js", "xhr", "img", "css", "font", "other"] as const;
type Filter = typeof FILTERS[number];

const FILTER_TYPES: Record<Filter, string[]> = {
  all: [],
  js: ["script"],
  xhr: ["xmlhttprequest", "fetch"],
  img: ["image"],
  css: ["stylesheet"],
  font: ["font"],
  other: ["document", "media", "websocket", "ping", "other"],
};

const filter = ref<Filter>("all");
const search = ref("");
const copied = ref<number | null>(null);

const blockedCount = computed(() => props.entries.filter(e => e.blocked).length);

const filtered = computed(() => {
  let result = props.entries;
  if (filter.value !== "all") {
    const types = FILTER_TYPES[filter.value];
    result = result.filter(e => types.includes(e.resource_type));
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    result = result.filter(e => e.url.toLowerCase().includes(q));
  }
  return result;
});

function copyUrl(url: string, idx: number) {
  navigator.clipboard.writeText(url);
  copied.value = idx;
  setTimeout(() => { copied.value = null; }, 1200);
}

function urlPath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname + u.search || "/";
  } catch { return raw; }
}

function urlHost(raw: string): string {
  try { return new URL(raw).hostname; } catch { return ""; }
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
      <span class="history-title">network</span>
      <span class="network-stats">
        {{ entries.length }}<span v-if="blockedCount > 0" class="network-blocked-count"> / {{ blockedCount }} blocked</span>
      </span>
      <div class="history-clear-wrap">
        <button class="history-clear-btn" @click="emit('clear')">clear</button>
      </div>
    </div>

    <div class="history-search">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
        <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <input
        v-model="search"
        placeholder="filter requests..."
        spellcheck="false"
      />
      <button v-if="search" class="tab-search-clear" @click="search = ''">×</button>
    </div>

    <div class="network-filter-row">
      <button
        v-for="f in FILTERS"
        :key="f"
        :class="`network-filter-pill${filter === f ? ' active' : ''}`"
        @click="filter = f"
      >
        {{ f }}
      </button>
    </div>

    <div class="history-list">
      <div v-if="filtered.length === 0" class="history-empty">
        {{ entries.length === 0 ? "no requests yet" : "no matches" }}
      </div>
      <div
        v-for="(e, i) in filtered"
        :key="i"
        :class="`history-entry${e.blocked ? ' network-blocked' : ''}`"
        :title="e.blocked && e.filter_rule ? `blocked: ${e.filter_rule}` : e.url"
        @click="copyUrl(e.url, i)"
      >
        <span :class="`network-tag ${e.blocked ? 'blocked' : e.resource_type}`">
          {{ e.blocked ? "x" : (TYPE_LABELS[e.resource_type] || e.resource_type) }}
        </span>
        <div class="history-entry-text">
          <span class="history-entry-title">{{ copied === i ? "copied!" : urlPath(e.url) }}</span>
          <span class="history-entry-url">{{ urlHost(e.url) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
