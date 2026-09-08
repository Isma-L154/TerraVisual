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
export const ContainerNode = memo(function ContainerNode({
  data,
  selected,
}: NodeProps<DiagramNode>) {
  const { node, depth } = data;

  return (
    <div
      className={`dg-container dg-depth-${Math.min(depth, 4)}${selected ? ' is-selected' : ''}`}
      data-category={node.category}
      data-testid={`node-${node.id}`}
    >
      <ConnectionPoints />
      <div className="dg-container-header">
        <CategoryIcon category={node.category} size={14} />
        <span className="dg-label">{node.label}</span>
        <span className="dg-type">{displayType(node.type)}</span>
        {!node.catalogued ? <UncataloguedBadge /> : null}
      </div>
    </div>
  );
});

/** A leaf: an instance, a bucket, a function. */
export const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<DiagramNode>) {
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
