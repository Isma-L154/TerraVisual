/**
 * The contract between the page and the analyzer worker.
 *
 * These are ambient rather than exported on purpose. The worker must stay a
 * *classic* script so it can call importScripts to load Go's wasm_exec.js
 * shim, and any import or export syntax makes the bundler append `export {}`,
 * which a classic worker cannot parse.
 *
 * A file with no top-level import or export is global, and the inline
 * `import('...')` type syntax below does not change that — so both sides get
 * one shared definition without either becoming a module.
 */

type TvAnalyzeRequest = {
  id: number;
  files: Record<string, string>;
};

type TvAnalyzeResponse =
  | { id: number; ok: true; model: import('../model').InfraModel }
  | { id: number; ok: false; error: string };

/**
 * The worker's global scope, with what the Go shim adds to it.
 *
 * Declared here rather than in the worker because the worker is a global
 * script: a `declare const self` there would collide with the DOM library's
 * own `self`. The worker casts globalThis to this instead.
 */
type TvWorkerScope = DedicatedWorkerGlobalScope & {
  Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): void };
  tvAnalyze?: (files: Record<string, string>) => string;
};
