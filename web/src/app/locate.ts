/**
 * Finding the node the cursor is inside.
 *
 * This is the code-to-diagram half of FR-11, and the reason every node in the
 * model carries an exact source range. Keeping it here, as a pure function,
 * means the rule can be tested without an editor or a canvas.
 */

import type { InfraModel, InfraNode } from '../model';

/**
 * The node whose definition contains a line, or null.
 *
 * When several nodes contain the line — a resource inside a module, say — the
 * innermost wins. The narrowest range is the most specific answer, and the
 * most specific answer is what somebody means when they put their cursor on a
 * line.
 */
export function nodeAtLine(model: InfraModel | null, file: string, line: number): string | null {
  if (!model || !file || line < 1) return null;

  let best: InfraNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const node of model.nodes) {
    const { source } = node;
    if (source.file !== file) continue;
    if (source.startLine < 1) continue;
    if (line < source.startLine || line > Math.max(source.endLine, source.startLine)) continue;

    const size = Math.max(source.endLine, source.startLine) - source.startLine;
    // Ties are broken by address so the answer does not depend on model order.
    // Two nodes covering exactly the same lines is unusual but possible with
    // expansion, and a diagram that flickers between them would be worse than
    // one that consistently picks the same one.
    if (size < bestSize || (size === bestSize && best !== null && node.address < best.address)) {
      best = node;
      bestSize = size;
    }
  }

  return best?.id ?? null;
}

/**
 * Whether a node's definition is reachable in the editor.
 *
 * Synthetic containers — a provider frame, a region — are not written anywhere,
 * so selecting one should not try to jump into a file.
 */
export function hasSource(node: InfraNode): boolean {
  return Boolean(node.source.file) && node.source.startLine > 0;
}
