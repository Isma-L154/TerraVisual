import type { Node as FlowNode } from '@xyflow/react';

import type { InfraModel, InfraNode } from '../model';
import { layout, type Layout } from '../layout/layout';

export type DiagramNodeData = {
  node: InfraNode;
  depth: number;
  unknownCount: number;
  [key: string]: unknown;
};

export type DiagramNode = FlowNode<DiagramNodeData>;

/**
 * Turns a model into what React Flow renders.
 *
 * Positions come from our layout module; React Flow does no layout of its own
 * (ADR-0003). This function is the seam between the two, and it stays pure so
 * it can be tested without a canvas.
 */
export function toFlowNodes(model: InfraModel): { nodes: DiagramNode[]; layout: Layout } {
  const computed = layout(model);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));

  const withChildren = new Set<string>();
  for (const node of model.nodes) {
    if (node.parentId) withChildren.add(node.parentId);
  }

  const nodes: DiagramNode[] = [];

  // The layout emits parents before children, and React Flow requires the same
  // ordering for its parent/child relationships. Reusing that order rather than
  // re-deriving it keeps one definition of "what nests in what".
  for (const id of computed.order) {
    const node = byId.get(id);
    const box = computed.boxes.get(id);
    if (!node || !box) continue;

    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;

    nodes.push({
      id,
      // The catalog says what a type is *meant* to be; having children is what
      // it actually is. Reality wins, because rendering a node with children as
      // a leaf draws its children on top of its own content.
      type: node.isContainer || withChildren.has(id) ? 'container' : 'resource',
      position: { x: box.x, y: box.y },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      // A node the user can drag out of its subnet would be showing something
      // the Terraform does not say. The diagram reports; it does not invite
      // rearrangement.
      draggable: false,
      selectable: true,
      data: {
        node,
        depth: box.depth,
        unknownCount: countUnknown(node),
      },
      style: { width: box.width, height: box.height },
    });
  }

  return { nodes, layout: computed };
}

/**
 * How many of a node's attributes could not be determined.
 *
 * Surfaced on the node itself because "unknown" is a first-class state in this
 * model (NFR-9), and a diagram that renders unknown values as blank would
 * quietly undo that at the last step.
 */
export function countUnknown(node: InfraNode): number {
  let count = 0;
  for (const attribute of Object.values(node.attributes)) {
    if (!attribute.known) count++;
  }
  return count;
}
