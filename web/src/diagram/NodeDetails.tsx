import { displayType, documentationUrl } from './catalog';
import { CategoryIcon } from './CategoryIcon';
import { displayValue, type InfraNode } from '../model';

type NodeDetailsProps = {
  node: InfraNode | null;
  /** Jump to where this node is written. Absent when nothing can navigate. */
  onReveal?: (node: InfraNode) => void;
};

/**
 * What a selected node says, including its unknowns *with their reasons* —
 * "unknown" alone is a dead end, and the reason is the part that teaches.
 */
export function NodeDetails({ node, onReveal }: NodeDetailsProps) {
  if (!node) {
    return (
      <p className="placeholder" data-testid="details-empty">
        Select something in the diagram to see what it says.
      </p>
    );
  }

  const attributes = Object.entries(node.attributes).sort(([a], [b]) => (a < b ? -1 : 1));
  const documentation = documentationUrl(node.type);

  return (
    <div className="details" data-testid="details">
      <h3 className="details-title">
        <CategoryIcon category={node.category} size={15} />
        <span>{node.label}</span>
      </h3>

      <dl className="details-meta">
        <dt>Address</dt>
        <dd>
          <code>{node.address}</code>
        </dd>
        <dt>Type</dt>
        <dd>
          {displayType(node.type)} <code>{node.type}</code>
        </dd>
        <dt>Provider</dt>
        <dd>{node.provider}</dd>
        {node.modulePath ? (
          <>
            <dt>Module</dt>
            <dd>
              <code>module.{node.modulePath}</code>
            </dd>
          </>
        ) : null}
        <dt>Defined in</dt>
        <dd>
          {onReveal && node.source.file && node.source.startLine > 0 ? (
            <button type="button" className="details-jump" onClick={() => onReveal(node)}>
              <code>
                {node.source.file}:{node.source.startLine}
              </code>
            </button>
          ) : (
            <code>
              {node.source.file || 'not written in this workspace'}
              {node.source.startLine > 0 ? `:${node.source.startLine}` : ''}
            </code>
          )}
        </dd>
      </dl>

      {!node.catalogued ? (
        <p className="details-note">
          This resource type is not in the catalog yet, so it is shown without a category or a place
          in the hierarchy.
        </p>
      ) : null}

      {attributes.length === 0 ? (
        <p className="details-note">This resource declares no attributes.</p>
      ) : (
        <table className="details-attributes">
          <caption className="visually-hidden">Attributes of {node.label}</caption>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {attributes.map(([name, attribute]) => (
              <tr key={name}>
                <th scope="row">
                  <code>{name}</code>
                </th>
                <td>
                  {attribute.known ? (
                    <code className="value-known">{displayValue(attribute)}</code>
                  ) : (
                    // The word, not only the styling: an unknown that read as
                    // blank would undo NFR-9 at the last step.
                    <span className="value-unknown">
                      <strong>Unknown</strong>
                      {attribute.reason ? ` — ${attribute.reason}` : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {documentation ? (
        <p className="details-docs">
          <a href={documentation} target="_blank" rel="noreferrer noopener">
            Terraform documentation for {displayType(node.type)}
          </a>
        </p>
      ) : null}
    </div>
  );
}
