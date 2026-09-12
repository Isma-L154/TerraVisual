import type { InfraModel, InfraNode } from '../model';

/**
 * The node whose source contains a line. The innermost wins, and ties are
 * broken by address so the answer never depends on model order.
 */
export function nodeAtLine(model: InfraModel | null, file: string, line: number): string | null {
  if (!model || !file || line < 1) return null;

  let best: InfraNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const node of model.nodes) {
    const { source } = node;
    if (source.file !== file || source.startLine < 1) continue;

    const end = Math.max(source.endLine, source.startLine);
    if (line < source.startLine || line > end) continue;

    const size = end - source.startLine;
    if (size < bestSize || (size === bestSize && best !== null && node.address < best.address)) {
      best = node;
      bestSize = size;
    }
  }

  return best?.id ?? null;
}

/** Synthetic containers, such as a provider frame or a region, are not written anywhere. */
export function hasSource(node: InfraNode): boolean {
  return Boolean(node.source.file) && node.source.startLine > 0;
}
