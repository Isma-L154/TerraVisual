import type { Text } from '@codemirror/state';
import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';

import type { Diagnostic, Range } from '../model';

/**
 * Translates analyzer diagnostics into editor markers.
 *
 * The analyzer speaks in one-based lines and columns; CodeMirror works in
 * absolute document offsets. That mismatch is a rich source of off-by-one
 * bugs, so the conversion lives in one place with tests on it.
 *
 * Everything here clamps rather than throws. Analysis is debounced, so a
 * diagnostic can easily describe a line the user has already deleted — and an
 * exception while rendering a marker would take out the editor over a stale
 * message.
 */
export function toLintDiagnostics(
  doc: Text,
  diagnostics: Diagnostic[],
  path: string,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    // A diagnostic with no file belongs to the workspace as a whole -- a limit
    // that was hit, say -- and has no position in this document. It is shown
    // in the list instead.
    if (diagnostic.source.file !== path) continue;

    const range = toOffsets(doc, diagnostic.source);
    if (!range) continue;

    out.push({
      from: range.from,
      to: range.to,
      severity: severityFor(diagnostic.severity),
      message: diagnostic.message,
      ...(diagnostic.code ? { source: diagnostic.code } : {}),
    });
  }

  return out;
}

/** Resolves a one-based line and column range to document offsets. */
export function toOffsets(doc: Text, source: Range): { from: number; to: number } | null {
  if (source.startLine < 1 || doc.lines === 0) return null;
  if (source.startLine > doc.lines) return null;

  const startLine = doc.line(source.startLine);
  const from = Math.min(startLine.from + Math.max(0, source.startCol - 1), startLine.to);

  const endLineNumber = Math.min(Math.max(source.endLine, source.startLine), doc.lines);
  const endLine = doc.line(endLineNumber);
  let to = Math.min(endLine.from + Math.max(0, source.endCol - 1), endLine.to);

  // A zero-width marker is invisible, which defeats the purpose of showing it.
  if (to <= from) to = Math.min(from + 1, doc.length);

  return { from, to };
}

function severityFor(severity: Diagnostic['severity']): LintDiagnostic['severity'] {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}
