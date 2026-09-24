import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InfraModel } from '../model';
import type { Workspace } from '../workspace/workspace';
import { AnalyzerClient } from '../worker/client';

/** Long enough that a burst of typing is one analysis, short enough to feel live. */
const DEBOUNCE_MS = 250;

type AnalysisState = {
  model: InfraModel | null;
  /** True while an analysis is in flight and the model on screen is stale. */
  analyzing: boolean;
  /** Set when analysis could not run at all, as opposed to finding problems. */
  error: string | null;
};

/** Runs the analyzer, debounced, whenever the workspace changes. */
export function useAnalysis(workspace: Workspace): AnalysisState {
  const client = useMemo(() => new AnalyzerClient(), []);
  const [state, setState] = useState<AnalysisState>({
    model: null,
    analyzing: true,
    error: null,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped when the workspace is cleared, so an analysis of the old one that
  // lands afterwards is not drawn.
  const epoch = useRef(0);

  const run = useCallback(() => {
    setState((previous) => ({ ...previous, analyzing: true }));
    const started = epoch.current;

    void client.analyze(workspace.snapshot()).then((outcome) => {
      // The user typed again and a newer analysis is already on its way.
      if (outcome.status === 'superseded' || started !== epoch.current) return;

      if (outcome.status === 'failed') {
        setState((previous) => ({ ...previous, analyzing: false, error: outcome.message }));
        return;
      }
      setState({ model: outcome.model, analyzing: false, error: null });
    });
  }, [client, workspace]);

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, DEBOUNCE_MS);
    };

    // Also on mount, so a restored or shared workspace draws itself.
    schedule();

    const unsubscribe = workspace.subscribe((change) => {
      // A cleared workspace is being replaced: the old model describes nothing
      // the user can see any more, and keeping it would draw the old project
      // until the new one had been analysed.
      if (change.type === 'cleared') {
        epoch.current++;
        setState((previous) => ({ ...previous, model: null }));
      }
      schedule();
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workspace, run]);

  useEffect(() => () => client.dispose(), [client]);

  return state;
}
