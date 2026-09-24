import { useId, useState, type FormEvent } from 'react';

type FileBarProps = {
  paths: string[];
  activePath: string;
  onOpen: (path: string) => void;
  /** Each returns a message to show, or null when it worked. */
  onCreate: (input: string) => string | null;
  onRename: (input: string) => string | null;
  onDelete: () => void;
};

type Form = { kind: 'create' | 'rename'; error: string | null };

/** The workspace's files, and what can be done to them. */
export function FileBar({ paths, activePath, onOpen, onCreate, onRename, onDelete }: FileBarProps) {
  const [form, setForm] = useState<Form | null>(null);
  const inputId = useId();
  const errorId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const input = String(new FormData(event.currentTarget).get('path') ?? '');
    const error = form.kind === 'create' ? onCreate(input) : onRename(input);
    setForm(error ? { ...form, error } : null);
  };

  return (
    <>
      <div className="file-bar">
        <nav aria-label="Workspace files" className="file-tabs">
          {paths.map((path) => (
            <button
              key={path}
              type="button"
              className="file-tab"
              aria-current={path === activePath ? 'true' : undefined}
              onClick={() => onOpen(path)}
            >
              {path}
            </button>
          ))}
        </nav>
        <div className="file-actions">
          <button
            type="button"
            className="file-tab"
            onClick={() => setForm({ kind: 'create', error: null })}
          >
            New file
          </button>
          <button
            type="button"
            className="file-tab"
            disabled={!activePath}
            onClick={() => setForm({ kind: 'rename', error: null })}
          >
            Rename
          </button>
          {/* The last file stays: an empty workspace has nowhere to type. */}
          <button
            type="button"
            className="file-tab"
            disabled={paths.length <= 1}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {form ? (
        <form className="file-form" onSubmit={submit}>
          <label htmlFor={inputId}>
            {form.kind === 'create' ? 'New file path' : `Rename ${activePath} to`}
          </label>
          <input
            id={inputId}
            name="path"
            // Opened by a button whose only job is to type here.
            autoFocus
            defaultValue={form.kind === 'rename' ? activePath : ''}
            placeholder={form.kind === 'create' ? 'variables.tf' : undefined}
            aria-invalid={form.error ? true : undefined}
            aria-describedby={form.error ? errorId : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setForm(null);
            }}
          />
          <button type="submit" className="file-tab">
            {form.kind === 'create' ? 'Create' : 'Rename'}
          </button>
          <button type="button" className="file-tab" onClick={() => setForm(null)}>
            Cancel
          </button>
          {form.error ? (
            <p id={errorId} className="file-form-error" role="alert">
              {form.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
