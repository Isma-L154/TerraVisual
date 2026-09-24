import { checkNewPath } from './newPath';
import type { Workspace } from './workspace';

/** A message to show next to the control, or null when the change was made. */
type Outcome = string | null;

/**
 * What the file bar can do to the workspace. Each action validates the typed
 * path, makes the change, and opens the file it concerns; a refusal (a bad
 * path, a limit) comes back as a sentence instead of an exception.
 */
export function fileActions(
  workspace: Workspace,
  activePath: string,
  open: (path: string) => void,
) {
  return {
    create(input: string): Outcome {
      const checked = checkNewPath(input, (path) => workspace.has(path));
      if (!checked.ok) return checked.message;
      return attempt(() => workspace.write(checked.path, '')) ?? opened(checked.path);
    },

    rename(input: string): Outcome {
      const checked = checkNewPath(input, (path) => path !== activePath && workspace.has(path));
      if (!checked.ok) return checked.message;
      return attempt(() => workspace.rename(activePath, checked.path)) ?? opened(checked.path);
    },

    /** Whoever calls this has already asked the user: there is no undo. */
    remove(): void {
      workspace.remove(activePath);
      open(workspace.list()[0] ?? '');
    },
  };

  function opened(path: string): null {
    open(path);
    return null;
  }
}

function attempt(change: () => void): Outcome {
  try {
    change();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'That change could not be made.';
  }
}
