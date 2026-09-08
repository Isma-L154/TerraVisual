// Runs a go command inside core/, so the same npm script works on Windows,
// macOS and Linux without anyone remembering to change directory first.
//
// The repository is bilingual by decision (ADR-0002). These wrappers are how
// that cost is kept off day-to-day work: one entry point, one command shape.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(repoRoot, 'core');

// Resolve the binary explicitly rather than going through a shell: Node
// does not apply PATHEXT, and shell:true would leave arguments unescaped.
const goBin = process.platform === 'win32' ? 'go.exe' : 'go';

const result = spawnSync(goBin, process.argv.slice(2), {
  cwd: coreDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error(
    '\nCould not run "go". Install Go 1.27 or newer and make sure it is on PATH.\n' +
      'See docs/development.md for setup.\n',
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
