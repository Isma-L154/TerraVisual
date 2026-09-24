import { useEffect, type RefObject } from 'react';
import { useReactFlow, type FitViewOptions } from '@xyflow/react';

import type { DiagramNode } from './toFlow';

/** Room for the zoom controls on the left and the save button on top, so the fitted diagram is under neither. */
export const FIT_VIEW: FitViewOptions = {
  padding: { top: '52px', right: '24px', bottom: '24px', left: '64px' },
};

/**
 * The diagram's outer edges, as a key that changes only when they move.
 * Children are positioned inside their parents, so the top-level boxes alone
 * decide it: typing inside a resource leaves it unchanged.
 */
export function outerBounds(nodes: readonly DiagramNode[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (node.parentId) continue;
    const width = Number(node.style?.width ?? 0);
    const height = Number(node.style?.height ?? 0);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }

  return minX === Infinity ? '' : `${minX},${minY},${maxX},${maxY}`;
}

type FollowCameraProps = {
  bounds: string;
  /** Cleared when the user moves the camera themselves. */
  following: RefObject<boolean>;
};

/**
 * Fits the view whenever the diagram's outer edges move, so what the code
 * describes stays on screen. Boxes never move while typing (ADR-0003); only
 * the camera does, and only until the user takes it over.
 */
export function FollowCamera({ bounds, following }: FollowCameraProps) {
  const { fitView } = useReactFlow();

  // React Flow queues the fit until the new nodes have been measured.
  useEffect(() => {
    if (following.current) void fitView(FIT_VIEW);
  }, [bounds, fitView, following]);

  return null;
}
