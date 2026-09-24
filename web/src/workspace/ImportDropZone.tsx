import { useId } from 'react';

import { entriesFromInput, type Entry } from './import';

type ImportDropZoneProps = {
  onEntries: (read: () => Entry[]) => void;
};

/**
 * Bringing an existing project in. The buttons are not a fallback for dropping:
 * they are the path that works with a keyboard, and they do the same thing.
 * Drops are handled for the whole page, not only here.
 */
export function ImportDropZone({ onEntries }: ImportDropZoneProps) {
  const folderId = useId();
  const filesId = useId();

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files && files.length > 0) {
      const entries = entriesFromInput(files);
      onEntries(() => entries);
    }
    event.target.value = '';
  };

  return (
    <div className="import">
      <div className="import-zone" data-testid="import-zone">
        <p className="import-hint">Drop a Terraform project anywhere on this page, or</p>

        <div className="import-choices">
          {/* Labels rather than buttons wrapping the inputs: the input is what a
              screen reader announces and what a keyboard activates. */}
          <input
            id={folderId}
            type="file"
            className="visually-hidden"
            multiple
            // Non-standard, universally supported on desktop, and the only way
            // a browser lets somebody pick a whole directory.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={onChange}
          />
          <label className="import-button" htmlFor={folderId}>
            Choose a folder
          </label>

          {/* Phones have no directory picker, and one file needs no folder. */}
          <input
            id={filesId}
            type="file"
            className="visually-hidden"
            multiple
            accept=".tf,.tfvars"
            onChange={onChange}
          />
          <label className="import-button" htmlFor={filesId}>
            Choose files
          </label>
        </div>

        <p className="import-privacy">
          Replaces the current workspace. Files are read in this page; nothing is uploaded.
        </p>
      </div>
    </div>
  );
}
