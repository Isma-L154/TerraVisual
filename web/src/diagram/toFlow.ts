import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';

import type { Edge, InfraModel, InfraNode } from '../model';
import { layout, type Layout } from '../layout/layout';
import { announce, connectionsByNode } from './catalog';

export type DiagramNodeData = {
  node: InfraNode;
  depth: number;
  unknownCount: number;
  /**
   * How many resources this container is holding out of sight.
   *
   * Zero for everything the diagram is drawing in full. Non-zero means the
   * diagram summarised, and the node has to say so — a container that quietly
   * showed nothing would read as an empty subnet, which is a different and
   * much worse claim.
   */
  hiddenCount: number;
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
/**
 * The connections worth drawing.
 *
 * The model carries every reference the code expresses; only the ones the
 * catalog marked as worth showing reach the picture. An edge pointing at a
 * node that is not on screen is dropped rather than left dangling.
 */
export function toFlowEdges(model: InfraModel): FlowEdge[] {
  const present = new Set(model.nodes.map((node) => node.id));

  return model.edges
    .filter((edge) => edge.drawn && present.has(edge.from) && present.has(edge.to))
    .map((edge: Edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      // Labelled as well as coloured: an arrow whose meaning is carried only
      // by its colour says nothing to somebody who cannot see the difference.
      label: edge.label ?? edge.kind,
      className: `dg-edge dg-edge-${edge.kind}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      // Straight through nested containers rather than around them: our
      // layout has no routing channels, and a curve that cuts a corner reads
      // better than one that pretends to follow a path.
      type: 'default',
      selectable: false,
      focusable: false,
    }));
}

export function toFlowNodes(
  model: InfraModel,
  hidden: ReadonlyMap<string, number> = new Map(),
): { nodes: DiagramNode[]; layout: Layout } {
  const computed = layout(model);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));

  const withChildren = new Set<string>();
  const childCount = new Map<string, number>();
  for (const node of model.nodes) {
    if (!node.parentId) continue;
    withChildren.add(node.parentId);
    childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }

  const connections = connectionsByNode(model);

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
      // Without this a screen reader announces "node, group" and then reads
      // whatever text happens to be inside. The outline's wording is reused so
      // the two views describe the same resource the same way.
      ariaLabel: announce(
        node,
        parentId ? byId.get(parentId) : undefined,
        connections.get(id),
        childCount.get(id) ?? 0,
        hidden.get(id) ?? 0,
      ),
      data: {
        node,
        depth: box.depth,
        unknownCount: countUnknown(node),
        hiddenCount: hidden.get(id) ?? 0,
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
