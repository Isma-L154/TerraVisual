/**
 * The contract between the page and the analyzer worker. Ambient rather than
 * exported: any import or export would make the bundler append `export {}`,
 * which the classic worker cannot parse.
 */

type TvAnalyzeRequest = {
  id: number;
  files: Record<string, string>;
};

type TvAnalyzeResponse =
  | { id: number; ok: true; model: import('../model').InfraModel }
  | { id: number; ok: false; error: string };

/** The worker's global scope, plus what Go's shim adds to it. */
type TvWorkerScope = DedicatedWorkerGlobalScope & {
  Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): void };
  tvAnalyze?: (files: Record<string, string>) => string;
};
