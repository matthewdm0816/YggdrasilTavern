import { DisplayTreeItem, getDisplayChildren, itemHasSearchMatch } from "./treeModel";

export const CANVAS_CARD_WIDTH = 248;
export const CANVAS_MESSAGE_HEIGHT = 96;
export const CANVAS_CHAIN_HEIGHT = 54;
export const CANVAS_H_GAP = 32;
export const CANVAS_V_GAP = 44;
export const CANVAS_ROOT_GAP = 56;
export const CANVAS_PADDING = 36;
export const CANVAS_MIN_ZOOM = 0.35;
export const CANVAS_MAX_ZOOM = 1.8;
export const CANVAS_ZOOM_STEP = 0.15;

const BAND_PX = 8;

type Span = {
  left: number;
  right: number;
};

type Contour = Map<number, Span>;

type InternalLayoutNode = {
  item: DisplayTreeItem;
  width: number;
  height: number;
  y: number;
  children: Array<{ node: InternalLayoutNode; offsetX: number }>;
  contour: Contour;
};

export type CanvasPlacedNode = {
  id: string;
  item: DisplayTreeItem;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
};

export type CanvasEdge = {
  id: string;
  fromId: string;
  toId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  path: string;
  isActivePath: boolean;
  isSearchPath: boolean;
};

