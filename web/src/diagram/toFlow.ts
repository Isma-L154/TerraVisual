import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';

import type { InfraModel, InfraNode } from '../model';
import { absoluteBoxes, layout, METRICS, type Box } from '../layout/layout';
import { announce, connectionsByNode } from './announce';
import { routeConnections, type Point, type Rect } from './routing';

type DiagramNodeData = {
  node: InfraNode;
  depth: number;
  unknownCount: number;
  /** Resources folded out of sight inside this container; zero when drawn in full. */
  hiddenCount: number;
  [key: string]: unknown;
};

export type DiagramNode = FlowNode<DiagramNodeData>;

type DiagramEdgeData = {
  points: Point[];
  label: string;
  /** Where the label is drawn, or null when it fits nowhere without covering something. */
  labelBox: Rect | null;
  [key: string]: unknown;
};

export type DiagramEdge = FlowEdge<DiagramEdgeData, 'routed'>;

/**
 * Turns a model into what React Flow renders. Positions and arrow routes come
 * from our own layout and router; React Flow does no layout of its own
 * (ADR-0003).
 */
export function toFlow(
  model: InfraModel,
  hidden: ReadonlyMap<string, number> = new Map(),
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const computed = layout(model, { folded: new Set(hidden.keys()) });
  const byId = new Map(model.nodes.map((node) => [node.id, node]));

  const childCount = new Map<string, number>();
  for (const node of model.nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
    }
  }

  const connections = connectionsByNode(model);

  // Layout order puts parents before children, which React Flow requires.
  const nodes = computed.order.map((id): DiagramNode => {
    const node = byId.get(id)!;
    const box = computed.boxes.get(id)!;
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;

    return {
      id,
      // Having children decides the shape, whatever the catalog expected:
      // children drawn inside a leaf would cover its content.
      type: node.isContainer || childCount.has(id) ? 'container' : 'resource',
      position: { x: box.x, y: box.y },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      draggable: false,
      selectable: true,
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
    };
  });

  const absolute = absoluteBoxes(computed, model);
  return { nodes, edges: toEdges(model, absolute, childCount, byId) };
}

/**
 * The connections the catalog marks as worth drawing, routed around every box.
 * A container's interior can be crossed; its name and the leaves inside cannot.
 */
function toEdges(
  model: InfraModel,
  absolute: Map<string, Box>,
  childCount: Map<string, number>,
  byId: Map<string, InfraNode>,
): DiagramEdge[] {
  const obstacles: Rect[] = [];
  const containers: Rect[] = [];

  for (const [id, box] of absolute) {
    if (childCount.has(id)) {
      containers.push(box);
      obstacles.push({ x: box.x, y: box.y, width: box.width, height: METRICS.headerHeight });
    } else {
      obstacles.push(box);
    }
  }

  const drawn = model.edges.filter(
    (edge) => edge.drawn && absolute.has(edge.from) && absolute.has(edge.to),
  );

  const routes = routeConnections(
    drawn.map((edge) => ({
      id: edge.id,
      source: absolute.get(edge.from)!,
      target: absolute.get(edge.to)!,
      label: edge.label ?? edge.kind,
    })),
    obstacles,
    containers,
  );

  return drawn.map((edge) => {
    const label = edge.label ?? edge.kind;
    const route = routes.get(edge.id)!;

    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'routed',
      className: `dg-edge dg-edge-${edge.kind}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      // The label is spoken even when there was no room to draw it.
      ariaLabel: `${byId.get(edge.from)!.label} connects to ${byId.get(edge.to)!.label} (${label})`,
      selectable: false,
      focusable: false,
      data: { points: route.points, label, labelBox: route.label },
    };
  });
}

export function countUnknown(node: InfraNode): number {
  return Object.values(node.attributes).filter((attribute) => !attribute.known).length;
}
