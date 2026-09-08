/**
 * Bringing an existing project in.
 *
 * Everything here runs in the page. Files are read with FileReader and never
 * sent anywhere, which is what makes the privacy claim checkable rather than
 * promised: open the network panel during an import and there is nothing to
 * see.
 */

import { isAnalysable, LIMITS } from './workspace';
import { InvalidPathError, normalisePath } from './paths';

/** Why a file was left out. Each one is reported rather than swallowed. */
export type SkipReason =
  | 'not-terraform'
  | 'generated-directory'
  | 'too-large'
  | 'invalid-path'
  | 'unreadable'
  | 'too-many-files';

export type Skipped = {
  path: string;
  reason: SkipReason;
  detail?: string;
};

export type ImportResult = {
  files: Record<string, string>;
  skipped: Skipped[];
  /** Bytes actually read, for the progress the caller shows. */
  bytes: number;
};

/**
 * Directories that are never worth reading.
 *
 * `.terraform` holds downloaded providers — hundreds of megabytes that would
 * blow every limit and contain nothing to draw. State files are excluded for a
 * stronger reason: they routinely contain secrets, and this tool has no
 * business reading them even locally.
 */
const IGNORED_DIRECTORIES = new Set(['.terraform', '.git', 'node_modules', '.idea', '.vscode']);
const IGNORED_EXTENSIONS = new Set(['.tfstate', '.tfstate.backup']);

export function shouldIgnore(path: string): SkipReason | null {
  const segments = path.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (IGNORED_DIRECTORIES.has(segment)) return 'generated-directory';
  }

  const name = segments[segments.length - 1] ?? '';
  for (const extension of IGNORED_EXTENSIONS) {
    if (name.endsWith(extension)) return 'generated-directory';
  }
  if (name.startsWith('.terraform.')) return 'generated-directory';

  return null;
}

export type ImportProgress = (read: number, total: number) => void;

/**
 * Reads a set of files into a workspace shape.
 *
 * Failures are collected rather than thrown: a project with one unreadable
 * file should still produce a diagram for everything else.
 */
export async function importFiles(
  entries: { path: string; file: File }[],
  onProgress?: ImportProgress,
): Promise<ImportResult> {
  const files: Record<string, string> = {};
  const skipped: Skipped[] = [];
  let bytes = 0;

  // Sorted so an import is deterministic: which files land inside the limits
  // must not depend on the order the browser handed them over.
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));

  for (const [index, entry] of sorted.entries()) {
    onProgress?.(index, sorted.length);

    const ignored = shouldIgnore(entry.path);
    if (ignored) {
      skipped.push({ path: entry.path, reason: ignored });
      continue;
    }
    if (!isAnalysable(entry.path)) {
      skipped.push({ path: entry.path, reason: 'not-terraform' });
      continue;
    }

    let path: string;
    try {
      path = normalisePath(entry.path);
    } catch (error) {
      skipped.push({
        path: entry.path,
        reason: 'invalid-path',
        ...(error instanceof InvalidPathError ? { detail: error.rejection } : {}),
      });
      continue;
    }

    // Size is checked before reading, so an enormous file never reaches
    // memory in the first place.
    if (entry.file.size > LIMITS.maxFileBytes) {
      skipped.push({ path, reason: 'too-large' });
      continue;
    }
    if (bytes + entry.file.size > LIMITS.maxTotalBytes) {
      skipped.push({ path, reason: 'too-large', detail: 'the workspace limit was reached' });
      continue;
    }
    if (Object.keys(files).length >= LIMITS.maxFiles) {
      skipped.push({ path, reason: 'too-many-files' });
      continue;
    }

    try {
      files[path] = await entry.file.text();
      bytes += entry.file.size;
    } catch (error) {
      skipped.push({
        path,
        reason: 'unreadable',
        ...(error instanceof Error ? { detail: error.message } : {}),
      });
    }
  }

  onProgress?.(sorted.length, sorted.length);
  return { files, skipped, bytes };
}

/**
 * Flattens a drop into a list of files with their paths.
 *
 * The directory structure is preserved deliberately: relative module sources
 * resolve against it, so flattening a project would break every module in it.
 */
export async function entriesFromDrop(
  transfer: DataTransfer,
): Promise<{ path: string; file: File }[]> {
  const roots: FileSystemEntry[] = [];

  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }

  // Without the directory API there is still a flat file list, which is worse
  // but not nothing: a single file or a multi-select still works.
  if (roots.length === 0) {
    return Array.from(transfer.files).map((file) => ({ path: file.name, file }));
  }

  const out: { path: string; file: File }[] = [];
  for (const root of roots) {
    await walkEntry(root, '', out, 0);
  }
  return out;
}

/** Depth of directory recursion, bounded because the input is arbitrary. */
const MAX_IMPORT_DEPTH = 24;

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { path: string; file: File }[],
  depth: number,
): Promise<void> {
  if (depth > MAX_IMPORT_DEPTH) return;

  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) out.push({ path, file });
    return;
  }

  if (!entry.isDirectory) return;
  if (IGNORED_DIRECTORIES.has(entry.name)) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();

  // readEntries returns at most a hundred at a time and signals the end with
  // an empty batch, so a large directory needs repeated calls.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) break;

    for (const child of batch) {
      await walkEntry(child, path, out, depth + 1);
    }
  }
}

/** Flattens a file input, which reports directories in webkitRelativePath. */
export function entriesFromInput(fileList: FileList): { path: string; file: File }[] {
  return Array.from(fileList).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}

/** A sentence a user can act on, for each reason something was left out. */
export function describeSkipped(skipped: Skipped[]): string[] {
  const counts = new Map<SkipReason, number>();
  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  const messages: string[] = [];
  const say = (reason: SkipReason, text: (count: number) => string) => {
    const count = counts.get(reason);
    if (count) messages.push(text(count));
  };

  say('not-terraform', (n) => `${n} file${n === 1 ? '' : 's'} skipped: not Terraform.`);
  say(
    'generated-directory',
    (n) =>
      `${n} file${n === 1 ? '' : 's'} skipped from generated directories such as .terraform, and state files, which can contain secrets.`,
  );
  say('too-large', (n) => `${n} file${n === 1 ? '' : 's'} skipped: too large.`);
  say(
    'too-many-files',
    (n) => `${n} file${n === 1 ? '' : 's'} skipped: the file limit was reached.`,
  );
  say('invalid-path', (n) => `${n} file${n === 1 ? '' : 's'} skipped: the path was not usable.`);
  say('unreadable', (n) => `${n} file${n === 1 ? '' : 's'} could not be read.`);

  return messages;
}
