import { Text } from '@codemirror/state';

import type { Diagnostic } from '../model';
import { toLintDiagnostics, toOffsets } from './diagnostics';

const doc = Text.of(['resource "aws_vpc" "main" {', '  cidr_block = "10.0.0.0/16"', '}']);

function diagnostic(overrides: Partial<Diagnostic> & { source: Diagnostic['source'] }): Diagnostic {
  return {
    severity: 'error',
    message: 'something is wrong',
    ...overrides,
  };
}

// The analyzer speaks in one-based lines and columns, CodeMirror in absolute
// offsets. That mismatch is where off-by-one bugs live.
describe('range conversion', () => {
  it('converts a single-line range', () => {
    const range = toOffsets(doc, {
      file: 'main.tf',
      startLine: 2,
      startCol: 3,
      endLine: 2,
      endCol: 13,
    });

    expect(range).not.toBeNull();
    expect(doc.sliceString(range!.from, range!.to)).toBe('cidr_block');
  });

  it('converts a range spanning several lines', () => {
    const range = toOffsets(doc, {
      file: 'main.tf',
      startLine: 1,
      startCol: 1,
      endLine: 3,
      endCol: 2,
    });

    expect(doc.sliceString(range!.from, range!.to)).toContain('cidr_block');
  });

  // Analysis is debounced, so a diagnostic can easily describe a line the user
  // has already deleted. Throwing while rendering a marker would take out the
  // editor over a stale message.
  it('clamps a range past the end of the document instead of throwing', () => {
    const range = toOffsets(doc, {
      file: 'main.tf',
      startLine: 3,
      startCol: 1,
      endLine: 99,
      endCol: 400,
    });

    expect(range).not.toBeNull();
    expect(range!.to).toBeLessThanOrEqual(doc.length);
  });

  it('ignores a range that starts beyond the document', () => {
    expect(
      toOffsets(doc, { file: 'main.tf', startLine: 40, startCol: 1, endLine: 40, endCol: 2 }),
    ).toBeNull();
  });

  it('ignores a range with no position at all', () => {
    expect(
      toOffsets(doc, { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 }),
    ).toBeNull();
  });

  // A zero-width marker is invisible, which defeats the purpose of showing it.
  it('never produces an empty marker', () => {
    const range = toOffsets(doc, {
      file: 'main.tf',
      startLine: 2,
      startCol: 5,
      endLine: 2,
      endCol: 5,
    });

    expect(range!.to).toBeGreaterThan(range!.from);
  });
});

describe('diagnostics for the open file', () => {
  it('keeps only the diagnostics belonging to this file', () => {
    const markers = toLintDiagnostics(
      doc,
      [
        diagnostic({
          source: { file: 'main.tf', startLine: 2, startCol: 3, endLine: 2, endCol: 13 },
          message: 'this one belongs here',
        }),
        diagnostic({
          source: { file: 'other.tf', startLine: 1, startCol: 1, endLine: 1, endCol: 5 },
          message: 'this one belongs to another file',
        }),
      ],
      'main.tf',
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]!.message).toBe('this one belongs here');
  });

  // A limit that was hit belongs to the workspace, not to a line. It shows up
  // in the list rather than as a marker with an invented position.
  it('drops diagnostics that have no position', () => {
    const markers = toLintDiagnostics(
      doc,
      [
        diagnostic({
          source: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
          message: 'this workspace is too large',
        }),
      ],
      'main.tf',
    );

    expect(markers).toHaveLength(0);
  });

  it('carries severity and code across', () => {
    const markers = toLintDiagnostics(
      doc,
      [
        diagnostic({
          severity: 'warning',
          code: 'unresolved-value',
          source: { file: 'main.tf', startLine: 1, startCol: 1, endLine: 1, endCol: 9 },
        }),
      ],
      'main.tf',
    );

    expect(markers[0]!.severity).toBe('warning');
    expect(markers[0]!.source).toBe('unresolved-value');
  });

  it('maps an informational diagnostic to the info severity', () => {
    const markers = toLintDiagnostics(
      doc,
      [
        diagnostic({
          severity: 'info',
          source: { file: 'main.tf', startLine: 1, startCol: 1, endLine: 1, endCol: 9 },
        }),
      ],
      'main.tf',
    );

    expect(markers[0]!.severity).toBe('info');
  });
});
