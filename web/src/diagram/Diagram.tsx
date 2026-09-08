import { useMemo } from 'react';
import { Background, Controls, ReactFlow, type OnSelectionChangeParams } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { InfraModel } from '../model';
import { nodeTypes } from './nodes';
import { toFlowNodes } from './toFlow';

export type DiagramProps = {
  model: InfraModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The infrastructure diagram.
 *
 * React Flow renders; it does not lay out. Positions come from our own module
 * (ADR-0003), which is what keeps boxes still while somebody types.
 *
 * Nodes are real DOM elements rather than canvas drawings, which is why focus,
 * CSS and screen readers work at all here. The accessible tree in #11 is still
 * a peer view rather than a fallback: a spatial canvas is not a good way to
 * read a hierarchy, however accessible its nodes are.
 */
export function Diagram({ model, selectedId, onSelect }: DiagramProps) {
  const { nodes } = useMemo(
    () => (model ? toFlowNodes(model) : { nodes: [], layout: null }),
    [model],
  );

  const withSelection = useMemo(
    () => nodes.map((node) => ({ ...node, selected: node.id === selectedId })),
    [nodes, selectedId],
  );

  if (!model) {
    return (
      <p className="placeholder" data-testid="diagram-waiting">
        Waiting for the first analysis…
      </p>
    );
  }

  if (model.nodes.length === 0) {
    return (
      <p className="placeholder" data-testid="diagram-empty">
        No infrastructure yet. Declare a resource and it will appear here.
      </p>
    );
  }

  return (
    <div className="diagram" data-testid="diagram">
      <ReactFlow
        nodes={withSelection}
        edges={[]}
        nodeTypes={nodeTypes}
        onSelectionChange={({ nodes: selected }: OnSelectionChangeParams) =>
          onSelect(selected[0]?.id ?? null)
        }
        fitView
        // Layout is ours, so React Flow must not move anything.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        aria-label="Infrastructure diagram"
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
