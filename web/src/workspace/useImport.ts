import { useCallback, useState } from 'react';

import { describeImport, importFiles, type Entry } from './import';

type Progress = { read: number; total: number };

/**
 * Runs an import and keeps its report. The report outlives the panel the
 * import started from: it is the only place a skipped file is explained.
 */
export function useImport(onFiles: (files: Record<string, string>) => void) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<string[] | null>(null);

  const run = useCallback(
    async (read: () => Promise<Entry[]> | Entry[]) => {
      try {
        const entries = await read();
        if (entries.length === 0) return;

        setProgress({ read: 0, total: entries.length });
        const result = await importFiles(entries, (done, total) =>
          setProgress({ read: done, total }),
        );

        setReport(describeImport(result));
        if (Object.keys(result.files).length > 0) onFiles(result.files);
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : '';
        setReport([`The files could not be read.${reason}`]);
      } finally {
        setProgress(null);
      }
    },
    [onFiles],
  );

  return { run, progress, report, dismissReport: () => setReport(null) };
}
