// Builds the analyzer to WebAssembly and reports its transfer size against the
// budget, because a size budget nobody sees is a size budget nobody keeps.
//
// The artifact is never committed: it is produced here and in CI.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(repoRoot, 'core');
const outDir = path.join(repoRoot, 'web', 'public');
const outFile = path.join(outDir, 'analyzer.wasm');

// NFR-5, revised on the evidence from the spike in issue #1.
const BUDGET_BYTES = 2.0 * 1024 * 1024;

fs.mkdirSync(outDir, { recursive: true });

// No shell: arguments go straight to the binary, so the space inside
// -ldflags stays part of one argument and nothing needs escaping.
const goBin = process.platform === 'win32' ? 'go.exe' : 'go';

const build = spawnSync(goBin, ['build', '-ldflags=-s -w', '-o', outFile, './cmd/wasm'], {
  cwd: coreDir,
  stdio: 'inherit',
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
});

if (build.error) {
  console.error('\nCould not run "go". See docs/development.md for setup.\n');
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

// The Go distribution ships the JS shim that boots a Go WASM module. Copy it
// rather than vendoring a snapshot, so it always matches the compiler that
// produced the binary.
const goRoot = spawnSync(goBin, ['env', 'GOROOT'], { encoding: 'utf8' }).stdout.trim();
fs.copyFileSync(
  path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
  path.join(outDir, 'wasm_exec.js'),
);

const bytes = fs.readFileSync(outFile);
const brotli = zlib.brotliCompressSync(bytes, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
});

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const withinBudget = brotli.length <= BUDGET_BYTES;

console.log(`\nanalyzer.wasm  raw ${mb(bytes.length)}  brotli ${mb(brotli.length)}`);
console.log(
  `budget (NFR-5) ${mb(BUDGET_BYTES)}  ->  ${withinBudget ? 'within budget' : 'OVER BUDGET'}`,
);

if (!withinBudget) {
  console.error(
    '\nThe analyzer exceeds its size budget. Either bring it back under, or\n' +
      'revise NFR-5 deliberately and record why — do not quietly raise the number.\n',
  );
  process.exit(1);
}
