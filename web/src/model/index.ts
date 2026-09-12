/**
 * The hand-written surface over the InfraModel types generated from
 * `schemas/infra-model.schema.json`.
 */

export type {
  InfraModel,
  // The schema's Node would shadow the DOM's Node.
  Node as InfraNode,
  Diagnostic,
  Attribute,
  Range,
} from './generated/infra-model';

export type { Catalog, Entry as CatalogEntry } from './generated/catalog';

import type { Attribute, InfraModel } from './generated/infra-model';

export const SCHEMA_VERSION = 1 as const;

/**
 * What to show for an attribute. Unknown is null rather than an empty string,
 * which is a legitimate Terraform value.
 */
export function displayValue(attribute: Attribute): string | null {
  if (!attribute.known) return null;
  const { value } = attribute;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** A cheap shape check for a model crossing a boundary. Not schema validation. */
export function isSupportedModel(value: unknown): value is InfraModel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<InfraModel>;
  return (
    candidate.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.diagnostics) &&
    typeof candidate.stats === 'object' &&
    candidate.stats !== null
  );
}
