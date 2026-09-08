// Minimal static server for the browser benchmark.
//
// It exists mainly to serve .wasm with the correct MIME type, which is what
// WebAssembly.instantiateStreaming requires and what issue #4 will have to get
// right in the Cloudflare Worker.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const goRoot = execSync('go env GOROOT', { encoding: 'utf8' }).trim();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tf': 'text/plain; charset=utf-8',
};

const routes = {
  '/': path.join(here, 'browser', 'index.html'),
  '/worker.js': path.join(here, 'browser', 'worker.js'),
  '/wasm_exec.js': path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
  '/analyzer.wasm': path.join(root, 'dist', 'analyzer.wasm'),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = routes[url.pathname];

  if (!file && url.pathname.startsWith('/fixtures/')) {
    const rel = url.pathname.replace('/fixtures/', '');
    // Confine to the spike directory: the same path-traversal discipline the
    // production workspace will need (issue #5).
    const candidate = path.resolve(root, rel.startsWith('testdata/') ? rel : path.join('fixtures', rel));
    if (candidate.startsWith(root)) file = candidate;
  }

  if (!file || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`serving spike harness on http://localhost:${port}/`));
