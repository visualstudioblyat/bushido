import { defineStore } from "pinia";
import { ref } from "vue";
import type { WebPanel } from "../../src/types";

// Pinia port of src/store/featureStore.ts. Zustand's functional updaters
// (setReaderTabs, setPanels, setGlance, ...) collapse into direct ref
// mutation: Vue refs of Set/array/object are deeply reactive.
export interface GlanceState {
  id: string;
  url: string;
  title: string;
  sourceTabId: string;
}

export interface ReaderSettings {
  fontSize: number;
  font: "serif" | "sans";
  theme: "dark" | "light" | "sepia";
  lineWidth: number;
}

export const useFeatureStore = defineStore("feature", () => {
  const screenshotPreview = ref<string | null>(null);
  const annotationData = ref<string | null>(null);
  const shareOpen = ref(false);
  const readerTabs = ref(new Set<string>());
  const readerSettings = ref<ReaderSettings>({ fontSize: 18, font: "serif", theme: "dark", lineWidth: 680 });
  const hasVideo = ref(false);
  const pipActive = ref(false);
  const panels = ref<WebPanel[]>([]);
  const activePanelId = ref<string | null>(null);
  const glance = ref<GlanceState | null>(null);

  return {
    screenshotPreview, annotationData, shareOpen, readerTabs, readerSettings,
    hasVideo, pipActive, panels, activePanelId, glance,
  };
});
