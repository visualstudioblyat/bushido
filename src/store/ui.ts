import { defineStore } from "pinia";
import { ref } from "vue";
import type { DropZone, PageCtxMenu } from "./storeTypes";

// Pinia port of the React/zustand useUiStore (src/store/uiStore.ts).
export const useUiStore = defineStore("ui", () => {
  const sidebarOpen = ref(true);
  const compactMode = ref(false);
  const findOpen = ref(false);
  const historyOpen = ref(false);
  const cmdOpen = ref(false);
  const downloadsOpen = ref(false);
  const networkOpen = ref(false);
  const showOnboarding = ref(false);
  const urlQuery = ref("");
  const draggingDiv = ref<number | null>(null);
  const dropZone = ref<DropZone | null>(null);
  const dragOverContent = ref(false);
  const pageCtx = ref<PageCtxMenu | null>(null);
  const errorToast = ref<string | null>(null);

  function showError(msg: string) {
    errorToast.value = msg;
    setTimeout(() => { errorToast.value = null; }, 4000);
  }

  return {
    sidebarOpen, compactMode, findOpen, historyOpen, cmdOpen,
    downloadsOpen, networkOpen, showOnboarding, urlQuery,
    draggingDiv, dropZone, dragOverContent, pageCtx, errorToast,
    showError,
  };
});
