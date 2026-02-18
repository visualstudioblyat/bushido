import { create } from "zustand";
import { DropZone, PageCtxMenu } from "./storeTypes";

interface UiState {
  sidebarOpen: boolean;
  compactMode: boolean;
  findOpen: boolean;
  historyOpen: boolean;
  cmdOpen: boolean;
  downloadsOpen: boolean;
  showOnboarding: boolean;
  urlQuery: string;
  draggingDiv: number | null;
  dropZone: DropZone | null;
  dragOverContent: boolean;
  pageCtx: PageCtxMenu | null;

  setSidebarOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  setCompactMode: (v: boolean | ((p: boolean) => boolean)) => void;
  setFindOpen: (v: boolean) => void;
  setHistoryOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  setCmdOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  setDownloadsOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowOnboarding: (v: boolean) => void;
  setUrlQuery: (v: string) => void;
  setDraggingDiv: (v: number | null) => void;
  setDropZone: (v: DropZone | null) => void;
  setDragOverContent: (v: boolean) => void;
  setPageCtx: (v: PageCtxMenu | null) => void;
}

const toggle = (v: boolean | ((p: boolean) => boolean), prev: boolean) =>
  typeof v === "function" ? v(prev) : v;

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  compactMode: false,
  findOpen: false,
  historyOpen: false,
  cmdOpen: false,
  downloadsOpen: false,
  showOnboarding: false,
  urlQuery: "",
  draggingDiv: null,
  dropZone: null,
  dragOverContent: false,
  pageCtx: null,

  setSidebarOpen: (v) => set((s) => ({ sidebarOpen: toggle(v, s.sidebarOpen) })),
  setCompactMode: (v) => set((s) => ({ compactMode: toggle(v, s.compactMode) })),
  setFindOpen: (v) => set({ findOpen: v }),
  setHistoryOpen: (v) => set((s) => ({ historyOpen: toggle(v, s.historyOpen) })),
  setCmdOpen: (v) => set((s) => ({ cmdOpen: toggle(v, s.cmdOpen) })),
  setDownloadsOpen: (v) => set((s) => ({ downloadsOpen: toggle(v, s.downloadsOpen) })),
  setShowOnboarding: (v) => set({ showOnboarding: v }),
  setUrlQuery: (v) => set({ urlQuery: v }),
  setDraggingDiv: (v) => set({ draggingDiv: v }),
  setDropZone: (v) => set({ dropZone: v }),
  setDragOverContent: (v) => set({ dragOverContent: v }),
  setPageCtx: (v) => set({ pageCtx: v }),
}));
