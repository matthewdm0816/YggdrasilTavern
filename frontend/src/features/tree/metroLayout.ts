import { DisplayTreeItem, getDisplayChildren } from "./treeModel";

export const METRO_LANE_PITCH = 16;
export const METRO_LEFT_PAD = 12;
export const METRO_MAX_VISUAL_LANE = 6;
export const METRO_BRANCH_PALETTE_SIZE = 5;

export type MetroRailSegment =
  | {
      kind: "vertical";
      lane: number;
      y1: 0 | 50;
      y2: 50 | 100;
      colorIndex: number;
      isActivePath: boolean;
    }
  | {
      kind: "fork";
      fromLane: number;
      toLane: number;
      colorIndex: number;
      isActivePath: boolean;
    };

export type MetroRow = {
  id: string;
  item: DisplayTreeItem;
  lane: number;
  colorIndex: number;
  maxLane: number;
  segments: MetroRailSegment[];
  isRootStart: boolean;
};

export type MetroLayout = {
  rows: MetroRow[];
  laneCount: number;
};

type ActiveLaneSlot = {
  targetId: string;
  colorIndex: number;
  isActivePath: boolean;
};

function treeHasActiveNode(items: DisplayTreeItem[]): boolean {
  for (const item of items) {
    if (item.isOnActivePath) return true;
    if (treeHasActiveNode(getDisplayChildren(item))) return true;
  }
  return false;
}

/**
 * Assigns Git-graph / subway style vertical lanes to every visible tree item.
 * Active trunk stays pinned at lane 0; side branches fork smoothly onto lanes >= 1
 * and release their lanes immediately after their leaves so width never scales with depth.
 */
