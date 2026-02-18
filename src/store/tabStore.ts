import { create } from "zustand";
import { Tab, Workspace, PaneSplit } from "../types";

interface TabState {
  tabs: Tab[];
  workspaces: Workspace[];
  activeWorkspaceId: string;

  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setWorkspaces: (updater: Workspace[] | ((prev: Workspace[]) => Workspace[])) => void;
  setActiveWorkspaceId: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  workspaces: [],
  activeWorkspaceId: "",

  setTabs: (updater) =>
    set((s) => ({ tabs: typeof updater === "function" ? updater(s.tabs) : updater })),

  setWorkspaces: (updater) =>
    set((s) => ({ workspaces: typeof updater === "function" ? updater(s.workspaces) : updater })),

  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  updateWorkspace: (id, patch) =>
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
}));
