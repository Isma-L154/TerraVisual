import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The tests run against the **deployment Worker**, not against Vite's preview
 * server. That costs a build before every run and is worth it: the Worker is
 * what serves the Content Security Policy, and a policy that breaks the editor
 * should fail here rather than in production. Testing the application without
 * the headers it ships with would be testing something we never deploy.
 */

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './web/e2e',
  // Accessibility assertions are about a settled page; a generous timeout is
  // cheaper than a flaky suite.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // On CI an HTML report is uploaded when something fails, which is the only
  // time anybody wants to read one.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The analyzer is WebAssembly compiled on first load. Being explicit about
    // this beats sprinkling waits through the tests.
    actionTimeout: 15_000,
  },

  /*
   * Two projects, so every spec runs without anyone listing it. The budgets are
   * timed alone (`--workers=1`): a second browser on the same cores measures
   * the machine, not the application.
   */
  projects: [
    {
      name: 'chromium',
      testIgnore: /performance.spec.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'performance',
      testMatch: /performance.spec.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // `npm run test:e2e` builds first, so this serves the current code.
    // `--local-upstream` keeps the request's real host. Without it, wrangler
    // presents every local request as the production route's hostname, and the
    // Worker would treat the test server as the site it is allowed to index.
    command: `npx wrangler dev --port ${PORT} --local-upstream localhost:${PORT}`,
    url: BASE_URL,
    // Never reuse a server that is already running. Wrangler reads the asset
    // directory when it starts and does not notice a later rebuild: a
    // long-running dev server answers requests for the new bundle with the
    // index page, and the suite then tests a build nobody made. Observed, not
    // theorised — it cost an afternoon.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