export function layoutMetroForest(roots: DisplayTreeItem[]): MetroLayout {
  if (roots.length === 0) return { rows: [], laneCount: 0 };

  const hasActiveTrunk = treeHasActiveNode(roots);
  const lanes: Array<ActiveLaneSlot | null> = [];
  const rows: MetroRow[] = [];
  let globalMaxLane = 0;
  let branchColorCursor = 0;

  function nextBranchColor(): number {
    const color = (branchColorCursor % METRO_BRANCH_PALETTE_SIZE) + 1;
    branchColorCursor += 1;
    return color;
  }

  function allocateFreeLane(forActivePath: boolean): number {
    if (forActivePath && !lanes[0]) return 0;
    const minLane = hasActiveTrunk && !forActivePath ? 1 : 0;
    for (let index = minLane; index < lanes.length; index += 1) {
      if (!lanes[index]) return index;
    }
    while (lanes.length < minLane) lanes.push(null);
    lanes.push(null);
    return lanes.length - 1;
  }

  function visit(item: DisplayTreeItem, isRootStart: boolean) {
    const existingLane = lanes.findIndex((slot) => slot?.targetId === item.id);
    let nodeLane: number;
    let nodeColorIndex: number;
    let hadIncoming = false;

    if (existingLane >= 0) {
      nodeLane = existingLane;
      nodeColorIndex = lanes[existingLane]!.colorIndex;
      hadIncoming = true;
      lanes[existingLane] = null;
    } else {
      nodeLane = allocateFreeLane(item.isOnActivePath);
      nodeColorIndex = item.isOnActivePath ? 0 : nextBranchColor();
    }

    const segments: MetroRailSegment[] = [];

    // Pass-through rails for other branches currently in flight across this row.
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const slot = lanes[laneIndex];
      if (!slot) continue;
      segments.push({
        kind: "vertical",
        lane: laneIndex,
        y1: 0,
        y2: 100,
        colorIndex: slot.colorIndex,
        isActivePath: slot.isActivePath
      });
    }

    if (hadIncoming) {
      segments.push({
        kind: "vertical",
        lane: nodeLane,
        y1: 0,
        y2: 50,
        colorIndex: nodeColorIndex,
        isActivePath: item.isOnActivePath
      });
    }

    const children = getDisplayChildren(item);
    if (children.length > 0) {
      // Lane 0 is reserved exclusively for activePath nodes when an active trunk exists.
      let continuationChild: DisplayTreeItem | undefined;
      if (nodeLane === 0 && hasActiveTrunk) {
        continuationChild = children.find((child) => child.isOnActivePath);
      } else {
        continuationChild = children.find((child) => child.isOnActivePath) || children[0];
      }

      if (continuationChild) {
        const contLane = continuationChild.isOnActivePath && hasActiveTrunk && nodeLane !== 0 && !lanes[0] ? 0 : nodeLane;
        const contColor = continuationChild.isOnActivePath ? 0 : nodeColorIndex;
        lanes[contLane] = {
          targetId: continuationChild.id,
          colorIndex: contColor,
          isActivePath: continuationChild.isOnActivePath
        };
        if (contLane === nodeLane) {
          segments.push({
            kind: "vertical",
            lane: nodeLane,
            y1: 50,
            y2: 100,
            colorIndex: contColor,
            isActivePath: continuationChild.isOnActivePath
          });
        } else {
          segments.push({
            kind: "fork",
            fromLane: nodeLane,
            toLane: contLane,
            colorIndex: contColor,
            isActivePath: continuationChild.isOnActivePath
          });
        }
      }

      for (const child of children) {
        if (child === continuationChild) continue;
        const forkLane = allocateFreeLane(child.isOnActivePath);
        const forkColor = child.isOnActivePath ? 0 : nextBranchColor();
        lanes[forkLane] = {
          targetId: child.id,
          colorIndex: forkColor,
          isActivePath: child.isOnActivePath
        };
        segments.push({
          kind: "fork",
          fromLane: nodeLane,
          toLane: forkLane,
          colorIndex: forkColor,
          isActivePath: child.isOnActivePath
        });
      }
    }

    let rowMaxLane = nodeLane;
    for (const seg of segments) {
      if (seg.kind === "vertical") rowMaxLane = Math.max(rowMaxLane, seg.lane);
      else rowMaxLane = Math.max(rowMaxLane, seg.fromLane, seg.toLane);
    }
    globalMaxLane = Math.max(globalMaxLane, rowMaxLane);

    rows.push({
      id: item.id,
      item,
      lane: nodeLane,
      colorIndex: nodeColorIndex,
      maxLane: rowMaxLane,
      segments,
      isRootStart
    });

    for (const child of children) {
      visit(child, false);
    }
  }

  for (let index = 0; index < roots.length; index += 1) {
    visit(roots[index], index > 0);
  }

  return {
    rows,
    laneCount: globalMaxLane + 1
  };
}

export function metroLaneCenterX(lane: number): number {
  const clamped = Math.min(Math.max(0, lane), METRO_MAX_VISUAL_LANE);
  return METRO_LEFT_PAD + clamped * METRO_LANE_PITCH;
}

export function metroGutterWidth(laneCount: number): number {
  const visibleLanes = Math.max(1, Math.min(laneCount, METRO_MAX_VISUAL_LANE + 1));
  return METRO_LEFT_PAD * 2 + (visibleLanes - 1) * METRO_LANE_PITCH;
}

export function metroSegmentPath(segment: MetroRailSegment): string {
  if (segment.kind === "vertical") {
    const x = metroLaneCenterX(segment.lane);
    return `M ${x} ${segment.y1} L ${x} ${segment.y2}`;
  }
  const x1 = metroLaneCenterX(segment.fromLane);
  const x2 = metroLaneCenterX(segment.toLane);
  return `M ${x1} 50 C ${x1} 78, ${x2} 72, ${x2} 100`;
}

export function moveMetroFocusIndex(currentIndex: number, totalCount: number, key: string): number | null {
  if (totalCount <= 0) return null;
  const safeCurrent = currentIndex >= 0 && currentIndex < totalCount ? currentIndex : 0;
  if (key === "ArrowDown") return Math.min(totalCount - 1, safeCurrent + 1);
  if (key === "ArrowUp") return Math.max(0, safeCurrent - 1);
  if (key === "Home") return 0;
  if (key === "End") return totalCount - 1;
  return null;
}
