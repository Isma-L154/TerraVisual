import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { InfraModel } from '../model';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { toFlow, type DiagramNode } from './toFlow';
import { summarise } from './summarise';
import { FIT_VIEW, FollowCamera, outerBounds } from './camera';
import { SaveImage } from './SaveImage';

/**
 * React Flow's defaults describe nodes that can be dragged and deleted. Ours
 * cannot, and an instruction that does nothing wastes a screen reader user's
 * time, so these say what selecting actually does.
 */
const ARIA_LABELS = {
  'node.a11yDescription.default':
    'Press enter or space to select. Selecting shows its details and highlights the code that declares it.',
  'node.a11yDescription.keyboardDisabled':
    'Press enter or space to select. Selecting shows its details and highlights the code that declares it.',
  // Edges are not operable; the outline names each resource's connections.
  'edge.a11yDescription.default': 'A connection between two resources.',
};

type DiagramProps = {
  model: InfraModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** How many resources the summary folded away, so the page can say so once. */
  onSummarised?: (hiddenTotal: number) => void;
};

/**
 * The infrastructure diagram. React Flow renders but does not lay out:
 * positions come from our layout (ADR-0003), which keeps boxes still while
 * somebody types.
 */
export function Diagram({ model, selectedId, onSelect, onSummarised }: DiagramProps) {
  // Containers the reader opened: view state, so it survives each new model.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const summary = useMemo(() => (model ? summarise(model, { expanded }) : null), [model, expanded]);

  const drawn = useMemo(
    () => (model && summary ? { ...model, nodes: summary.nodes } : null),
    [model, summary],
  );

  const { nodes, edges } = useMemo(
    () => (drawn && summary ? toFlow(drawn, summary.hidden) : { nodes: [], edges: [] }),
    [drawn, summary],
  );

  const hiddenTotal = summary?.hiddenTotal ?? 0;
  useEffect(() => {
    onSummarised?.(hiddenTotal);
  }, [hiddenTotal, onSummarised]);

  // A folded container's button sits inside React Flow's own components, so
  // its request bubbles up as a DOM event instead of a callback through them.
  const listenForExpand = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;

    const onExpand = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      setExpanded((previous) => new Set(previous).add(id));
    };

    element.addEventListener('tv:expand', onExpand);
    return () => element.removeEventListener('tv:expand', onExpand);
  }, []);

  const bounds = useMemo(() => outerBounds(nodes), [nodes]);
  const following = useRef(true);

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
    <div className="diagram" data-testid="diagram" ref={listenForExpand}>
      <ReactFlow
        nodes={withSelection}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Nodes are controlled, so React Flow only reports selection; applying
        // it here, to the `selectedId` the editor and outline also read, is
        // what makes clicking or pressing Enter on a node do anything.
        onNodesChange={(changes: NodeChange<DiagramNode>[]) => {
          let next: string | null | undefined;

          for (const change of changes) {
            if (change.type !== 'select') continue;
            // A click on B arrives as "deselect A, select B", in that order,
            // so the last selection in the batch is the one that counts.
            if (change.selected) next = change.id;
            else if (next === undefined && change.id === selectedId) next = null;
          }

          // A selection that arrived through props must not be reported back,
          // or it would reveal code, move the cursor, and loop.
          if (next !== undefined && next !== selectedId) onSelect(next);
        }}
        fitView
        fitViewOptions={FIT_VIEW}
        // Only a person's pan or zoom carries an event; fitting does not.
        onMoveStart={(event) => {
          if (event) following.current = false;
        }}
        // Layout is ours, so React Flow must not move anything.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        aria-label="Infrastructure diagram"
        ariaLabelConfig={ARIA_LABELS}
      >
        <Background gap={20} size={1} />
        <Controls
          showInteractive={false}
          onZoomIn={() => (following.current = false)}
          onZoomOut={() => (following.current = false)}
          onFitView={() => (following.current = true)}
        />
        <FollowCamera bounds={bounds} following={following} />
        <SaveImage />
      </ReactFlow>
    </div>
  );
}
