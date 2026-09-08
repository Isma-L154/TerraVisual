/// <reference lib="webworker" />

/**
 * The analyzer, running where it belongs: off the main thread.
 *
 * Two reasons, and the second is the one that matters. Analysis takes tens to
 * hundreds of milliseconds and happens while the user is typing, so on the main
 * thread it would feel like a broken editor (NFR-2). And confining the WASM
 * module to a disposable thread means a pathological input can be dealt with by
 * terminating the worker rather than the page.
 *
 * This is a *classic* worker on purpose. Go's wasm_exec.js shim is a classic
 * script that assigns to globalThis, and loading it needs importScripts, which
 * module workers do not have. So this file deliberately has no imports and no
 * exports at runtime: the message shapes live in messages.ts, and the only
 * import or export syntax at all: the message shapes are ambient types
 * declared in messages.d.ts, which keeps this file a script.
 */

// A cast rather than a redeclaration: this file is a global script, so
// `declare const self` would collide with the DOM library's own `self`.
const scope = globalThis as unknown as TvWorkerScope;

// Both files are produced by `npm run build:core` and served from the same
// origin. Nothing here reaches outside the page.
const WASM_EXEC_URL = '/wasm_exec.js';
const WASM_URL = '/analyzer.wasm';

let ready: Promise<void> | null = null;

function boot(): Promise<void> {
  if (ready) return ready;

  ready = (async () => {
    // Go's shim is a classic script that assigns to globalThis, so it is
    // loaded with importScripts. That is why this is a classic worker rather
    // than a module one: a module worker has no importScripts, and importing
    // the shim dynamically leaves the bundler rewriting a URL that has to stay
    // exactly as the Go toolchain wrote it.
    //
    // Nothing here needs ES module syntax at runtime -- the only import in
    // this file is a type, which disappears at compile time.
    scope.importScripts(WASM_EXEC_URL);

    const go = new scope.Go();
    // Streaming instantiation requires the server to send application/wasm.
    // The deployment Worker asserts that header against a real response, since
    // getting it wrong fails here in a way that is easy to misread.
    const { instance } = await WebAssembly.instantiateStreaming(fetch(WASM_URL), go.importObject);

    // The module blocks forever to stay alive for repeated calls, so this is
    // deliberately not awaited.
    go.run(instance);

    // Let the Go scheduler register its exports before anything calls them.
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (typeof scope.tvAnalyze !== 'function') {
      throw new Error('The analyzer did not register itself.');
    }
  })();

  return ready;
}

// Start loading immediately: the editor is usable while this happens, and the
// first analysis should not also pay for the download.
void boot().catch(() => {
  // Reported per request instead, where there is somewhere to show it.
});

scope.onmessage = async (event: MessageEvent<TvAnalyzeRequest>) => {
  const { id, files } = event.data;

  try {
    await boot();
    const raw = scope.tvAnalyze!(files);
    const model = JSON.parse(raw) as import('../model').InfraModel;
    const response: TvAnalyzeResponse = { id, ok: true, model };
    scope.postMessage(response);
  } catch (error) {
    // A failed boot is retried rather than cached forever: a transient network
    // failure must not leave the analyzer permanently dead.
    ready = null;
    const response: TvAnalyzeResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
};
