import { useCallback, useId, useRef, useState } from 'react';

import {
  describeSkipped,
  entriesFromDrop,
  entriesFromInput,
  importFiles,
  type ImportResult,
} from './import';

export type ImportDropZoneProps = {
  onImported: (result: ImportResult) => void;
};

/**
 * Bringing an existing project in.
 *
 * Drag and drop is the obvious gesture and the inaccessible one, so the button
 * is not a fallback — it is the path that works with a keyboard, and it does
 * exactly the same thing.
 */
export function ImportDropZone({ onImported }: ImportDropZoneProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ read: number; total: number } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const run = useCallback(
    async (entries: { path: string; file: File }[]) => {
      if (entries.length === 0) return;

      setProgress({ read: 0, total: entries.length });
      const result = await importFiles(entries, (read, total) => setProgress({ read, total }));
      setProgress(null);

      const messages = describeSkipped(result.skipped);
      const imported = Object.keys(result.files).length;

      setNotes(
        imported === 0
          ? ['Nothing was imported: no Terraform files were found.', ...messages]
          : [`Imported ${imported} file${imported === 1 ? '' : 's'}.`, ...messages],
      );

      onImported(result);
    },
    [onImported],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void entriesFromDrop(event.dataTransfer).then(run);
    },
    [run],
  );

  return (
    <div className="import">
      <div
        className={`import-zone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="import-zone"
      >
        <p className="import-hint">Drop a Terraform project here, or</p>

        {/* A label rather than a button wrapping the input: the input is what
            a screen reader announces and what a keyboard activates, and
            hiding it behind a button would break both. */}
        <label className="import-button" htmlFor={inputId}>
          choose a folder
        </label>
        <input
          id={inputId}
          ref={input}
          type="file"
          className="visually-hidden"
          multiple
          // Non-standard but universally supported, and the only way a
          // browser lets somebody pick a whole directory.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={(event) => {
            if (event.target.files) void run(entriesFromInput(event.target.files));
            event.target.value = '';
          }}
        />

        <p className="import-privacy">Files are read in this page. Nothing is uploaded.</p>
      </div>

      {progress ? (
        <p className="import-progress" role="status" aria-live="polite">
          Reading {progress.read} of {progress.total} files…
        </p>
      ) : null}

      {notes.length > 0 ? (
        <ul className="import-notes" aria-live="polite">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
