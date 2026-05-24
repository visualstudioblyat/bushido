import { describe, it, expect } from "vitest";
import {
  countLeaves,
  allLeafIds,
  hasLeaf,
  findParent,
  insertPane,
  removePane,
  replaceTabId,
  updateRatio,
  computeRects,
} from "../splitLayout";
import type { PaneSplit, PaneLeaf } from "../types";

const leaf = (id: string): PaneLeaf => ({ type: "leaf", tabId: id });

const twoPane: PaneSplit = {
  type: "split",
  dir: "row",
  children: [
    { pane: leaf("a"), ratio: 0.5 },
    { pane: leaf("b"), ratio: 0.5 },
  ],
};

const threePaneNested: PaneSplit = {
  type: "split",
  dir: "row",
  children: [
    { pane: leaf("a"), ratio: 0.5 },
    {
      pane: {
        type: "split",
        dir: "col",
        children: [
          { pane: leaf("b"), ratio: 0.6 },
          { pane: leaf("c"), ratio: 0.4 },
        ],
      },
      ratio: 0.5,
    },
  ],
};

describe("countLeaves", () => {
  it("counts a single leaf", () => {
    expect(countLeaves(leaf("x"))).toBe(1);
  });

  it("counts two-pane split", () => {
    expect(countLeaves(twoPane)).toBe(2);
  });

  it("counts nested split", () => {
    expect(countLeaves(threePaneNested)).toBe(3);
  });
});

describe("allLeafIds", () => {
  it("returns single leaf id", () => {
    expect(allLeafIds(leaf("x"))).toEqual(["x"]);
  });

  it("returns all ids from nested tree", () => {
    expect(allLeafIds(threePaneNested)).toEqual(["a", "b", "c"]);
  });
});

describe("hasLeaf", () => {
  it("finds existing leaf", () => {
    expect(hasLeaf(threePaneNested, "c")).toBe(true);
  });

  it("returns false for missing leaf", () => {
    expect(hasLeaf(threePaneNested, "z")).toBe(false);
  });
});

describe("findParent", () => {
  it("finds top-level child", () => {
    const result = findParent(twoPane, "a");
    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
  });

  it("finds nested child", () => {
    const result = findParent(threePaneNested, "c");
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
  });

  it("returns null for missing tab", () => {
    expect(findParent(twoPane, "z")).toBeNull();
  });
});

describe("insertPane", () => {
  it("creates initial split from null root", () => {
    const result = insertPane(null, "a", "b", "right");
    expect(result).not.toBeNull();
    expect(result!.dir).toBe("row");
    expect(allLeafIds(result!)).toEqual(["a", "b"]);
  });

  it("inserts left puts new tab first", () => {
    const result = insertPane(null, "a", "b", "left");
    expect(allLeafIds(result!)).toEqual(["b", "a"]);
  });

  it("inserts bottom creates col split", () => {
    const result = insertPane(null, "a", "b", "bottom");
    expect(result!.dir).toBe("col");
  });

  it("returns null when at max panes", () => {
    const fourPane = insertPane(
      insertPane(twoPane, "a", "c", "right")!,
      "a", "d", "right"
    )!;
    expect(countLeaves(fourPane)).toBe(4);
    expect(insertPane(fourPane, "a", "e", "right")).toBeNull();
  });
});

describe("removePane", () => {
  it("returns null when only 2 leaves (would leave 1)", () => {
    expect(removePane(twoPane, "a")).toBeNull();
  });

  it("removes a leaf from 3-pane layout", () => {
    const result = removePane(threePaneNested, "c");
    expect(result).not.toBeNull();
    expect(countLeaves(result!)).toBe(2);
    expect(hasLeaf(result!, "c")).toBe(false);
  });
});

describe("replaceTabId", () => {
  it("replaces in leaf", () => {
    const result = replaceTabId(leaf("old"), "old", "new");
    expect(result).toEqual(leaf("new"));
  });

  it("replaces in nested tree", () => {
    const result = replaceTabId(threePaneNested, "b", "B");
    expect(hasLeaf(result, "B")).toBe(true);
    expect(hasLeaf(result, "b")).toBe(false);
  });

  it("no-ops when id not found", () => {
    const result = replaceTabId(twoPane, "z", "Z");
    expect(allLeafIds(result)).toEqual(["a", "b"]);
  });
});

describe("updateRatio", () => {
  it("adjusts ratio between children", () => {
    const result = updateRatio(twoPane, [], 0, 0.1);
    const ratios = result.children.map(c => c.ratio);
    expect(ratios[0]).toBeCloseTo(0.6);
    expect(ratios[1]).toBeCloseTo(0.4);
  });

  it("clamps to minimum ratio", () => {
    const result = updateRatio(twoPane, [], 0, -0.5);
    expect(result.children[0].ratio).toBeGreaterThanOrEqual(0.15);
  });
});

describe("computeRects", () => {
  it("returns single rect for leaf", () => {
    const rects = computeRects(leaf("a"), { x: 0, y: 0, w: 1000, h: 800 });
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ tabId: "a", x: 0, y: 0, w: 1000, h: 800 });
  });

  it("splits row evenly minus gap", () => {
    const rects = computeRects(twoPane, { x: 0, y: 0, w: 1004, h: 800 });
    expect(rects).toHaveLength(2);
    expect(rects[0].w).toBe(500);
    expect(rects[1].w).toBe(500);
    expect(rects[1].x).toBe(504); // 500 + 4 gap
  });

  it("computes nested rects", () => {
    const rects = computeRects(threePaneNested, { x: 0, y: 0, w: 1004, h: 800 });
    expect(rects).toHaveLength(3);
    expect(rects[0].tabId).toBe("a");
    expect(rects[1].tabId).toBe("b");
    expect(rects[2].tabId).toBe("c");
  });
});
