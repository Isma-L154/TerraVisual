type ImportReportProps = {
  progress: { read: number; total: number } | null;
  report: string[] | null;
  onDismiss: () => void;
};

/** How an import is going, then what it did, until somebody dismisses it. */
export function ImportReport({ progress, report, onDismiss }: ImportReportProps) {
  if (progress) {
    return (
      <p className="import-report" role="status" aria-live="polite">
        Reading {progress.read} of {progress.total} files…
      </p>
    );
  }
  if (!report) return null;

  return (
    <div className="import-report" role="status" aria-live="polite" data-testid="import-report">
      <ul>
        {report.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <button type="button" className="file-tab" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
