// The analyzer running where it will actually live: off the main thread.
//
// Issue #1 requires proving this works in a real browser worker, not only
// under Node, because instantiateStreaming, the MIME type and the worker
// boundary are all places this could fail in ways Node never shows.

importScripts('/wasm_exec.js');

let bootMs = null;

async function boot() {
  const go = new Go();
  const t0 = performance.now();
  // Streaming instantiation needs the server to send application/wasm.
  // If the MIME type is wrong this throws, which is exactly the failure we
  // want surfaced now rather than during deployment.
  const result = await WebAssembly.instantiateStreaming(fetch('/analyzer.wasm'), go.importObject);
  go.run(result.instance); // never resolves: the module blocks to stay alive
  bootMs = performance.now() - t0;

  // Give the Go scheduler a turn so the global is registered.
  await new Promise((r) => setTimeout(r, 0));
  if (typeof self.tvAnalyze !== 'function') throw new Error('tvAnalyze was not registered');
}

const ready = boot();

self.onmessage = async (event) => {
  const { id, files, runs = 30 } = event.data;
  try {
    await ready;

    self.tvAnalyze(files); // warm up so we time steady state

    const samples = [];
    let stats = null;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      const out = self.tvAnalyze(files);
      samples.push(performance.now() - t);
      if (i === 0) stats = JSON.parse(out).stats;
    }
    samples.sort((a, b) => a - b);
    const pct = (p) => samples[Math.min(Math.floor((samples.length * p) / 100), samples.length - 1)];

    self.postMessage({
      id,
      ok: true,
      bootMs,
      stats,
      p50: pct(50),
      p95: pct(95),
      max: samples[samples.length - 1],
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack ? err.stack : err) });
  }
};
