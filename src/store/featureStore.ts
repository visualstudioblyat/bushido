import { create } from "zustand";
import { WebPanel } from "../types";

interface GlanceState {
  id: string;
  url: string;
  title: string;
  sourceTabId: string;
}

interface ReaderSettings {
  fontSize: number;
  font: "serif" | "sans";
  theme: "dark" | "light" | "sepia";
  lineWidth: number;
}

interface FeatureState {
  screenshotPreview: string | null;
  annotationData: string | null;
  shareOpen: boolean;
  readerTabs: Set<string>;
  readerSettings: ReaderSettings;
  hasVideo: boolean;
  pipActive: boolean;
  panels: WebPanel[];
  activePanelId: string | null;
  glance: GlanceState | null;

  setScreenshotPreview: (v: string | null) => void;
  setAnnotationData: (v: string | null) => void;
  setShareOpen: (v: boolean) => void;
  setReaderTabs: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setReaderSettings: (updater: ReaderSettings | ((prev: ReaderSettings) => ReaderSettings)) => void;
  setHasVideo: (v: boolean) => void;
  setPipActive: (v: boolean) => void;
  setPanels: (updater: WebPanel[] | ((prev: WebPanel[]) => WebPanel[])) => void;
  setActivePanelId: (v: string | null) => void;
  setGlance: (v: GlanceState | null | ((prev: GlanceState | null) => GlanceState | null)) => void;
}

export const useFeatureStore = create<FeatureState>((set) => ({
  screenshotPreview: null,
  annotationData: null,
  shareOpen: false,
  readerTabs: new Set(),
  readerSettings: { fontSize: 18, font: "serif", theme: "dark", lineWidth: 680 },
  hasVideo: false,
  pipActive: false,
  panels: [],
  activePanelId: null,
  glance: null,

  setScreenshotPreview: (v) => set({ screenshotPreview: v }),
  setAnnotationData: (v) => set({ annotationData: v }),
  setShareOpen: (v) => set({ shareOpen: v }),
  setReaderTabs: (updater) =>
    set((s) => ({ readerTabs: typeof updater === "function" ? updater(s.readerTabs) : updater })),
  setReaderSettings: (updater) =>
    set((s) => ({ readerSettings: typeof updater === "function" ? updater(s.readerSettings) : updater })),
  setHasVideo: (v) => set({ hasVideo: v }),
  setPipActive: (v) => set({ pipActive: v }),
  setPanels: (updater) =>
    set((s) => ({ panels: typeof updater === "function" ? updater(s.panels) : updater })),
  setActivePanelId: (v) => set({ activePanelId: v }),
  setGlance: (v) =>
    set((s) => ({ glance: typeof v === "function" ? v(s.glance) : v })),
}));
