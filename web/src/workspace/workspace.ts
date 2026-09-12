/**
 * The workspace: an in-memory file system holding the Terraform under
 * analysis. Nothing here touches disk or network, which is what makes NFR-1
 * structural rather than a promise.
 */

import { extname, normalisePath } from './paths';

export const LIMITS = {
  /** Matches the analyzer's own caps, so the two cannot disagree. */
  maxFiles: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

type WorkspaceChange = { type: 'written'; path: string } | { type: 'cleared' };
type LimitRejection = 'too-many-files' | 'file-too-large' | 'workspace-too-large';
type Listener = (change: WorkspaceChange) => void;

/**
 * A write refused by a limit. Limits throw rather than truncate: a workspace
 * that quietly dropped half a project would present a partial analysis as a
 * complete one.
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

const ANALYSABLE_EXTENSIONS = new Set(['.tf', '.tfvars']);

export function isAnalysable(path: string): boolean {
  return ANALYSABLE_EXTENSIONS.has(extname(path));
}

export class Workspace {
  #files = new Map<string, string>();
  #totalBytes = 0;
  #listeners = new Set<Listener>();

  /**
   * Sorted, so a workspace typed file by file and the same one dropped in at
   * once give the analyzer identical input, and therefore the same diagram.
   */
  list(): string[] {
    return [...this.#files.keys()].sort();
  }

  /**
   * A question, so an unusable path answers "no" instead of throwing. Only
   * `write` refuses, because writing somewhere impossible is a real mistake.
   */
  has(path: string): boolean {
    const normalised = this.#tryNormalise(path);
    return normalised !== null && this.#files.has(normalised);
  }

  read(path: string): string | undefined {
    const normalised = this.#tryNormalise(path);
    return normalised === null ? undefined : this.#files.get(normalised);
  }

  /** Every file, in the shape the analyzer expects. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const path of this.list()) out[path] = this.#files.get(path)!;
    return out;
  }

  /**
   * Creates or replaces a file.
   *
   * @throws {InvalidPathError} when the path escapes the workspace or is malformed
   * @throws {WorkspaceLimitError} when the write would exceed a limit
   */
  write(path: string, content: string): void {
    const normalised = normalisePath(path);
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

  clear(): void {
    if (this.#files.size === 0) return;
    this.#files.clear();
    this.#totalBytes = 0;
    this.#emit({ type: 'cleared' });
  }

  /**
   * Subscribes to changes; the returned function unsubscribes. The editor and
   * the analyzer both follow the workspace rather than each other.
   */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #tryNormalise(path: string): string | null {
    try {
      return normalisePath(path);
    } catch {
      return null;
    }
  }

  #emit(change: WorkspaceChange): void {
    for (const listener of this.#listeners) {
      // One broken subscriber must not stop the others being told.
      try {
        listener(change);
      } catch (error) {
        console.error('A workspace listener threw:', error);
      }
    }
  }
}

/**
 * Bytes rather than UTF-16 code units: `string.length` undercounts every
 * non-ASCII character, so a workspace of CJK comments could sail past a limit
 * it had already exceeded.
 */
function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} kB`;
}
