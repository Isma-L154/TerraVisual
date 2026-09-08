// Fails when Go sources are not gofmt-formatted.
//
// `gofmt -l` lists offenders and exits zero regardless, so a naive npm script
// would report success on unformatted code. This existed as a CI step first
// and caught a commit that `npm run verify` had passed — so it lives here now,
// because a local verify that is weaker than CI teaches people to ignore CI.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goBin = process.platform === 'win32' ? 'gofmt.exe' : 'gofmt';

const result = spawnSync(goBin, ['-l', '.'], {
  cwd: path.join(repoRoot, 'core'),
  encoding: 'utf8',
});

if (result.error) {
  console.error('\nCould not run "gofmt". See docs/development.md for setup.\n');
  process.exit(1);
}

const offenders = (result.stdout ?? '').trim();
if (offenders) {
  console.error('These files are not gofmt-formatted:\n' + offenders);
  console.error('\nRun: cd core && gofmt -w .\n');
  process.exit(1);
}

console.log('Go sources are formatted.');
