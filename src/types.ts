export interface WebPanel {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

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
  mediaState?: "playing" | "paused";
  mediaTitle?: string;
}

// split view layout tree
export type SplitDir = "row" | "col";

export interface PaneLeaf { type: "leaf"; tabId: string }
export interface PaneChild { pane: PaneLeaf | PaneSplit; ratio: number }
export interface PaneSplit { type: "split"; dir: SplitDir; children: PaneChild[] }

export interface PaneRect { tabId: string; x: number; y: number; w: number; h: number }

export interface DividerInfo {
  dir: SplitDir;
  x: number; y: number; w: number; h: number;
  path: number[];
  childIdx: number;
}

export interface DropZone {
  anchorTabId: string;
  side: "left" | "right" | "top" | "bottom";
  previewRect: { x: number; y: number; w: number; h: number };
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  activeTabId: string;
  paneLayout?: PaneSplit;
}

export interface SessionData {
  workspaces: { id: string; name: string; color: string; activeTabId: string; paneLayout?: PaneSplit }[];
  tabs: { id: string; url: string; title: string; pinned?: boolean; workspaceId: string; parentId?: string; suspended?: boolean }[];
  activeWorkspaceId: string;
  compactMode?: boolean;
  panels?: { id: string; url: string; title: string; favicon?: string }[];
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

export type DownloadState = 'downloading' | 'paused' | 'completed' | 'failed';
export interface DownloadItem {
  id: string;
  url: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  totalBytes: number | null;
  receivedBytes: number;
  state: DownloadState;
  speed: number;
  error: string | null;
  createdAt: number;
  supportsRange: boolean;
  segments: number; // 0 = single-stream, >1 = parallel connections
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
