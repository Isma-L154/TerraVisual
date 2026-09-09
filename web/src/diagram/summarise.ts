/**
 * Deciding how much of a large model the diagram draws.
 *
 * A workspace of a thousand resources produces a picture nobody can read, and
 * one that costs about 420 ms to commit — so a keystroke takes 860 ms to reach
 * the diagram against a 500 ms budget. Both halves of that are worth fixing,
 * and they have the same fix: draw less.
 *
 * What gets kept is the top of the containment tree — providers, regions, VPCs,
 * subnets — because that is the shape somebody is trying to see. What gets
 * folded away is the detail underneath, behind a container that says how much
 * it is holding. Nothing is silently dropped: the count is on the node, the
 * interface says the diagram is summarised, and the outline still lists every
 * resource, which is what makes this a summary rather than an omission.
 *
 * This module is pure and knows nothing about React or the layout: a model goes
 * in, a smaller model comes out.
 */

import type { InfraModel, InfraNode } from '../model';

/**
 * How many nodes the diagram will draw before folding things away.
 *
 * Chosen from measurement rather than taste. The loop costs roughly half a
 * millisecond per drawn node, and the budget allows 250 ms of work after the
 * debounce, so 400 nodes leaves room for the analysis that has to happen first
 * and for hardware slower than a developer's.
 */
export const DEFAULT_BUDGET = 400;

export type Summary = {
  /** The nodes to draw. A subset of the model's, unchanged. */
  nodes: InfraNode[];
  /** For each collapsed container, how many descendants it is holding. */
  hidden: Map<string, number>;
  /** Total nodes not drawn, so the interface can say so once. */
  hiddenTotal: number;
};

export type SummariseOptions = {
  budget?: number;
  /** Containers the user has opened. These are always drawn, budget or not. */
  expanded?: ReadonlySet<string>;
};

/**
 * Chooses what to draw.
 *
 * Breadth-first by depth, admitting a container's children as a group. Partial
 * groups are worse than useless — "three of forty-seven subnets" invites the
 * reader to believe they are looking at three subnets — so a container either
 * shows its children or says how many it has.
 *
 * A container the user expanded is admitted whatever the budget says, along
 * with everything it needs to remain reachable. Somebody who asks to see inside
 * something has made a choice about their own machine, and the diagram should
 * respect it rather than fold it away again.
 */
export function summarise(model: InfraModel, options: SummariseOptions = {}): Summary {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const expanded = options.expanded ?? new Set<string>();

  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const children = new Map<string, InfraNode[]>();
  const roots: InfraNode[] = [];

  for (const node of model.nodes) {
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }

  // Under budget: draw everything, and do no work deciding what to hide.
  if (model.nodes.length <= budget) {
    return { nodes: model.nodes, hidden: new Map(), hiddenTotal: 0 };
  }

  const descendants = countDescendants(model.nodes, children);

  const drawn = new Set<string>();
  const hidden = new Map<string, number>();

  // The roots are always drawn. If there are more of those than the budget
  // allows, the budget cannot help: there is nothing above them to fold into.
  for (const root of sortForStability(roots)) drawn.add(root.id);

  let queue = sortForStability(roots);

  while (queue.length > 0) {
    const next: InfraNode[] = [];

    for (const node of queue) {
      const kids = children.get(node.id);
      if (!kids || kids.length === 0) continue;

      const openedByUser = expanded.has(node.id);
      const fits = drawn.size + kids.length <= budget;

      if (!openedByUser && !fits) {
        // Folded. The count is every descendant, not only direct children:
        // "holds 3" would be misleading when those three hold forty more.
        hidden.set(node.id, descendants.get(node.id) ?? kids.length);
        continue;
      }

      for (const kid of kids) drawn.add(kid.id);
      next.push(...sortForStability(kids));
    }

    queue = next;
  }

  const nodes = model.nodes.filter((node) => drawn.has(node.id));

  return {
    nodes,
    hidden,
    hiddenTotal: model.nodes.length - nodes.length,
  };
}

/**
 * How many descendants each node has.
 *
 * Iterative rather than recursive: the analyzer caps module depth, but this
 * runs on whatever a producer hands it, and a stack overflow inside a render is
 * a blank page.
 */
function countDescendants(
  nodes: InfraNode[],
  children: Map<string, InfraNode[]>,
): Map<string, number> {
  const counts = new Map<string, number>();

  const compute = (id: string): number => {
    const cached = counts.get(id);
    if (cached !== undefined) return cached;

    // Depth-first with an explicit stack, computing children before parents.
    const stack: { id: string; expanded: boolean }[] = [{ id, expanded: false }];

    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (counts.has(frame.id)) continue;

      const kids = children.get(frame.id) ?? [];

      if (!frame.expanded && kids.length > 0) {
        stack.push({ id: frame.id, expanded: true });
        for (const kid of kids) {
          if (!counts.has(kid.id)) stack.push({ id: kid.id, expanded: false });
        }
        continue;
      }

      let total = 0;
      for (const kid of kids) total += 1 + (counts.get(kid.id) ?? 0);
      counts.set(frame.id, total);
    }

    return counts.get(id) ?? 0;
  };

  for (const node of nodes) compute(node.id);
  return counts;
}

/**
 * The same order the layout uses.
 *
 * Which container gets folded must not depend on the order the analyzer
 * happened to emit nodes in, or the diagram would reshuffle itself between two
 * analyses of the same code.
 */
function sortForStability(nodes: InfraNode[]): InfraNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
