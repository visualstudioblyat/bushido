import { defineStore } from "pinia";
import { ref } from "vue";
import type { HistoryEntry, BookmarkData, DownloadItem, DigidawSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

// Pinia port of src/store/dataStore.ts.
export const useDataStore = defineStore("data", () => {
  const historyEntries = ref<HistoryEntry[]>([]);
  const bookmarkData = ref<BookmarkData>({ bookmarks: [], folders: [] });
  const downloads = ref<DownloadItem[]>([]);
  const settings = ref<DigidawSettings>({ ...DEFAULT_SETTINGS });

  return { historyEntries, bookmarkData, downloads, settings };
});
