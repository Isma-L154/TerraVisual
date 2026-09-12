/// <reference lib="webworker" />

/**
 * Runs the WebAssembly analyzer off the main thread, where a slow input cannot
 * freeze the editor and a stuck one can be killed with its worker.
 *
 * A classic worker, not a module one: Go's wasm_exec.js has to be loaded with
 * importScripts. That is also why this file has no imports or exports; its
 * message types are ambient, in messages.d.ts.
 */

// A cast, because `declare const self` would collide with the DOM library.
const scope = globalThis as unknown as TvWorkerScope;

const WASM_EXEC_URL = '/wasm_exec.js';
const WASM_URL = '/analyzer.wasm';

let ready: Promise<void> | null = null;

function boot(): Promise<void> {
  ready ??= (async () => {
    scope.importScripts(WASM_EXEC_URL);

    const go = new scope.Go();
    const { instance } = await WebAssembly.instantiateStreaming(fetch(WASM_URL), go.importObject);

    // The module blocks forever to serve repeated calls, so it is not awaited.
    go.run(instance);

    // Let the Go scheduler register its exports before anything calls them.
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (typeof scope.tvAnalyze !== 'function') {
      throw new Error('The analyzer did not register itself.');
    }
  })();

  return ready;
}

// Download now, so the first analysis does not also pay for it. A failure here
// is reported by the first request instead.
void boot().catch(() => undefined);

scope.onmessage = async (event: MessageEvent<TvAnalyzeRequest>) => {
  const { id, files } = event.data;

  try {
    await boot();
    const model = JSON.parse(scope.tvAnalyze!(files)) as import('../model').InfraModel;
    scope.postMessage({ id, ok: true, model } satisfies TvAnalyzeResponse);
  } catch (error) {
    // Boot again next time, so a transient network failure is not permanent.
    ready = null;
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TvAnalyzeResponse);
  }
};
