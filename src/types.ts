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
  memoryState?: "active" | "suspended" | "destroyed";
  mediaState?: "playing" | "paused";
  mediaTitle?: string;
  crashed?: boolean;
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
  order: number;
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
  onStartup: "restore" | "newtab" | "custom";
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
  disableDevTools: boolean;
  disableStatusBar: boolean;
  disableAutofill: boolean;
  disablePasswordSave: boolean;
  blockServiceWorkers: boolean;
  blockFontEnumeration: boolean;
  spoofHardwareConcurrency: boolean;
  onboardingComplete: boolean;
  accentColor: string;
  themeMode: "dark" | "light";
  syncEnabled: boolean;
  syncDeviceName: string;
  topSiteRows: number;
  suspendExcludedUrls: string;
  selectRecentTabOnClose: boolean;
  confirmCloseMultiple: boolean;
  customHomepageUrl: string;
  defaultZoom: number;
  confirmBeforeQuit: boolean;
  searchSuggestions: boolean;
  blockPopups: boolean;
  autoplayPolicy: "block-all" | "block-audio" | "allow";
  showMediaControls: boolean;
  showDomainOnly: boolean;
  keybindings: Record<string, string>;
  bandwidthLimit: number;
  mimeRouting: MimeRoute[];
  vaultAutoLock: boolean;
  vaultLockTimeout: number;
}

export type PermissionKindType = "microphone" | "camera" | "geolocation" | "notifications" | "othersensors" | "clipboardread" | "filereadwrite" | "autoplay" | "localfonts" | "midi" | "windowmanagement" | "unknown";

export interface PermissionRequest {
  requestId: string;
  tabId: string;
  uri: string;
  domain: string;
  permission: PermissionKindType;
  isUserInitiated: boolean;
}

export interface SavedPermission {
  domain: string;
  permission: string;
  allowed: boolean;
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
  priority: number;
}

export interface MimeRoute {
  mimePrefix: string;
  folder: string;
}

export interface VaultEntry {
  id: string;
  domain: string;
  username: string;
  password: string;
  notes: string;
  created_at: number;
  updated_at: number;
}

// sync types (Phase D)
export interface SyncTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

export interface DeviceTabs {
  device_id: string;
  device_name?: string;
  tabs: string; // JSON string of SyncTab[]
  timestamp: number;
}

export interface SyncLogEntry {
  timestamp: number;
  type: "connect" | "sync" | "send" | "receive" | "error";
  message: string;
  device?: string;
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
  disableDevTools: false,
  disableStatusBar: false,
  disableAutofill: true,
  disablePasswordSave: true,
  blockServiceWorkers: false,
  blockFontEnumeration: false,
  spoofHardwareConcurrency: false,
  onboardingComplete: false,
  accentColor: "#6366f1",
  themeMode: "dark" as const,
  syncEnabled: false,
  syncDeviceName: "",
  topSiteRows: 2,
  suspendExcludedUrls: "",
  selectRecentTabOnClose: false,
  confirmCloseMultiple: true,
  customHomepageUrl: "",
  defaultZoom: 100,
  confirmBeforeQuit: false,
  searchSuggestions: true,
  blockPopups: true,
  autoplayPolicy: "block-audio",
  showMediaControls: true,
  showDomainOnly: false,
  bandwidthLimit: 0,
  mimeRouting: [
    { mimePrefix: "image/", folder: "" },
    { mimePrefix: "video/", folder: "" },
    { mimePrefix: "audio/", folder: "" },
    { mimePrefix: "application/pdf", folder: "" },
  ],
  vaultAutoLock: true,
  vaultLockTimeout: 0,
  keybindings: {
    "new-tab": "Ctrl+T",
    "close-tab": "Ctrl+W",
    "reopen-tab": "Ctrl+Shift+T",
    "next-tab": "Ctrl+Tab",
    "prev-tab": "Ctrl+Shift+Tab",
    "focus-url": "Ctrl+L",
    "find": "Ctrl+F",
    "command-palette": "Ctrl+K",
    "reload": "Ctrl+R",
    "fullscreen": "F11",
    "bookmark": "Ctrl+D",
    "history": "Ctrl+H",
    "downloads": "Ctrl+J",
    "toggle-sidebar": "Ctrl+B",
    "toggle-compact": "Ctrl+Shift+B",
    "reader-mode": "Ctrl+Shift+R",
    "devtools": "Ctrl+Shift+I",
    "split-view": "Ctrl+\\",
    "print": "Ctrl+P",
    "screenshot": "Ctrl+Shift+S",
    "zoom-in": "Ctrl+=",
    "zoom-out": "Ctrl+-",
    "zoom-reset": "Ctrl+0",
  },
};
