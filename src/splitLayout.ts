import { PaneLeaf, PaneSplit, PaneChild, PaneRect, DividerInfo, DropZone, SplitDir } from "./types";

const MAX_PANES = 4;
const MIN_RATIO = 0.15;
const GAP = 4; // divider width in px

type Pane = PaneLeaf | PaneSplit;
type Side = "left" | "right" | "top" | "bottom";

// --- queries ---

export function countLeaves(node: Pane): number {
  if (node.type === "leaf") return 1;
  return node.children.reduce((n, c) => n + countLeaves(c.pane), 0);
}

export function allLeafIds(node: Pane): string[] {
  if (node.type === "leaf") return [node.tabId];
  const ids: string[] = [];
  for (const c of node.children) ids.push(...allLeafIds(c.pane));
  return ids;
}

export function hasLeaf(node: Pane, tabId: string): boolean {
  if (node.type === "leaf") return node.tabId === tabId;
  return node.children.some(c => hasLeaf(c.pane, tabId));
}

// find parent split + child index for a given tabId
export function findParent(root: PaneSplit, tabId: string): { parent: PaneSplit; index: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i].pane;
    if (c.type === "leaf" && c.tabId === tabId) return { parent: root, index: i };
    if (c.type === "split") {
      const found = findParent(c, tabId);
      if (found) return found;
    }
  }
  return null;
}

// --- mutations (immutable, return new trees) ---

function sideToDir(side: Side): SplitDir {
  return side === "left" || side === "right" ? "row" : "col";
}

function cloneNode(node: Pane): Pane {
  if (node.type === "leaf") return { type: "leaf", tabId: node.tabId };
  return {
    type: "split",
    dir: node.dir,
    children: node.children.map(c => ({ pane: cloneNode(c.pane), ratio: c.ratio })),
  };
}

// insert a new tab next to an existing leaf
export function insertPane(root: PaneSplit | null, anchorTabId: string, newTabId: string, side: Side): PaneSplit | null {
  // no layout yet — create initial split
  if (!root) {
    const dir = sideToDir(side);
    const first: PaneChild = { pane: { type: "leaf", tabId: anchorTabId }, ratio: 0.5 };
    const second: PaneChild = { pane: { type: "leaf", tabId: newTabId }, ratio: 0.5 };
    const children = side === "right" || side === "bottom" ? [first, second] : [second, first];
    return { type: "split", dir, children };
  }

  if (countLeaves(root) >= MAX_PANES) return null;

  const newRoot = cloneNode(root) as PaneSplit;
  const found = findParent(newRoot, anchorTabId);
  if (!found) return null;

  const { parent, index } = found;
  const dir = sideToDir(side);
  const prepend = side === "left" || side === "top";
  const newLeaf: PaneChild = { pane: { type: "leaf", tabId: newTabId }, ratio: 0 };

  if (parent.dir === dir) {
    // same direction — insert as sibling, steal half of anchor's ratio
    const anchorRatio = parent.children[index].ratio;
    const half = anchorRatio / 2;
    parent.children[index].ratio = half;
    newLeaf.ratio = half;
    const insertAt = prepend ? index : index + 1;
    parent.children.splice(insertAt, 0, newLeaf);
  } else {
    // different direction — wrap anchor in a new split
    const anchor = parent.children[index];
    const innerChildren: PaneChild[] = prepend
      ? [{ pane: { type: "leaf", tabId: newTabId }, ratio: 0.5 }, { pane: anchor.pane, ratio: 0.5 }]
      : [{ pane: anchor.pane, ratio: 0.5 }, { pane: { type: "leaf", tabId: newTabId }, ratio: 0.5 }];
    parent.children[index] = {
      pane: { type: "split", dir, children: innerChildren },
      ratio: anchor.ratio,
    };
  }

  return newRoot;
}

// remove a leaf. returns null if only 1 leaf would remain (caller should exit split)
export function removePane(root: PaneSplit, tabId: string): PaneSplit | null {
  if (countLeaves(root) <= 2) return null; // removing one leaves 1 — exit split

  const newRoot = cloneNode(root) as PaneSplit;
  return removePaneInner(newRoot, tabId);
}

function removePaneInner(node: PaneSplit, tabId: string): PaneSplit | null {
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i];
    if (c.pane.type === "leaf" && c.pane.tabId === tabId) {
      // remove this child, redistribute ratio
      const removed = node.children.splice(i, 1)[0];
      const scale = 1 / (1 - removed.ratio);
      node.children.forEach(ch => ch.ratio *= scale);

      // if only 1 child remains, collapse this split node
      if (node.children.length === 1) {
        // return the child's pane promoted to this level
        // but we need to return PaneSplit, so if child is a leaf we wrap
        // actually the caller handles collapsing — let's just return as-is
        // the parent will see a single-child split and can collapse
      }
      return collapseTree(node);
    }
    if (c.pane.type === "split") {
      const result = removePaneInner(c.pane, tabId);
      if (result) {
        c.pane = result;
        return collapseTree(node);
      }
    }
  }
  return null;
}

// collapse single-child splits recursively
function collapseTree(node: PaneSplit): PaneSplit {
  // collapse children first
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i];
    if (c.pane.type === "split") {
      c.pane = collapseTree(c.pane);
      // if child split has only 1 child, promote it
      if (c.pane.children.length === 1) {
        const promoted = c.pane.children[0];
        node.children[i] = { pane: promoted.pane, ratio: c.ratio };
      }
    }
  }
  return node;
}

