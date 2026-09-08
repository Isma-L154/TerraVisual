/**
 * The workspace: an in-memory virtual file system holding the Terraform under
 * analysis.
 *
 * Multi-file from the start, because the product supports both writing
 * Terraform and bringing an existing project. Everything downstream — the
 * editor, the analyzer, persistence, import — consumes this rather than a
 * single string of text.
 *
 * Nothing here touches disk or network. The files live in memory for the life
 * of the tab, which is what makes the privacy claim in NFR-1 structural rather
 * than a promise.
 */

import { InvalidPathError, extname, normalisePath, type PathRejection } from './paths';

/** Limits on what a workspace will hold. */
export const LIMITS = {
  /** Matches the analyzer's own cap, so the two cannot disagree. */
  maxFiles: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

export type WorkspaceFile = {
  readonly path: string;
  readonly content: string;
};

export type WorkspaceChange =
  { type: 'written'; path: string } | { type: 'removed'; path: string } | { type: 'cleared' };

export type LimitRejection = 'too-many-files' | 'file-too-large' | 'workspace-too-large';

/**
 * A write refused because it would exceed a limit.
 *
 * Limits produce errors rather than silent truncation. A workspace that
 * quietly dropped half a project would present a partial analysis as a
 * complete one, which is the failure mode this project cares most about.
 */
export class WorkspaceLimitError extends Error {
  constructor(
    readonly path: string,
    readonly rejection: LimitRejection,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceLimitError';
  }
}

export type Listener = (change: WorkspaceChange) => void;

/** Terraform files. Everything else is skipped on import and reported. */
const ANALYSABLE_EXTENSIONS = new Set(['.tf', '.tfvars']);

export function isAnalysable(path: string): boolean {
  return ANALYSABLE_EXTENSIONS.has(extname(path));
}

export class Workspace {
  #files = new Map<string, string>();
  #totalBytes = 0;
  #listeners = new Set<Listener>();

  /** Number of files currently held. */
  get size(): number {
    return this.#files.size;
  }

  /** Total size in bytes, as measured for the limits. */
  get totalBytes(): number {
    return this.#totalBytes;
  }

  /**
   * Paths in sorted order.
   *
   * Sorted rather than insertion-ordered so the analyzer receives the same
   * workspace however it was assembled — typed file by file, or dropped in all
   * at once. Determinism here is what keeps the diagram from reshuffling.
   */
  list(): string[] {
    return [...this.#files.keys()].sort();
  }

  has(path: string): boolean {
    return this.#files.has(this.#normalise(path));
  }

  read(path: string): string | undefined {
    return this.#files.get(this.#normalise(path));
  }

  /** Every file, in the shape the analyzer expects. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const path of this.list()) {
      out[path] = this.#files.get(path)!;
    }
    return out;
  }

  entries(): WorkspaceFile[] {
    return this.list().map((path) => ({ path, content: this.#files.get(path)! }));
  }

  /**
   * Creates or replaces a file.
   *
   * @throws {InvalidPathError} when the path escapes the workspace or is malformed
   * @throws {WorkspaceLimitError} when the write would exceed a limit
   */
  write(path: string, content: string): void {
    const normalised = this.#normalise(path);
    const size = byteLength(content);
    const previous = this.#files.get(normalised);
    const previousSize = previous === undefined ? 0 : byteLength(previous);

    if (size > LIMITS.maxFileBytes) {
      throw new WorkspaceLimitError(
        normalised,
        'file-too-large',
        `${normalised} is ${formatBytes(size)}, over the ${formatBytes(LIMITS.maxFileBytes)} limit for a single file.`,
      );
    }
    if (previous === undefined && this.#files.size >= LIMITS.maxFiles) {
      throw new WorkspaceLimitError(
        normalised,
        'too-many-files',
        `This workspace already holds ${LIMITS.maxFiles} files, which is the limit.`,
      );
    }

    const total = this.#totalBytes - previousSize + size;
    if (total > LIMITS.maxTotalBytes) {
      throw new WorkspaceLimitError(
        normalised,
        'workspace-too-large',
        `Adding ${normalised} would take this workspace over the ${formatBytes(LIMITS.maxTotalBytes)} limit.`,
      );
    }

    this.#files.set(normalised, content);
    this.#totalBytes = total;
    this.#emit({ type: 'written', path: normalised });
  }

  /** Removes a file. Returns whether there was one to remove. */
  remove(path: string): boolean {
    const normalised = this.#normalise(path);
    const existing = this.#files.get(normalised);
    if (existing === undefined) return false;

    this.#files.delete(normalised);
    this.#totalBytes -= byteLength(existing);
    this.#emit({ type: 'removed', path: normalised });
    return true;
  }

  clear(): void {
    if (this.#files.size === 0) return;
    this.#files.clear();
    this.#totalBytes = 0;
    this.#emit({ type: 'cleared' });
  }

  /**
   * Subscribes to changes. Returns a function that unsubscribes.
   *
   * The editor and the analyzer both follow the workspace rather than each
   * other, which is what keeps them from having to know about one another.
   */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #normalise(path: string): string {
    return normalisePath(path);
  }

  #emit(change: WorkspaceChange): void {
    for (const listener of this.#listeners) {
      // One broken subscriber must not stop the others from being told, nor
      // leave the workspace in a half-notified state.
      try {
        listener(change);
      } catch (error) {
        console.error('A workspace listener threw:', error);
      }
    }
  }
}

/**
 * Builds a workspace from a set of files, collecting failures instead of
 * stopping at the first one.
 *
 * Import (#17) needs to load what it can and report the rest: a project with
 * one oversized file should still produce a diagram for everything else.
 */
export function createWorkspace(files: Record<string, string> = {}): {
  workspace: Workspace;
  rejected: { path: string; reason: PathRejection | LimitRejection; message: string }[];
} {
  const workspace = new Workspace();
  const rejected: { path: string; reason: PathRejection | LimitRejection; message: string }[] = [];

  for (const path of Object.keys(files).sort()) {
    try {
      workspace.write(path, files[path]!);
    } catch (error) {
      if (error instanceof InvalidPathError) {
        rejected.push({ path, reason: error.rejection, message: error.message });
      } else if (error instanceof WorkspaceLimitError) {
        rejected.push({ path, reason: error.rejection, message: error.message });
      } else {
        throw error;
      }
    }
  }

  return { workspace, rejected };
}

/**
 * Size in bytes rather than in UTF-16 code units.
 *
 * `string.length` would undercount every non-ASCII character, so a workspace
 * of CJK comments could sail past a limit it had already exceeded.
 */
function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} kB`;
}
