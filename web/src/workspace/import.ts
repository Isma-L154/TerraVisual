/** Bringing an existing project in. Files are read in the page and sent nowhere. */

import { isAnalysable, LIMITS } from './workspace';
import { InvalidPathError, normalisePath } from './paths';

type SkipReason =
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
  bytes: number;
};

type Entry = { path: string; file: File };

// .terraform holds downloaded providers; state files routinely contain secrets.
const IGNORED_DIRECTORIES = new Set(['.terraform', '.git', 'node_modules', '.idea', '.vscode']);
const IGNORED_EXTENSIONS = ['.tfstate', '.tfstate.backup'];
const MAX_IMPORT_DEPTH = 24;

export function shouldIgnore(path: string): SkipReason | null {
  const segments = path.split('/');
  if (segments.slice(0, -1).some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return 'generated-directory';
  }

  const name = segments[segments.length - 1] ?? '';
  if (IGNORED_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'generated-directory';
  if (name.startsWith('.terraform.')) return 'generated-directory';

  return null;
}

/** Failures are collected, so one bad file still leaves a diagram of the rest. */
export async function importFiles(
  entries: Entry[],
  onProgress?: (read: number, total: number) => void,
): Promise<ImportResult> {
  const files: Record<string, string> = {};
  const skipped: Skipped[] = [];
  let bytes = 0;

  // Sorted, so which files fit within the limits does not depend on the browser's order.
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

    // Checked before reading, so an oversized file never reaches memory.
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

/** Keeps the directory structure, which relative module sources depend on. */
export async function entriesFromDrop(transfer: DataTransfer): Promise<Entry[]> {
  const roots = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  // Without the directory API there is still a flat list of files.
  if (roots.length === 0) {
    return Array.from(transfer.files).map((file) => ({ path: file.name, file }));
  }

  const out: Entry[] = [];
  for (const root of roots) await walkEntry(root, '', out, 0);
  return out;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: Entry[],
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

  if (!entry.isDirectory || IGNORED_DIRECTORIES.has(entry.name)) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();

  // readEntries returns batches, and an empty batch marks the end.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, path, out, depth + 1);
  }
}

/** A file input reports directories through webkitRelativePath. */
export function entriesFromInput(fileList: FileList): Entry[] {
  return Array.from(fileList).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}

const SKIP_MESSAGES: Record<SkipReason, (files: string) => string> = {
  'not-terraform': (files) => `${files} skipped: not Terraform.`,
  'generated-directory': (files) =>
    `${files} skipped from generated directories such as .terraform, and state files, which can contain secrets.`,
  'too-large': (files) => `${files} skipped: too large.`,
  'too-many-files': (files) => `${files} skipped: the file limit was reached.`,
  'invalid-path': (files) => `${files} skipped: the path was not usable.`,
  unreadable: (files) => `${files} could not be read.`,
};

/** One sentence a user can act on, per reason something was left out. */
export function describeSkipped(skipped: Skipped[]): string[] {
  const counts = new Map<SkipReason, number>();
  for (const item of skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);

  return (Object.keys(SKIP_MESSAGES) as SkipReason[])
    .filter((reason) => counts.has(reason))
    .map((reason) => {
      const count = counts.get(reason)!;
      return SKIP_MESSAGES[reason](`${count} file${count === 1 ? '' : 's'}`);
    });
}
