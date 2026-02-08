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
