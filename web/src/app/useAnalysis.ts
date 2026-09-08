import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InfraModel } from '../model';
import type { Workspace } from '../workspace/workspace';
import { AnalyzerClient } from '../worker/client';

/**
 * How long to wait after a keystroke before analyzing.
 *
 * Chosen against the measured numbers rather than by feel: analysis of a
 * 200-resource workspace takes about 37 ms, so the debounce is what the user
 * actually perceives. Long enough that a burst of typing is one analysis,
 * short enough that the diagram feels attached to the code.
 */
export const DEBOUNCE_MS = 250;

export type AnalysisState = {
  model: InfraModel | null;
  /** True while an analysis is in flight and the model on screen is stale. */
  analyzing: boolean;
  /** Set when analysis could not run at all, as opposed to finding problems. */
  error: string | null;
};

/**
 * Runs the analyzer whenever the workspace changes.
 *
 * The debounce lives here, at the boundary, rather than inside the analyzer:
 * a stale diagram for 250 ms is fine, a frozen editor never is.
 */
export function useAnalysis(workspace: Workspace): AnalysisState {
  const client = useMemo(() => new AnalyzerClient(), []);
  const [state, setState] = useState<AnalysisState>({
    model: null,
    analyzing: true,
    error: null,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(() => {
    setState((previous) => ({ ...previous, analyzing: true }));

    void client.analyze(workspace.snapshot()).then((outcome) => {
      // A superseded request is not a result and not a failure: the user typed
      // again, and a newer analysis is already on its way.
      if (outcome.status === 'superseded') return;

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

    // Analyze once on mount so an imported or restored workspace draws itself
    // without waiting for the user to type something. It goes through the same
    // debounce as everything else, which keeps the path uniform and keeps the
    // first render free of synchronous state updates.
    schedule();

    const unsubscribe = workspace.subscribe(schedule);
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workspace, run]);

  useEffect(() => () => client.dispose(), [client]);

  return state;
}
