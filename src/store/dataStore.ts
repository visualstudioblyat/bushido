import { create } from "zustand";
import { HistoryEntry, BookmarkData, DownloadItem, BushidoSettings, DEFAULT_SETTINGS } from "../types";

interface DataState {
  historyEntries: HistoryEntry[];
  bookmarkData: BookmarkData;
  downloads: DownloadItem[];
  settings: BushidoSettings;

  setHistoryEntries: (updater: HistoryEntry[] | ((prev: HistoryEntry[]) => HistoryEntry[])) => void;
  setBookmarkData: (updater: BookmarkData | ((prev: BookmarkData) => BookmarkData)) => void;
  setDownloads: (updater: DownloadItem[] | ((prev: DownloadItem[]) => DownloadItem[])) => void;
  setSettings: (updater: BushidoSettings | ((prev: BushidoSettings) => BushidoSettings)) => void;
}

export const useDataStore = create<DataState>((set) => ({
  historyEntries: [],
  bookmarkData: { bookmarks: [], folders: [] },
  downloads: [],
  settings: { ...DEFAULT_SETTINGS },

  setHistoryEntries: (updater) =>
    set((s) => ({ historyEntries: typeof updater === "function" ? updater(s.historyEntries) : updater })),

  setBookmarkData: (updater) =>
    set((s) => ({ bookmarkData: typeof updater === "function" ? updater(s.bookmarkData) : updater })),

  setDownloads: (updater) =>
    set((s) => ({ downloads: typeof updater === "function" ? updater(s.downloads) : updater })),

  setSettings: (updater) =>
    set((s) => ({ settings: typeof updater === "function" ? updater(s.settings) : updater })),
}));