// replace a tab id in the tree (for session restore)
export function replaceTabId(node: Pane, oldId: string, newId: string): Pane {
  if (node.type === "leaf") {
    return node.tabId === oldId ? { type: "leaf", tabId: newId } : node;
  }
  return {
    type: "split",
    dir: node.dir,
    children: node.children.map(c => ({
      pane: replaceTabId(c.pane, oldId, newId),
      ratio: c.ratio,
    })),
  };
}

// update ratio between adjacent children
export function updateRatio(root: PaneSplit, path: number[], childIdx: number, delta: number): PaneSplit {
  const newRoot = cloneNode(root) as PaneSplit;

  // navigate to the target split node via path
  let target: PaneSplit = newRoot;
  for (const idx of path) {
    const c = target.children[idx]?.pane;
    if (!c || c.type !== "split") return newRoot; // invalid path
    target = c;
  }

  const a = target.children[childIdx];
  const b = target.children[childIdx + 1];
  if (!a || !b) return newRoot;

  const newA = Math.max(MIN_RATIO, Math.min(a.ratio + b.ratio - MIN_RATIO, a.ratio + delta));
  const newB = a.ratio + b.ratio - newA;
  a.ratio = newA;
  b.ratio = newB;

  return newRoot;
}

// --- layout computation ---

export function computeRects(node: Pane, rect: { x: number; y: number; w: number; h: number }): PaneRect[] {
  if (node.type === "leaf") {
    return [{ tabId: node.tabId, x: rect.x, y: rect.y, w: rect.w, h: rect.h }];
  }

  const n = node.children.length;
  const totalGap = (n - 1) * GAP;
  const isRow = node.dir === "row";
  const available = (isRow ? rect.w : rect.h) - totalGap;
  const rects: PaneRect[] = [];

  let offset = isRow ? rect.x : rect.y;
  for (let i = 0; i < n; i++) {
    const child = node.children[i];
    const size = available * child.ratio;
    const childRect = isRow
      ? { x: offset, y: rect.y, w: size, h: rect.h }
      : { x: rect.x, y: offset, w: rect.w, h: size };
    rects.push(...computeRects(child.pane, childRect));
    offset += size + GAP;
  }

  return rects;
}

export function computeDividers(node: Pane, rect: { x: number; y: number; w: number; h: number }, path: number[] = []): DividerInfo[] {
  if (node.type === "leaf") return [];

  const n = node.children.length;
  const totalGap = (n - 1) * GAP;
  const isRow = node.dir === "row";
  const available = (isRow ? rect.w : rect.h) - totalGap;
  const dividers: DividerInfo[] = [];

  let offset = isRow ? rect.x : rect.y;
  for (let i = 0; i < n; i++) {
    const child = node.children[i];
    const size = available * child.ratio;
    const childRect = isRow
      ? { x: offset, y: rect.y, w: size, h: rect.h }
      : { x: rect.x, y: offset, w: rect.w, h: size };

    // recurse into child
    dividers.push(...computeDividers(child.pane, childRect, [...path, i]));

    // add divider after this child (except the last)
    if (i < n - 1) {
      const divRect = isRow
        ? { x: offset + size, y: rect.y, w: GAP, h: rect.h }
        : { x: rect.x, y: offset + size, w: rect.w, h: GAP };
      dividers.push({ dir: node.dir, ...divRect, path, childIdx: i });
    }

    offset += size + GAP;
  }

  return dividers;
}

// detect which drop zone the cursor is in
export function detectDropZone(
  layout: PaneSplit | undefined,
  activeTabId: string,
  contentRect: { x: number; y: number; w: number; h: number },
  cursorX: number,
  cursorY: number,
): DropZone | null {
  const leafCount = layout ? countLeaves(layout) : 1;
  if (leafCount >= MAX_PANES) return null;

  // get all leaf rects
  let rects: PaneRect[];
  if (layout) {
    rects = computeRects(layout, contentRect);
  } else {
    rects = [{ tabId: activeTabId, x: contentRect.x, y: contentRect.y, w: contentRect.w, h: contentRect.h }];
  }

  // find which rect cursor is in
  const hit = rects.find(r =>
    cursorX >= r.x && cursorX <= r.x + r.w &&
    cursorY >= r.y && cursorY <= r.y + r.h
  );
  if (!hit) return null;

  // compute relative position within the hit rect
  const relX = (cursorX - hit.x) / hit.w;
  const relY = (cursorY - hit.y) / hit.h;

  // determine edge (quarter zones)
  const edge = 0.25;
  let side: Side;
  if (relX < edge) side = "left";
  else if (relX > 1 - edge) side = "right";
  else if (relY < edge) side = "top";
  else if (relY > 1 - edge) side = "bottom";
  else return null; // center — no drop

  // compute preview rect (half of the hit pane on that side)
  let previewRect: { x: number; y: number; w: number; h: number };
  switch (side) {
    case "left": previewRect = { x: hit.x, y: hit.y, w: hit.w / 2, h: hit.h }; break;
    case "right": previewRect = { x: hit.x + hit.w / 2, y: hit.y, w: hit.w / 2, h: hit.h }; break;
    case "top": previewRect = { x: hit.x, y: hit.y, w: hit.w, h: hit.h / 2 }; break;
    case "bottom": previewRect = { x: hit.x, y: hit.y + hit.h / 2, w: hit.w, h: hit.h / 2 }; break;
  }

  return { anchorTabId: hit.tabId, side, previewRect };
}
