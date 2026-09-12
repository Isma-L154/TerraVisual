import type { Diagnostic } from '../model';

type DiagnosticsListProps = {
  diagnostics: Diagnostic[];
  onSelect?: (diagnostic: Diagnostic) => void;
};

/**
 * Diagnostics as a list beside the markers in the editor. Squiggles in a
 * gutter are invisible to a screen reader, so this is how NFR-6 is met.
 */
export function DiagnosticsList({ diagnostics, onSelect }: DiagnosticsListProps) {
  if (diagnostics.length === 0) {
    return (
      <p className="diagnostics-empty" data-testid="diagnostics-empty">
        No problems found.
      </p>
    );
  }

  return (
    <div className="diagnostics">
      {/* Announced on change, so a broken workspace is not something to go
          looking for. */}
      <p className="diagnostics-summary" role="status" aria-live="polite">
        {summarise(diagnostics)}
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

/** A word rather than only a colour, which some readers cannot see (FR-10). */
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
