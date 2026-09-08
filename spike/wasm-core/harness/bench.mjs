// Measures what issue #1 asks for: transfer size of the WASM artifact, cold
// instantiation time, and evaluation latency across workspace sizes.
//
// This runs the same .wasm the browser loads, under Node. Browser numbers are
// the authoritative ones for the budgets; this harness exists because it makes
// the measurement reproducible from a single command.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const wasmPath = path.join(root, 'dist', 'analyzer.wasm');

if (!fs.existsSync(wasmPath)) {
  console.error(`missing ${wasmPath} — run the build first`);
  process.exit(1);
}

// --- size ---------------------------------------------------------------
const bytes = fs.readFileSync(wasmPath);
const gzip = zlib.gzipSync(bytes, { level: 9 });
const brotli = zlib.brotliCompressSync(bytes, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
});

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log('=== artifact size ===');
console.log(`raw     ${mb(bytes.length)}`);
console.log(`gzip    ${mb(gzip.length)}`);
console.log(`brotli  ${mb(brotli.length)}   <- what Cloudflare serves`);
console.log();

// --- instantiate --------------------------------------------------------
const goRoot = execSync('go env GOROOT', { encoding: 'utf8' }).trim();
const wasmExec = path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js');
vm.runInThisContext(fs.readFileSync(wasmExec, 'utf8'));

const go = new globalThis.Go();
const t0 = performance.now();
const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
go.run(instance); // never resolves: the module blocks on select{} to stay alive
const instantiateMs = performance.now() - t0;

await new Promise((r) => setTimeout(r, 0));
if (typeof globalThis.tvAnalyze !== 'function') {
  console.error('tvAnalyze was not registered');
  process.exit(1);
}
console.log('=== cold instantiation ===');
console.log(`${instantiateMs.toFixed(1)} ms`);
console.log();

// --- latency ------------------------------------------------------------
function readDir(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.tf')) {
      files[entry.name] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    }
  }
  return files;
}

function percentile(sorted, p) {
  const i = Math.min(Math.floor((sorted.length * p) / 100), sorted.length - 1);
  return sorted[i];
}

const targets = process.argv.slice(2);
const dirs = targets.length ? targets : ['testdata', 'fixtures/n50', 'fixtures/n200', 'fixtures/n1000'];
const runs = 30;

console.log('=== evaluation latency ===');
console.log('workspace              resources   p50        p95        max');
for (const rel of dirs) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) {
    console.log(`${rel.padEnd(22)} (missing — generate it first)`);
    continue;
  }
  const files = readDir(dir);

  globalThis.tvAnalyze(files); // warm up, so we time steady state not first-touch

  const samples = [];
  let resources = 0;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    const out = globalThis.tvAnalyze(files);
    samples.push(performance.now() - s);
    if (i === 0) resources = JSON.parse(out).stats.resources;
  }
  samples.sort((a, b) => a - b);
  const f = (n) => (n.toFixed(1) + ' ms').padEnd(10);
  console.log(
    `${rel.padEnd(22)} ${String(resources).padStart(9)}   ${f(percentile(samples, 50))} ${f(percentile(samples, 95))} ${f(samples[samples.length - 1])}`
  );
}

process.exit(0);
