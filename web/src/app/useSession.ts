import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeFragment } from '../persistence/share';
import { clear as clearStored, load, save } from '../persistence/storage';
import { Workspace } from '../workspace/workspace';
import { STARTER_WORKSPACE } from './examples';

const SAVE_DEBOUNCE_MS = 800;

export type SessionOrigin = 'starter' | 'restored' | 'shared' | 'imported' | 'example';

type Session = {
  workspace: Workspace;
  origin: SessionOrigin;
  /** True until the first load has been attempted. */
  loading: boolean;
  storageAvailable: boolean;
  /** A link carried a workspace that could not be opened. */
  sharedLinkRefused: boolean;
  /** Files a shared or stored workspace held that did not fit the limits. */
  leftOut: number;
  /**
   * Changes whenever the workspace is swapped for another, so views that keep
   * state about the old one (what is expanded, where the camera is) start over.
   */
  generation: number;
  /** Back to the example. */
  reset: () => void;
  /** Replaces everything, as an import or an example does. */
  replace: (files: Record<string, string>, origin: SessionOrigin) => void;
};

/**
 * The workspace for this visit, kept between visits. A shared link wins over
 * stored work, which stays in storage untouched.
 */
export function useSession(): Session {
  const [workspace] = useState(() => new Workspace());
  const [origin, setOrigin] = useState<SessionOrigin>('starter');
  const [loading, setLoading] = useState(true);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [sharedLinkRefused, setSharedLinkRefused] = useState(false);
  const [leftOut, setLeftOut] = useState(0);
  const [generation, setGeneration] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const shared = await decodeFragment(window.location.hash);
      if (cancelled) return;

      if (!shared.ok && shared.reason !== 'absent') setSharedLinkRefused(true);

      if (shared.ok) {
        setLeftOut(fill(workspace, shared.files));
        setOrigin('shared');
      } else {
        const stored = await load();
        if (cancelled) return;

        const restorable = stored && Object.keys(stored.files).length > 0;
        setLeftOut(fill(workspace, restorable ? stored.files : STARTER_WORKSPACE));
        setOrigin(restorable ? 'restored' : 'starter');
      }
      setLoading(false);
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  // Debounced, so typing is not a write per keystroke and a crash loses little.
  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void save(workspace.snapshot()).then((saved) => {
          if (!saved) setStorageAvailable(false);
        });
      }, SAVE_DEBOUNCE_MS);
    };

    const unsubscribe = workspace.subscribe(schedule);
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workspace]);

  const reset = useCallback(() => {
    workspace.clear();
    fill(workspace, STARTER_WORKSPACE);
    setOrigin('starter');
    setGeneration((current) => current + 1);
    void clearStored();
    forgetSharedLink();
  }, [workspace]);

  const replace = useCallback(
    (files: Record<string, string>, origin: SessionOrigin) => {
      workspace.clear();
      fill(workspace, files);
      setOrigin(origin);
      setGeneration((current) => current + 1);
      forgetSharedLink();
    },
    [workspace],
  );

  return {
    workspace,
    origin,
    loading,
    storageAvailable,
    sharedLinkRefused,
    leftOut,
    generation,
    reset,
    replace,
  };
}

/** Otherwise a reload would bring the shared workspace back. */
function forgetSharedLink(): void {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/**
 * Sorted, so which files fit within the limits does not depend on key order.
 * Returns how many were left out (an unusable path, or over a limit), which
 * the page reports: a partial workspace must not pass for a whole one.
 */
function fill(workspace: Workspace, files: Record<string, string>): number {
  let leftOut = 0;
  for (const path of Object.keys(files).sort()) {
    try {
      workspace.write(path, files[path]!);
    } catch {
      leftOut++;
    }
  }
  return leftOut;
}
