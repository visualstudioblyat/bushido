<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useUiStore } from "./stores/ui";
import NewTabPage from "./components/NewTabPage.vue";
import type { FrecencyResult } from "../src/types";

// Vue migration shell. The React app (src/) remains the shipping entry;
// this parallel track proves Bun + Vite + Vue 3 + Pinia + Tauri integration.
const ui = useUiStore();
const topSites = ref<FrecencyResult[]>([]);
const tauriOk = ref<boolean | null>(null);

onMounted(async () => {
  // Prove Tauri IPC works from Vue — degrade gracefully in a plain browser.
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("load_history");
    tauriOk.value = true;
  } catch {
    tauriOk.value = false;
  }
});

function onNavigate(url: string) { ui.urlQuery = url; }
function onSelectSite(url: string) { ui.urlQuery = url; }
</script>

<template>
  <div class="app vue-shell">
    <NewTabPage :top-sites="topSites" @navigate="onNavigate" @select-site="onSelectSite" />
    <div class="vue-shell-status">
      Vue migration shell · Tauri IPC:
      <span v-if="tauriOk === null">checking…</span>
      <span v-else-if="tauriOk">connected</span>
      <span v-else>not in Tauri (browser preview)</span>
      <template v-if="ui.urlQuery"> · last query: {{ ui.urlQuery }}</template>
    </div>
  </div>
</template>

<style>
.vue-shell-status {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font: 12px/1.4 system-ui;
  color: #a1a1aa;
  background: rgba(0,0,0,0.35);
  padding: 6px 12px;
  border-radius: 8px;
}
</style>
