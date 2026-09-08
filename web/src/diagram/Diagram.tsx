import { useMemo } from 'react';
import { Background, Controls, ReactFlow, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { InfraModel } from '../model';
import { nodeTypes } from './nodes';
import { toFlowEdges, toFlowNodes, type DiagramNode } from './toFlow';

/**
 * What a screen reader is told about the diagram's controls.
 *
 * These replace React Flow's defaults, which describe a diagram whose nodes
 * can be dragged and deleted. Ours cannot: positions come from the layout
 * module, and the only way to change the picture is to change the Terraform.
 * Saying so is the point — an instruction that does nothing wastes the time of
 * exactly the users this view exists for.
 */
const ARIA_LABELS = {
  'node.a11yDescription.default':
    'Press enter or space to select. Selecting shows its details and highlights the code that declares it.',
  'node.a11yDescription.keyboardDisabled':
    'Press enter or space to select. Selecting shows its details and highlights the code that declares it.',
  // Edges are neither focusable nor selectable here — a connection is a fact
  // about two resources rather than a thing to operate. The outline names each
  // resource's connections, which is where somebody reading by ear finds them.
  'edge.a11yDescription.default': 'A connection between two resources.',
};

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

  const edges = useMemo(() => (model ? toFlowEdges(model) : []), [model]);

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
        edges={edges}
        nodeTypes={nodeTypes}
        /*
         * Selection.
         *
         * `nodes` is controlled — the array is derived from the model on every
         * render — and React Flow will not apply a selection to a controlled
         * array by itself. It emits the change and waits for the owner to
         * apply it. Without this handler it emits into nothing: clicking a
         * node did nothing, and Enter on a focused node did nothing, which
         * made the diagram reachable by keyboard but not operable by it.
         *
         * The state that gets applied is `selectedId` upstream, which is also
         * what the editor and the outline read, so there is still one source
         * of truth rather than React Flow keeping a second opinion.
         */
        onNodesChange={(changes: NodeChange<DiagramNode>[]) => {
          let next: string | null | undefined;

          for (const change of changes) {
            if (change.type !== 'select') continue;
            // A click on B arrives as "deselect A, select B", in that order,
            // so the last selection in the batch is the one that counts.
            if (change.selected) next = change.id;
            else if (next === undefined && change.id === selectedId) next = null;
          }

          // Undefined means nothing in this batch was about selection.
          // Comparing against the current value keeps a selection that arrived
          // through props from being reported straight back, which would
          // reveal code, move the cursor, and loop.
          if (next !== undefined && next !== selectedId) onSelect(next);
        }}
        fitView
        // Layout is ours, so React Flow must not move anything.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        aria-label="Infrastructure diagram"
        // React Flow's default descriptions are read aloud on every node and
        // offer to move and delete things. Neither is possible here — the
        // layout is ours and the diagram reports what the code says — so the
        // defaults would be instructions to do something that cannot be done.
        ariaLabelConfig={ARIA_LABELS}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
