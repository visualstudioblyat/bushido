export interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  favicon?: string;
  pinned?: boolean;
  blockedCount?: number;
  whitelisted?: boolean;
  workspaceId: string;
  parentId?: string;
  collapsed?: boolean;
  suspended?: boolean;
  lastActiveAt?: number;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  activeTabId: string;
}

export interface SessionData {
  workspaces: { id: string; name: string; color: string; activeTabId: string }[];
  tabs: { url: string; title: string; pinned?: boolean; workspaceId: string; parentId?: string }[];
  activeWorkspaceId: string;
  compactMode?: boolean;
}

export interface HistoryEntry {
  url: string;
  title: string;
  favicon?: string;
  visitCount: number;
  lastVisitAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  folderId: string;
  createdAt: number;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  parentId: string;
  order: number;
}

export interface BookmarkData {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
}

export interface FrecencyResult {
  url: string;
  title: string;
  favicon?: string;
  score: number;
  type: 'history' | 'bookmark';
}

export interface BushidoSettings {
  searchEngine: "google" | "duckduckgo" | "brave" | "bing" | "custom";
  customSearchUrl: string;
  onStartup: "restore" | "newtab";
  showTopSites: boolean;
  showClock: boolean;
  showGreeting: boolean;
  downloadLocation: string;
  askDownloadLocation: boolean;
  httpsOnly: boolean;
  adBlocker: boolean;
  cookieAutoReject: boolean;
  clearDataOnExit: boolean;
  compactMode: boolean;
  suspendTimeout: number; // minutes, 0 = never
}

export const DEFAULT_SETTINGS: BushidoSettings = {
  searchEngine: "google",
  customSearchUrl: "",
  onStartup: "restore",
  showTopSites: true,
  showClock: true,
  showGreeting: true,
  downloadLocation: "",
  askDownloadLocation: false,
  httpsOnly: true,
  adBlocker: true,
  cookieAutoReject: true,
  clearDataOnExit: false,
  compactMode: false,
  suspendTimeout: 5,
};
