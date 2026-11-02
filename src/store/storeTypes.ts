// types used by stores that aren't in ../types.ts

export interface PageCtxMenu {
  x: number; y: number;
  kind: "page" | "image" | "selection" | "audio" | "video";
  linkUri: string; sourceUri: string; selectionText: string;
  pageUri: string; isEditable: boolean; tabId: string;
}

// re-export DropZone from types
export type { DropZone } from "../types";