export type CanvasLayout = {
  nodes: CanvasPlacedNode[];
  nodesById: Map<string, CanvasPlacedNode>;
  edges: CanvasEdge[];
  width: number;
  height: number;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

function addBandRange(contour: Contour, topPx: number, bottomPx: number, left: number, right: number) {
  const startBand = Math.floor(topPx / BAND_PX);
  const endBand = Math.ceil(bottomPx / BAND_PX);
  for (let band = startBand; band <= endBand; band += 1) {
    const existing = contour.get(band);
    if (existing) {
      existing.left = Math.min(existing.left, left);
      existing.right = Math.max(existing.right, right);
    } else {
      contour.set(band, { left, right });
    }
  }
}

function mergeContourInto(target: Contour, source: Contour, shiftX: number) {
  for (const [band, span] of source) {
    const shiftedLeft = span.left + shiftX;
    const shiftedRight = span.right + shiftX;
    const existing = target.get(band);
    if (existing) {
      existing.left = Math.min(existing.left, shiftedLeft);
      existing.right = Math.max(existing.right, shiftedRight);
    } else {
      target.set(band, { left: shiftedLeft, right: shiftedRight });
    }
  }
}

function shiftContourInPlace(contour: Contour, deltaX: number) {
  if (deltaX === 0) return;
  for (const span of contour.values()) {
    span.left += deltaX;
    span.right += deltaX;
  }
}

function buildSubtreeLayout(item: DisplayTreeItem, y: number): InternalLayoutNode {
  const width = CANVAS_CARD_WIDTH;
  const height = item.kind === "chain" ? CANVAS_CHAIN_HEIGHT : CANVAS_MESSAGE_HEIGHT;
  const halfWidth = width / 2;
  const childItems = getDisplayChildren(item);
  const childY = y + height + CANVAS_V_GAP;

  if (childItems.length === 0) {
    const contour: Contour = new Map();
    addBandRange(contour, y, y + height, -halfWidth, halfWidth);
    return { item, width, height, y, children: [], contour };
  }

  // Single-child chains stay strictly aligned in the exact same column (zero horizontal drift).
  if (childItems.length === 1) {
    const onlyChild = buildSubtreeLayout(childItems[0], childY);
    addBandRange(onlyChild.contour, y, childY, -halfWidth, halfWidth);
    return {
      item,
      width,
      height,
      y,
      children: [{ node: onlyChild, offsetX: 0 }],
      contour: onlyChild.contour
    };
  }

  const laidOutChildren = childItems.map((child) => buildSubtreeLayout(child, childY));
  const shifts: number[] = [0];
  const mergedContour: Contour = new Map();
  mergeContourInto(mergedContour, laidOutChildren[0].contour, 0);

  for (let index = 1; index < laidOutChildren.length; index += 1) {
    const childLayout = laidOutChildren[index];
    let minShift = shifts[index - 1] + CANVAS_CARD_WIDTH + CANVAS_H_GAP;
    for (const [band, span] of childLayout.contour) {
      const occupied = mergedContour.get(band);
      if (occupied !== undefined) {
        minShift = Math.max(minShift, occupied.right + CANVAS_H_GAP - span.left);
      }
    }
    shifts.push(minShift);
    mergeContourInto(mergedContour, childLayout.contour, minShift);
  }

  const parentCenter = (shifts[0] + shifts[shifts.length - 1]) / 2;
  shiftContourInPlace(mergedContour, -parentCenter);

  const relativeChildren = laidOutChildren.map((childLayout, index) => ({
    node: childLayout,
    offsetX: shifts[index] - parentCenter
  }));

  const firstOffset = relativeChildren[0].offsetX;
  const lastOffset = relativeChildren[relativeChildren.length - 1].offsetX;
  addBandRange(mergedContour, y, y + height, -halfWidth, halfWidth);
  addBandRange(
    mergedContour,
    y + height,
    childY,
    Math.min(-halfWidth, firstOffset - halfWidth),
    Math.max(halfWidth, lastOffset + halfWidth)
  );

  return {
    item,
    width,
    height,
    y,
    children: relativeChildren,
    contour: mergedContour
  };
}

export function cubicVerticalBezier(startX: number, startY: number, endX: number, endY: number): string {
  const midY = (startY + endY) / 2;
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

/**
 * Computes deterministic, non-overlapping 2D coordinates for the display forest.
 * Y advances downward by conversation turn; X expands horizontally only at real branch forks.
 */
export function layoutCanvasForest(roots: DisplayTreeItem[]): CanvasLayout {
  if (roots.length === 0) {
    return { nodes: [], nodesById: new Map(), edges: [], width: 0, height: 0 };
  }

  const rootLayouts = roots.map((root) => buildSubtreeLayout(root, CANVAS_PADDING));
  const rootCenters: number[] = [0];
  const forestContour: Contour = new Map();
  mergeContourInto(forestContour, rootLayouts[0].contour, 0);

  for (let index = 1; index < rootLayouts.length; index += 1) {
    const current = rootLayouts[index];
    let minShift = rootCenters[index - 1] + CANVAS_CARD_WIDTH + CANVAS_ROOT_GAP;
    for (const [band, span] of current.contour) {
      const occupied = forestContour.get(band);
      if (occupied !== undefined) {
        minShift = Math.max(minShift, occupied.right + CANVAS_ROOT_GAP - span.left);
      }
    }
    rootCenters.push(minShift);
    mergeContourInto(forestContour, current.contour, minShift);
  }

  let rawMinLeft = Infinity;
  for (const span of forestContour.values()) {
    rawMinLeft = Math.min(rawMinLeft, span.left);
  }
  const shiftToPositive = Number.isFinite(rawMinLeft) ? CANVAS_PADDING - rawMinLeft : CANVAS_PADDING;

  const nodes: CanvasPlacedNode[] = [];
  const nodesById = new Map<string, CanvasPlacedNode>();
  const edges: CanvasEdge[] = [];
  let maxRight = 0;
  let maxBottom = 0;

  function materialize(internal: InternalLayoutNode, centerX: number): CanvasPlacedNode {
    const x = Math.round((centerX - internal.width / 2) * 100) / 100;
    const normalizedCenter = Math.round(centerX * 100) / 100;
    const placed: CanvasPlacedNode = {
      id: internal.item.id,
      item: internal.item,
      x,
      y: internal.y,
      width: internal.width,
      height: internal.height,
      centerX: normalizedCenter
    };
    nodes.push(placed);
    nodesById.set(placed.id, placed);
    maxRight = Math.max(maxRight, x + internal.width);
    maxBottom = Math.max(maxBottom, internal.y + internal.height);

    for (const childEntry of internal.children) {
      const childCenterX = Math.round((centerX + childEntry.offsetX) * 100) / 100;
      const startX = placed.centerX;
      const startY = placed.y + placed.height;
      const endX = childCenterX;
      const endY = childEntry.node.y;
      edges.push({
        id: `${placed.id}->${childEntry.node.item.id}`,
        fromId: placed.id,
        toId: childEntry.node.item.id,
        startX,
        startY,
        endX,
        endY,
        path: cubicVerticalBezier(startX, startY, endX, endY),
        isActivePath: placed.item.isOnActivePath && childEntry.node.item.isOnActivePath,
        isSearchPath: itemHasSearchMatch(childEntry.node.item)
      });
      materialize(childEntry.node, centerX + childEntry.offsetX);
    }
    return placed;
  }

  rootLayouts.forEach((rootLayout, index) => {
    materialize(rootLayout, rootCenters[index] + shiftToPositive);
  });

  return {
    nodes,
    nodesById,
    edges,
    width: Math.ceil(maxRight + CANVAS_PADDING),
    height: Math.ceil(maxBottom + CANVAS_PADDING)
  };
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, Math.round(zoom * 100) / 100));
}

export function centerCanvasOnNode(
  node: CanvasPlacedNode,
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1
): CanvasViewport {
  const safeZoom = clampCanvasZoom(zoom);
  const nodeCenterY = node.y + node.height / 2;
  return {
    x: Math.round(viewportWidth / 2 - node.centerX * safeZoom),
    y: Math.round(viewportHeight / 2 - nodeCenterY * safeZoom),
    zoom: safeZoom
  };
}

export function fitCanvasToViewport(
  layout: CanvasLayout,
  viewportWidth: number,
  viewportHeight: number
): CanvasViewport {
  if (layout.nodes.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const margin = 24;
  const availableW = Math.max(120, viewportWidth - margin * 2);
  const availableH = Math.max(120, viewportHeight - margin * 2);
  const rawScale = Math.min(availableW / Math.max(1, layout.width), availableH / Math.max(1, layout.height), 1);
  const zoom = clampCanvasZoom(rawScale);
  return {
    x: Math.round((viewportWidth - layout.width * zoom) / 2),
    y: Math.round(Math.max(margin, (viewportHeight - layout.height * zoom) / 2)),
    zoom
  };
}
