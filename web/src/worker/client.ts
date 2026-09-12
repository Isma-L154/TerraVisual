/**
 * The main thread's side of the analyzer: owns the worker, keeps only the
 * newest request, and times out a worker that never answers.
 */

import { isSupportedModel, type InfraModel } from '../model';

/** Far above any measured analysis, so only something pathological trips it. */
const ANALYSIS_TIMEOUT_MS = 10_000;

type AnalysisOutcome =
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
  #latest = 0;

  /** Only the newest call matters; older ones resolve as superseded rather than hang. */
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
        // A stuck worker is replaced rather than waited on.
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
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ status: 'superseded' });
    }
    this.#pending.clear();
    this.#restart();
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;

    // A classic worker: it loads Go's shim with importScripts.
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
      } else if (!response.ok) {
        pending.resolve({ status: 'failed', message: response.error });
      } else if (!isSupportedModel(response.model)) {
        pending.resolve({
          status: 'failed',
          message: 'The analyzer returned a model this version does not understand.',
        });
      } else {
        pending.resolve({ status: 'ok', model: response.model });
      }
    };

    this.#worker.onerror = (event) => {
      const message = event.message || 'The analyzer stopped unexpectedly.';
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.resolve({ status: 'failed', message });
      }
      this.#pending.clear();
      this.#restart();
    };

    return this.#worker;
  }

  #restart(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
