/**
 * How infrastructure is described in words.
 *
 * Separate from the catalog because it answers a different question: the
 * catalog says what a resource type is called, this decides what somebody
 * listening actually hears. It lives beside the diagram because both views
 * that need it already read from here.
 */

import type { InfraModel, InfraNode } from '../model';
import { displayType } from './catalog';

/**
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
