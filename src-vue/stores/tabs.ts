import { defineStore } from "pinia";
import { ref } from "vue";
import type { Tab, Workspace } from "../../src/types";

// Pinia port of src/store/tabStore.ts.
export const useTabStore = defineStore("tabs", () => {
  const tabs = ref<Tab[]>([]);
  const workspaces = ref<Workspace[]>([]);
  const activeWorkspaceId = ref("");

  function updateTab(id: string, patch: Partial<Tab>) {
    tabs.value = tabs.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
  }

  function updateWorkspace(id: string, patch: Partial<Workspace>) {
    workspaces.value = workspaces.value.map((w) => (w.id === id ? { ...w, ...patch } : w));
  }

  return { tabs, workspaces, activeWorkspaceId, updateTab, updateWorkspace };
});
