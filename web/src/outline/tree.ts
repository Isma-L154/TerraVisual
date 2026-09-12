/**
 * The outline's data, built separately from its rendering so the
 * announcements — the part that decides whether it is useful to somebody
 * listening — can be tested as text.
 */

import type { InfraModel, InfraNode } from '../model';
import { announce } from '../diagram/announce';

export type OutlineItem = {
  node: InfraNode;
  level: number;
  children: OutlineItem[];
};

/**
 * The containment tree, in the order the diagram draws it. The two views must
 * agree, or they cannot be used together.
 */
export function buildTree(model: InfraModel): OutlineItem[] {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, InfraNode[]>();
  const roots: InfraNode[] = [];

  for (const node of model.nodes) {
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(parentId, [node]);
  }

  const build = (node: InfraNode, level: number): OutlineItem => ({
    node,
    level,
    children: sortNodes(childrenOf.get(node.id) ?? []).map((child) => build(child, level + 1)),
  });

  const sorted = sortNodes(roots);
  return [...sorted.filter((n) => !n.unplaced), ...sorted.filter((n) => n.unplaced)].map((node) =>
    build(node, 1),
  );
}

/** The same total order the layout uses, so both views agree. */
function sortNodes(nodes: InfraNode[]): InfraNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Flattens the visible items, respecting which branches are collapsed. */
export function visibleItems(items: OutlineItem[], collapsed: ReadonlySet<string>): OutlineItem[] {
  const out: OutlineItem[] = [];

  const walk = (list: OutlineItem[]) => {
    for (const item of list) {
      out.push(item);
      if (item.children.length > 0 && !collapsed.has(item.node.id)) walk(item.children);
    }
  };

  walk(items);
  return out;
}

/**
 * What a screen reader says for one item. "aws_instance.web" read aloud tells
 * somebody almost nothing; this is the outline's real content.
 */
export function describe(item: OutlineItem, parent?: InfraNode, connections?: string[]): string {
  return announce(item.node, parent, connections, item.children.length);
}

export function countItems(items: OutlineItem[]): number {
  return items.reduce((total, item) => total + 1 + countItems(item.children), 0);
}
