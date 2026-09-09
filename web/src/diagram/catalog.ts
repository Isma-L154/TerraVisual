/**
 * The interface's half of the catalog.
 *
 * The analyzer reads the same files for containment rules; this reads them for
 * presentation — display name, icon, documentation. One source, two consumers,
 * which is the whole point of ADR-0004.
 */

import type { Catalog, CatalogEntry, InfraModel, InfraNode } from '../model';

/**
 * Every catalog file, discovered rather than listed.
 *
 * ADR-0004 says adding a provider means adding data and never touching code.
 * A hand-written import list would have quietly made that false: a new
 * provider would need a line here, and the one that was forgotten would be
 * invisible in the interface while working perfectly in the analyzer.
 */
const modules = import.meta.glob<{ default: Catalog }>('../../../catalog/*.json', {
  eager: true,
});

const catalogs: Catalog[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path]!.default);

const byType = new Map<string, CatalogEntry>();
for (const catalog of catalogs) {
  for (const entry of catalog.entries) byType.set(entry.type, entry);
}

export function lookup(resourceType: string): CatalogEntry | undefined {
  return byType.get(resourceType);
}

/**
 * What to call a resource type on screen.
 *
 * The raw Terraform type is a poor label for somebody learning: `aws_db_instance`
 * is not how anyone says "RDS instance". Uncatalogued types fall back to the
 * raw type, which is honest — we genuinely do not know a better name.
 */
export function displayType(resourceType: string): string {
  return byType.get(resourceType)?.displayName ?? resourceType;
}

/** Documentation for a type, when the catalog has it. */
export function documentationUrl(resourceType: string): string | undefined {
  return byType.get(resourceType)?.documentationUrl;
}

/** How many resource types the catalog knows. Used by tests. */
export function catalogSize(): number {
  return byType.size;
}

/**
 * How a resource is announced, in words.
 *
 * Shared by the diagram and the outline on purpose. They are two views of one
 * model, and somebody who moves between them should not have to learn two
 * vocabularies — nor discover that the picture told them something the text
 * did not. Everything a node conveys visually is said here: what it is, whose
 * it is, where it sits, whether anything about it is unknown, and what it
 * connects to.
 */
export function announce(
  node: InfraNode,
  parent?: InfraNode,
  connections?: string[],
  childCount = 0,
  hiddenCount = 0,
): string {
  const parts: string[] = [`${node.label}, ${displayType(node.type)}`];

  if (node.provider && node.provider !== 'unknown' && node.type !== 'provider') {
    parts.push(node.provider);
  }
  if (parent) parts.push(`in ${parent.label}`);
  if (!node.catalogued) parts.push('resource type not in the catalog');
  if (node.unplaced) parts.push('could not be placed');

  const unknown = Object.values(node.attributes).filter((attribute) => !attribute.known).length;
  if (unknown > 0) {
    parts.push(`${unknown} value${unknown === 1 ? '' : 's'} not determinable`);
  }

  if (childCount > 0) parts.push(`contains ${childCount}`);
  // Said out loud as well as drawn. Somebody reading by ear must not be left
  // believing an empty-looking container is empty.
  if (hiddenCount > 0) parts.push(`holding ${hiddenCount} not shown, press to open`);

  // An arrow nobody can hear is information available only to people who can
  // see it, which is the thing the outline exists to prevent — and the diagram
  // should not be worse than the outline at saying it.
  if (connections && connections.length > 0) parts.push(...connections);

  return parts.join(', ');
}

/**
 * The connections leaving each node, as phrases.
 *
 * Only the ones the diagram draws: the outline is a peer view of the same
 * picture, not a more detailed one, and reading out every reference would bury
 * the few that matter.
 */
export function connectionsByNode(model: InfraModel): Map<string, string[]> {
  const labels = new Map(model.nodes.map((node) => [node.id, node.label]));
  const out = new Map<string, string[]>();

  for (const edge of model.edges) {
    if (!edge.drawn) continue;
    const target = labels.get(edge.to);
    if (!target) continue;

    // "to internet to main" is what the obvious phrasing produced, because the
    // catalog's labels are already prepositional ("to internet", "via NAT").
    // Parenthesising the label keeps both halves legible when read aloud.
    const phrase = edge.label ? `connects to ${target} (${edge.label})` : `connects to ${target}`;
    out.set(edge.from, [...(out.get(edge.from) ?? []), phrase]);
  }

  return out;
}
