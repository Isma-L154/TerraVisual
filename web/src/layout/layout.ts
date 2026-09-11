/**
 * Turning a model into positions.
 *
 * ADR-0003 rejected a general graph engine for a reason worth restating here,
 * because this file is where that decision lives: a global layout recomputes
 * everything on every change, so boxes move on their own while the user types.
 * That breaks the link between "what I just wrote" and "what changed on
 * screen", which is the product.
 *
 * Our problem is not a general graph. It is a containment tree, and a
 * containment tree is recursive box packing. This module is pure: a model
 * goes in, positions come out. No DOM, no rendering, no measuring.
 */

import type { InfraModel, InfraNode } from '../model';

/** A laid-out box. Coordinates are relative to the parent box. */
export type Box = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nesting depth, so the renderer can vary treatment without walking up. */
  depth: number;
};

export type Layout = {
  boxes: Map<string, Box>;
  /** Order to render in: parents before children, so a renderer needs one pass. */
  order: string[];
  width: number;
  height: number;
};

/**
 * Sizes and spacing.
 *
 * Columns are fixed rather than derived from the number of children. A count
 * that changes the column count would reflow every sibling when one is added,
 * which is exactly the instability this layout exists to avoid.
 */
export const METRICS = {
  leafWidth: 190,
  leafHeight: 68,
  padding: 16,
  headerHeight: 30,
  gap: 12,
  maxColumns: 4,
  emptyContainerWidth: 190,
  emptyContainerHeight: 44,
  foldedContainerHeight: 72,
  rootGap: 24,
} as const;

/**
 * Lays out a model.
 *
 * Identical input always produces identical output: children are sorted by a
 * stable key rather than left in model order, so nothing depends on the order
 * the analyzer happened to emit.
 */
export type LayoutOptions = {
  /** Containers drawn without their children, which render a button instead. */
  folded?: ReadonlySet<string>;
};

export function layout(model: InfraModel, options: LayoutOptions = {}): Layout {
  const folded = options.folded ?? new Set<string>();
  const boxes = new Map<string, Box>();
  const order: string[] = [];

  const byId = new Map<string, InfraNode>();
  for (const node of model.nodes) byId.set(node.id, node);

  const childrenOf = new Map<string, InfraNode[]>();
  const roots: InfraNode[] = [];

  for (const node of model.nodes) {
    // A parent that is not in the model is not a parent. This can only happen
    // if a producer emits an inconsistent model, and dropping the reference is
    // better than losing the node.
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(parentId, [node]);
  }

  // Unplaced nodes are laid out last, so the tray for things we could not place
  // sits after the infrastructure rather than in the middle of it.
  const sortedRoots = sortNodes(roots);
  const placedRoots = sortedRoots.filter((node) => !node.unplaced);
  const unplacedRoots = sortedRoots.filter((node) => node.unplaced);

  const measured = new Map<string, { width: number; height: number }>();
  const measure = (node: InfraNode): { width: number; height: number } => {
    const cached = measured.get(node.id);
    if (cached) return cached;

    const children = sortNodes(childrenOf.get(node.id) ?? []);
    let size: { width: number; height: number };

    if (children.length === 0) {
      size = folded.has(node.id)
        ? { width: METRICS.emptyContainerWidth, height: METRICS.foldedContainerHeight }
        : node.isContainer
          ? { width: METRICS.emptyContainerWidth, height: METRICS.emptyContainerHeight }
          : { width: METRICS.leafWidth, height: METRICS.leafHeight };
    } else {
      const rows = pack(children.map(measure));
      size = {
        width: rows.width + METRICS.padding * 2,
        height: rows.height + METRICS.padding + METRICS.headerHeight,
      };
    }

    measured.set(node.id, size);
    return size;
  };

  const place = (node: InfraNode, x: number, y: number, depth: number): void => {
    const size = measure(node);
    boxes.set(node.id, { id: node.id, x, y, width: size.width, height: size.height, depth });
    order.push(node.id);

    const children = sortNodes(childrenOf.get(node.id) ?? []);
    if (children.length === 0) return;

    const rows = pack(children.map(measure));
    rows.positions.forEach((position, index) => {
      const child = children[index]!;
      place(child, METRICS.padding + position.x, METRICS.headerHeight + position.y, depth + 1);
    });
  };

  // Roots run across the canvas, wrapping like anything else.
  let cursorX = 0;
  let rowTop = 0;
  let rowHeight = 0;
  let widest = 0;

  const placeRootRow = (node: InfraNode) => {
    const size = measure(node);
    if (cursorX > 0 && cursorX + size.width > maxRootRowWidth()) {
      cursorX = 0;
      rowTop += rowHeight + METRICS.rootGap;
      rowHeight = 0;
    }
    place(node, cursorX, rowTop, 0);
    cursorX += size.width + METRICS.rootGap;
    rowHeight = Math.max(rowHeight, size.height);
    widest = Math.max(widest, cursorX - METRICS.rootGap);
  };

  for (const node of placedRoots) placeRootRow(node);

  if (unplacedRoots.length > 0) {
    if (cursorX > 0) {
      cursorX = 0;
      rowTop += rowHeight + METRICS.rootGap;
      rowHeight = 0;
    }
    for (const node of unplacedRoots) placeRootRow(node);
  }

  return {
    boxes,
    order,
    width: widest,
    height: rowTop + rowHeight,
  };
}

/**
 * Orders siblings.
 *
 * Containers first so the shape of the infrastructure reads before its
 * contents, then by category and label. Falling back to id makes the order
 * total, which is what makes the layout reproducible.
 */
function sortNodes(nodes: InfraNode[]): InfraNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Packs boxes into a grid.
 *
 * The column count is fixed. Deriving it from the number of children — a
 * square root, say — would reflow every sibling whenever one is added, which
 * is the reshuffling this layout exists to prevent.
 */
function pack(sizes: { width: number; height: number }[]): {
  positions: { x: number; y: number }[];
  width: number;
  height: number;
} {
  const columns = Math.min(METRICS.maxColumns, Math.max(1, sizes.length));
  const positions: { x: number; y: number }[] = [];

  let y = 0;
  let width = 0;

  for (let start = 0; start < sizes.length; start += columns) {
    const row = sizes.slice(start, start + columns);
    let x = 0;
    let tallest = 0;

    for (const size of row) {
      positions.push({ x, y });
      x += size.width + METRICS.gap;
      tallest = Math.max(tallest, size.height);
    }

    width = Math.max(width, x - METRICS.gap);
    y += tallest + METRICS.gap;
  }

  return { positions, width, height: Math.max(0, y - METRICS.gap) };
}

function maxRootRowWidth(): number {
  return METRICS.leafWidth * 8;
}

/** Every box in canvas coordinates rather than relative to its parent. */
export function absoluteBoxes(result: Layout, model: InfraModel): Map<string, Box> {
  const parents = new Map(model.nodes.map((node) => [node.id, node.parentId]));
  const absolute = new Map<string, Box>();

  // `order` lists parents before children, so each parent is already absolute.
  for (const id of result.order) {
    const box = result.boxes.get(id)!;
    const parentId = parents.get(id);
    const parent = parentId ? absolute.get(parentId) : undefined;
    absolute.set(id, parent ? { ...box, x: parent.x + box.x, y: parent.y + box.y } : box);
  }

  return absolute;
}
