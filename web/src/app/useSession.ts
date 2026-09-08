import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeFragment } from '../persistence/share';
import { clear as clearStored, load, save } from '../persistence/storage';
import { createWorkspace, Workspace } from '../workspace/workspace';
import { STARTER_WORKSPACE } from './examples';

/** How long after the last edit the workspace is written to storage. */
const SAVE_DEBOUNCE_MS = 800;

export type SessionOrigin = 'starter' | 'restored' | 'shared';

export type Session = {
  workspace: Workspace;
  /** Where the current workspace came from, so the interface can say. */
  origin: SessionOrigin;
  /** True until the first load has been attempted. */
  loading: boolean;
  /** Set when persistence is unavailable, so the interface can be honest. */
  storageAvailable: boolean;
  /** Replace everything with the example again. */
  reset: () => void;
};

/**
 * The workspace for this visit, and keeping it between visits.
 *
 * The order matters and is deliberate: a shared link wins over stored work,
 * because somebody who followed a link asked to see what is in it. Their own
 * work is not lost — it is still in storage, and resetting brings back the
 * example rather than overwriting anything silently.
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
        setLoading(false);
        return;
      }

      const stored = await load();
      if (cancelled) return;

      if (stored && Object.keys(stored.files).length > 0) {
        fill(workspace, stored.files);
        setOrigin('restored');
        setLoading(false);
        return;
      }

      fill(workspace, STARTER_WORKSPACE);
      setOrigin('starter');
      setLoading(false);
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  // Saving is debounced separately from analysis: writing on every keystroke
  // would be pointless work, and writing only on unload would lose a session
  // to a crashed tab.
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

    // The fragment goes too. Leaving it would restore the shared workspace on
    // the next reload, which is not what "reset" means to anybody.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [workspace]);

  return { workspace, origin, loading, storageAvailable, reset };
}

function fill(workspace: Workspace, files: Record<string, string>): void {
  const { workspace: staged } = createWorkspace(files);
  for (const entry of staged.entries()) {
    try {
      workspace.write(entry.path, entry.content);
    } catch {
      // Rejected by a limit, which createWorkspace already accounted for.
    }
  }
}
