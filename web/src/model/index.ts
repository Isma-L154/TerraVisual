/**
 * The InfraModel, as TypeScript sees it.
 *
 * The types themselves are generated from `schemas/infra-model.schema.json`;
 * this module is the hand-written surface: friendlier names and the few
 * helpers that keep the honesty rules from being restated at every call site.
 */

export type {
  InfraModel,
  // The schema calls it Node, which shadows the DOM's Node in any file that
  // touches both. Renaming here means consumers never have to think about it.
  Node as InfraNode,
  Edge,
  Diagnostic,
  Attribute,
  Range,
  Stats,
  Expansion,
} from './generated/infra-model';

export type { Catalog, Entry as CatalogEntry } from './generated/catalog';

import type { Attribute, InfraModel } from './generated/infra-model';

/** The schema version this build understands. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Whether a value was determinable.
 *
 * Reading `attribute.known` directly works, but going through this makes the
 * unknown case impossible to forget when destructuring.
 */
export function isKnown(attribute: Attribute): boolean {
  return attribute.known;
}

/**
 * What to show for an attribute.
 *
 * Unknown returns null rather than an empty string on purpose: an empty string
 * is a legitimate Terraform value, and conflating the two would erase exactly
 * the distinction the model exists to preserve.
 */
export function displayValue(attribute: Attribute): string | null {
  if (!attribute.known) return null;
  const { value } = attribute;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * A cheap shape check for a model arriving from outside this session — a
 * shared link, or a version of the analyzer that has moved on.
 *
 * This is not schema validation and does not pretend to be. It catches the
 * common case early so the interface can say something useful instead of
 * failing deep inside a render.
 */
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
