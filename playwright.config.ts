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
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  // slow shops raise these in their profile (timeouts)
  timeout: cfg.timeouts?.test ?? 60_000,
  expect: { timeout: cfg.timeouts?.expect ?? 10_000 },

  // CI: each shard writes a blob report; the merge-reports job turns them into one HTML + JUnit report
  reporter: isCI ? [['list'], ['blob']] : [['list'], ['html', { open: 'on-failure' }]],

  metadata: { project: cfg.name, baseURL: cfg.baseURL },

  use: {
    baseURL: cfg.baseURL,
    httpCredentials: cfg.env.httpCredentials,
    locale: cfg.locale,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
