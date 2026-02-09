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
