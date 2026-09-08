import type { Diagnostic } from '../model';

export type DiagnosticsListProps = {
  diagnostics: Diagnostic[];
  onSelect?: (diagnostic: Diagnostic) => void;
};

/**
 * Diagnostics as a list, alongside the markers in the editor.
 *
 * This is not a convenience. Squiggles in a gutter are invisible to somebody
 * using a screen reader, so the list is how NFR-6 is actually met: the same
 * information, in a form that can be read aloud and reached with a keyboard.
 *
 * It is also better for everyone else. A learner needs to know that three
 * things are wrong without hunting for underlines across four files.
 */
export function DiagnosticsList({ diagnostics, onSelect }: DiagnosticsListProps) {
  if (diagnostics.length === 0) {
    return (
      <p className="diagnostics-empty" data-testid="diagnostics-empty">
        No problems found.
      </p>
    );
  }

  const counts = summarise(diagnostics);

  return (
    <div className="diagnostics">
      {/* Announced when the count changes, so a screen reader user learns that
          something broke without having to go looking for it. */}
      <p className="diagnostics-summary" role="status" aria-live="polite">
        {counts}
      </p>

      <ul className="diagnostics-list">
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code ?? 'diagnostic'}-${index}`}>
            <button
              type="button"
              className={`diagnostic diagnostic-${diagnostic.severity}`}
              onClick={() => onSelect?.(diagnostic)}
            >
              <span className="diagnostic-severity">{severityLabel(diagnostic.severity)}</span>
              <span className="diagnostic-message">{diagnostic.message}</span>
              {diagnostic.source.file ? (
                <span className="diagnostic-location">
                  {diagnostic.source.file}
                  {diagnostic.source.startLine > 0 ? `, line ${diagnostic.source.startLine}` : ''}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Severity as a word, not a colour.
 *
 * Colour alone would leave the distinction invisible to a colourblind user and
 * to anyone listening rather than looking (FR-10 applied to diagnostics).
 */
function severityLabel(severity: Diagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return 'Error';
    case 'warning':
      return 'Warning';
    default:
      return 'Note';
  }
}

function summarise(diagnostics: Diagnostic[]): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity]++;

  const parts: string[] = [];
  if (counts.error) parts.push(plural(counts.error, 'error'));
  if (counts.warning) parts.push(plural(counts.warning, 'warning'));
  if (counts.info) parts.push(plural(counts.info, 'note'));

  return parts.join(', ');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
