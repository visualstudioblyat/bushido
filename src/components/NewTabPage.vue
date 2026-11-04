<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { FrecencyResult } from "../types";

const props = withDefaults(defineProps<{
  topSites: FrecencyResult[];
  showClock?: boolean;
  showGreeting?: boolean;
}>(), {
  showClock: true,
  showGreeting: true,
});

const emit = defineEmits<{
  navigate: [url: string];
  selectSite: [url: string];
}>();

const query = ref("");
const time = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => { timer = setInterval(() => { time.value = new Date(); }, 60_000); });
onUnmounted(() => { if (timer) clearInterval(timer); });

const greeting = computed(() => {
  const h = time.value.getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
});

const clock = computed(() =>
  time.value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

function handleSubmit() {
  if (query.value.trim()) emit("navigate", query.value.trim());
}

function domainOf(s: FrecencyResult): string {
  try { return new URL(s.url).hostname.replace("www.", ""); }
  catch { return s.title; }
}
</script>

<template>
  <div class="ntp">
    <div class="ntp-center">
      <div v-if="showClock" class="ntp-clock">{{ clock }}</div>
      <div v-if="showGreeting" class="ntp-greeting">{{ greeting }}</div>
      <form class="ntp-search" @submit.prevent="handleSubmit">
        <input
          class="ntp-search-input"
          v-model="query"
          placeholder="search the web..."
          autofocus
          :spellcheck="false"
        />
      </form>
      <div class="ntp-sites">
        <div
          v-for="s in topSites"
          :key="s.url"
          class="ntp-site"
          @click="emit('selectSite', s.url)"
        >
          <div class="ntp-site-icon">
            <img v-if="s.favicon" :src="s.favicon" alt="" width="28" height="28" />
            <span v-else class="ntp-site-placeholder">
              {{ (domainOf(s).charAt(0) || '?').toUpperCase() }}
            </span>
          </div>
          <span class="ntp-site-label">{{ domainOf(s) || s.title }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
