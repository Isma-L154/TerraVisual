import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeFragment } from '../persistence/share';
import { clear as clearStored, load, save } from '../persistence/storage';
import { Workspace } from '../workspace/workspace';
import { STARTER_WORKSPACE } from './examples';

const SAVE_DEBOUNCE_MS = 800;

export type SessionOrigin = 'starter' | 'restored' | 'shared' | 'imported';

type Session = {
  workspace: Workspace;
  origin: SessionOrigin;
  /** True until the first load has been attempted. */
  loading: boolean;
  storageAvailable: boolean;
  /** Back to the example. */
  reset: () => void;
  /** Replaces everything, as an import does. */
  replace: (files: Record<string, string>) => void;
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

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const shared = await decodeFragment(window.location.hash);
      if (cancelled) return;

      if (shared.ok) {
        fill(workspace, shared.files);
        setOrigin('shared');
      } else {
        const stored = await load();
        if (cancelled) return;

        const restorable = stored && Object.keys(stored.files).length > 0;
        fill(workspace, restorable ? stored.files : STARTER_WORKSPACE);
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
    void clearStored();
    forgetSharedLink();
  }, [workspace]);

  const replace = useCallback(
    (files: Record<string, string>) => {
      workspace.clear();
      fill(workspace, files);
      setOrigin('imported');
      forgetSharedLink();
    },
    [workspace],
  );

  return { workspace, origin, loading, storageAvailable, reset, replace };
}

/** Otherwise a reload would bring the shared workspace back. */
function forgetSharedLink(): void {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/** Sorted, so which files fit within the limits does not depend on key order. */
function fill(workspace: Workspace, files: Record<string, string>): void {
  for (const path of Object.keys(files).sort()) {
    try {
      workspace.write(path, files[path]!);
    } catch {
      // An invalid path or a file over the limits is left out.
    }
  }
}
