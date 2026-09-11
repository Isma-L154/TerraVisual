import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

import type { DiagramEdge } from './toFlow';

/** An arrow along a precomputed route, with its label where the router found room. */
function RoutedEdge({ id, data, markerEnd }: EdgeProps<DiagramEdge>) {
  if (!data) return null;

  const path = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const box = data.labelBox;

  return (
    <>
      <path id={id} className="react-flow__edge-path" d={path} markerEnd={markerEnd} fill="none">
        <title>{data.label}</title>
      </path>
      {box ? (
        <EdgeLabelRenderer>
          <div
            className="dg-edge-label"
            style={{
              transform: `translate(${box.x}px, ${box.y}px)`,
              width: box.width,
              height: box.height,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = { routed: RoutedEdge };
