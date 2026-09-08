/**
 * The main thread's view of the analyzer.
 *
 * Owns the worker's lifecycle, keeps only the newest request, and enforces a
 * timeout — because a worker that never answers is indistinguishable from one
 * that is still thinking, and the interface has to be able to tell the user
 * something either way.
 */

import { isSupportedModel, type InfraModel } from '../model';

/**
 * How long to wait before assuming the worker is stuck.
 *
 * Generous against the measured p95 of 180 ms for a thousand resources, so it
 * only fires on something genuinely pathological rather than on a slow machine.
 */
export const ANALYSIS_TIMEOUT_MS = 10_000;

export type AnalysisOutcome =
  | { status: 'ok'; model: InfraModel }
  | { status: 'failed'; message: string }
  | { status: 'superseded' };

type Pending = {
  resolve: (outcome: AnalysisOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class AnalyzerClient {
  #worker: Worker | null = null;
  #pending = new Map<number, Pending>();
  #nextId = 1;

  /** The request currently in flight; anything older is abandoned. */
  #latest = 0;

  /**
   * Analyzes a workspace snapshot.
   *
   * Only the newest call matters: while somebody types, earlier answers are
   * about code that no longer exists. Superseded requests resolve rather than
   * hang, so callers never have to track which of their awaits is still live.
   */
  analyze(files: Record<string, string>): Promise<AnalysisOutcome> {
    const id = this.#nextId++;
    this.#latest = id;

    for (const [pendingId, pending] of this.#pending) {
      if (pendingId < id) {
        clearTimeout(pending.timer);
        pending.resolve({ status: 'superseded' });
        this.#pending.delete(pendingId);
      }
    }

    return new Promise<AnalysisOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        // A stuck worker is replaced rather than waited on. This is the payoff
        // for putting the analyzer on a disposable thread: the tab survives
        // input the analyzer cannot handle.
        this.#restart();
        resolve({
          status: 'failed',
          message: 'Analysis took too long and was stopped. The workspace may be too large.',
        });
      }, ANALYSIS_TIMEOUT_MS);

      this.#pending.set(id, { resolve, timer });

      try {
        this.#ensureWorker().postMessage({ id, files } satisfies TvAnalyzeRequest);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        resolve({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** Stops the worker and abandons anything in flight. */
  dispose(): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve({ status: 'superseded' });
    }
    this.#pending.clear();
    this.#worker?.terminate();
    this.#worker = null;
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;

    // Classic rather than module: the worker loads Go's wasm_exec.js shim with
    // importScripts, which module workers do not have. Nothing in the worker
    // needs ES module syntax at runtime.
    this.#worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), {
      name: 'terravisual-analyzer',
    });

    this.#worker.onmessage = (event: MessageEvent<TvAnalyzeResponse>) => {
      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.#pending.delete(response.id);

      if (response.id !== this.#latest) {
        pending.resolve({ status: 'superseded' });
        return;
      }
      if (!response.ok) {
        pending.resolve({ status: 'failed', message: response.error });
        return;
      }
      // The worker is our own code, but the model crosses a boundary and
      // arrives as JSON. Checking the shape here means a version mismatch
      // surfaces as a message rather than as a crash deep inside a render.
      if (!isSupportedModel(response.model)) {
        pending.resolve({
          status: 'failed',
          message: 'The analyzer returned a model this version does not understand.',
        });
        return;
      }
      pending.resolve({ status: 'ok', model: response.model });
    };

    this.#worker.onerror = (event) => {
      const message = event.message || 'The analyzer stopped unexpectedly.';
      for (const [id, pending] of this.#pending) {
        clearTimeout(pending.timer);
        pending.resolve({ status: 'failed', message });
        this.#pending.delete(id);
      }
      this.#restart();
    };

    return this.#worker;
  }

  #restart(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
