import type { Text } from '@codemirror/state';
import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';

import type { Diagnostic, Range } from '../model';

/**
 * Analyzer diagnostics as editor markers. The analyzer counts lines and
 * columns from one and CodeMirror counts offsets from zero, so the conversion
 * lives here with tests on it.
 *
 * Everything clamps rather than throws: analysis is debounced, so a diagnostic
 * can describe a line the user has already deleted.
 */
export function toLintDiagnostics(
  doc: Text,
  diagnostics: Diagnostic[],
  path: string,
): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    // A diagnostic without this file has no position here; the list shows it.
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
  if (source.startLine < 1 || doc.lines === 0 || source.startLine > doc.lines) return null;

  const startLine = doc.line(source.startLine);
  const from = Math.min(startLine.from + Math.max(0, source.startCol - 1), startLine.to);

  const endLine = doc.line(Math.min(Math.max(source.endLine, source.startLine), doc.lines));
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
