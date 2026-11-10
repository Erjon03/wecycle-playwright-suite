import { defineConfig, devices, type Project } from '@playwright/test';
import { loadConfig } from './src/config/loader';

const cfg = loadConfig();
const isCI = !!process.env.CI;

// SKIP_CHECKOUT_TESTS=true → checkout specs are never collected (e.g. client froze test orders)
const ignoredTests = [/setup\/.*/, ...(process.env.SKIP_CHECKOUT_TESTS === 'true' ? [/checkout\.spec\.ts/] : [])];

const extraBrowsers = (process.env.EXTRA_BROWSERS ?? '')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

const browserDevices: Record<string, (typeof devices)[string]> = {
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

const desktopProjects: Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ...extraBrowsers
    .filter((b) => browserDevices[b])
    .map((b) => ({ name: b, use: { ...browserDevices[b] } })),
].map((p) => ({
  ...p,
  testDir: './tests',
  testIgnore: ignoredTests,
  grepInvert: /@mobile-only/,
  dependencies: ['setup'],
}));

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  // CI retries also detect flaky tests for the central QA report (keep >= 1)
  retries: isCI ? 2 : 0,
  // one CI job (no shards, public repo = no artifacts): 4 workers = the same shop load as the former 2 shards x 2 workers
  workers: isCI ? 4 : undefined,
  // slow shops raise these in their profile (timeouts)
  timeout: cfg.timeouts?.test ?? 60_000,
  expect: { timeout: cfg.timeouts?.expect ?? 10_000 },

  // qa-report/results.json feeds scripts/make-summary.ts → qa-report/summary.json (central QA report, uploaded in CI).
  // run-summary/<project>_<date>_<time>.html/.md/.json: shareable overview, no URLs (in CI also on the run's summary page).
  reporter: isCI
    ? [['list'], ['json', { outputFile: 'qa-report/results.json' }], ['./src/reporting/RunSummaryReporter.ts']]
    : [
        ['list'],
        ['html', { open: 'on-failure' }],
        ['json', { outputFile: 'qa-report/results.json' }],
        ['./src/reporting/RunSummaryReporter.ts'],
      ],

  // the JSON report copies metadata into results.json, which is uploaded in CI → no shop URL there
  metadata: isCI ? { project: cfg.name } : { project: cfg.name, baseURL: cfg.baseURL },

  use: {
    baseURL: cfg.baseURL,
    httpCredentials: cfg.env.httpCredentials,
    locale: cfg.locale,
    // public repo: no traces/screenshots/videos in CI (they could show customer data); kept for local runs
    trace: isCI ? 'off' : 'retain-on-failure',
    screenshot: isCI ? 'off' : 'only-on-failure',
    video: isCI ? 'off' : 'retain-on-failure',
    actionTimeout: cfg.timeouts?.action ?? 15_000,
    navigationTimeout: cfg.timeouts?.navigation ?? 30_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /setup\/.*\.setup\.ts/,
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /setup\/.*\.teardown\.ts/,
    },
    ...desktopProjects,
    {
      name: 'mobile',
      testDir: './tests',
      testIgnore: ignoredTests,
      grep: /@mobile/,
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
    },
  ],
});
