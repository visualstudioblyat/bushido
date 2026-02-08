export interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  favicon?: string;
  pinned?: boolean;
  blockedCount?: number;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  tabIds: string[];
}
