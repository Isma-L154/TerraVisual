import { InvalidPathError, normalisePath } from './paths';
import { isAnalysable } from './workspace';

type Checked = { ok: true; path: string } | { ok: false; message: string };

/** A path somebody typed for a new or renamed file, checked into something to act on or to say. */
export function checkNewPath(input: string, taken: (path: string) => boolean): Checked {
  if (input.trim() === '')
    return { ok: false, message: 'Enter a file name, such as variables.tf.' };

  let path: string;
  try {
    path = normalisePath(input.trim());
  } catch (error) {
    if (!(error instanceof InvalidPathError)) throw error;
    return { ok: false, message: 'Use a relative path that stays inside the workspace.' };
  }

  if (!isAnalysable(path)) {
    return { ok: false, message: 'Only .tf and .tfvars files are analysed.' };
  }
  if (taken(path)) return { ok: false, message: `${path} already exists.` };
  return { ok: true, path };
}
