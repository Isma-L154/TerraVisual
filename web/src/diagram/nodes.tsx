import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { CategoryIcon } from './CategoryIcon';
import { displayType } from './catalog';
import type { DiagramNode } from './toFlow';

/**
 * Where a connection attaches.
 *
 * Hidden, because nothing here is connectable by hand: the diagram reports
 * what the Terraform says rather than inviting somebody to rewire it. React
 * Flow still needs the anchors to route an edge at all.
 */
function ConnectionPoints() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="dg-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="dg-handle" isConnectable={false} />
    </>
  );
}

/**
 * A container: a VPC, a subnet, a cloud, a region.
 *
 * Rendered as a labelled frame with its children inside it. The label sits at
 * the top rather than in the middle so nesting stays readable when boxes get
 * small.
 */
const ContainerNode = memo(function ContainerNode({ data, selected }: NodeProps<DiagramNode>) {
  const { node, depth, hiddenCount } = data;

  return (
    <div
      className={`dg-container dg-depth-${Math.min(depth, 4)}${selected ? ' is-selected' : ''}`}
      data-category={node.category}
      data-testid={`node-${node.id}`}
    >
      <ConnectionPoints />
      <div className="dg-container-header">
        <CategoryIcon category={node.category} size={14} />
        <span className="dg-label" title={node.label}>
          {node.label}
        </span>
        <span className="dg-type">{displayType(node.type)}</span>
        {!node.catalogued ? <UncataloguedBadge /> : null}
      </div>

      {hiddenCount > 0 ? <FoldedContents id={node.id} count={hiddenCount} /> : null}
    </div>
  );
});

/**
 * What a container is holding out of sight, and the way to see it.
 *
 * A real button rather than a clickable div: it has to be reachable by
 * keyboard, announced as something that can be pressed, and hittable by
 * somebody with a tremor. The click is stopped from propagating because
 * selecting the container and opening it are different intentions.
 *
 * The event is dispatched on the element rather than routed through a prop
 * because React Flow owns the tree between here and the diagram; a custom
 * event crosses that boundary without every node needing a callback it would
 * only use when folded.
 */
function FoldedContents({ id, count }: { id: string; count: number }) {
  return (
    <button
      type="button"
      className="dg-folded"
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.dispatchEvent(
          new CustomEvent('tv:expand', { detail: id, bubbles: true }),
        );
      }}
      onKeyDown={(event) => {
        // React Flow treats Enter and space on a node as "select". Inside this
        // button they mean "open", so they stop here.
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      + {count} not shown
    </button>
  );
}

/** A leaf: an instance, a bucket, a function. */
const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<DiagramNode>) {
  const { node, unknownCount } = data;

  return (
    <div
      className={`dg-resource${selected ? ' is-selected' : ''}`}
      data-category={node.category}
      data-testid={`node-${node.id}`}
    >
      <ConnectionPoints />
      <div className="dg-resource-top">
        <CategoryIcon category={node.category} size={15} />
        <span className="dg-label" title={node.address}>
          {node.label}
        </span>
      </div>
      <div className="dg-resource-meta">
        <span className="dg-type">{displayType(node.type)}</span>
        {/* The provider is text as well as an icon: colour alone would be
            invisible to a colourblind user (FR-10). */}
        <span className="dg-provider">{node.provider}</span>
      </div>
      <div className="dg-resource-flags">
        {!node.catalogued ? <UncataloguedBadge /> : null}
        {unknownCount > 0 ? (
          <span
            className="dg-unknown"
            title="Values that cannot be determined without running Terraform"
          >
            {unknownCount} unknown
          </span>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Marks a resource type the catalog does not know.
 *
 * Visible on purpose. A real project brings dozens of these, and the diagram
 * must never look complete when it is not.
 */
function UncataloguedBadge() {
  return (
    <span className="dg-uncatalogued" title="This resource type is not in the catalog yet">
      uncatalogued
    </span>
  );
}

export const nodeTypes = {
  container: ContainerNode,
  resource: ResourceNode,
};
