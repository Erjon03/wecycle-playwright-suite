/**
 * Self-check for make-summary.ts (node:test). Runs the script as a child process in a temp dir
 * with qa-report/results.json copied from scripts/__fixtures__, then checks qa-report/summary.json.
 * Run: npm run test:summary
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, 'make-summary.ts');
const FIXTURES = path.join(__dirname, '__fixtures__');
const TSX = require.resolve('tsx/cli');

const BASE_ENV = { PROJECT: 'example-suite', ENVIRONMENT: 'staging', OWNER: 'test' };

/** Runs make-summary with the given fixture (or none) and returns exit code, output and parsed summary. */
function run(fixture: string | null, env: Record<string, string> = BASE_ENV) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-summary-'));
  if (fixture) {
    fs.mkdirSync(path.join(dir, 'qa-report'));
    fs.copyFileSync(path.join(FIXTURES, fixture), path.join(dir, 'qa-report', 'results.json'));
  }
  // Clean env: no GitHub vars leak in from a CI run of this test.
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  const res = spawnSync(process.execPath, [TSX, SCRIPT], { cwd: dir, env: childEnv, encoding: 'utf8' });
  const file = path.join(dir, 'qa-report', 'summary.json');
  const summary = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: res.status, stderr: res.stderr, summary };
}

function assertCounts(s: any, c: { passed: number; failed: number; flaky: number; skipped: number }) {
  assert.equal(s.passed, c.passed);
  assert.equal(s.failed, c.failed);
  assert.equal(s.flaky, c.flaky);
  assert.equal(s.skipped, c.skipped);
  assert.equal(s.total, c.passed + c.failed + c.flaky + c.skipped);
}

test('all passed (with one skipped) -> PASSED', () => {
  const { code, summary: s } = run('all-passed.json');
  assert.equal(code, 0);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.status, 'PASSED');
  assertCounts(s, { passed: 2, failed: 0, flaky: 0, skipped: 1 });
  assert.equal(s.duration, 11873);
  assert.ok(Number.isInteger(s.duration));
  assert.deepEqual(s.failedTests, []);
  assert.equal(s.project, 'example-suite');
  assert.equal(s.environment, 'staging');
  assert.equal(s.owner, 'test');
  assert.match(s.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Local run outside a git repo: trigger "local", empty link, git fallbacks empty.
  assert.equal(s.trigger, 'local');
  assert.equal(s.runLink, '');
  assert.equal(typeof s.branch, 'string');
  assert.equal(typeof s.commit, 'string');
});

test('one flaky -> PASSED_WITH_FLAKY, no failedTests', () => {
  const { code, summary: s } = run('one-flaky.json');
  assert.equal(code, 0);
  assert.equal(s.status, 'PASSED_WITH_FLAKY');
  assertCounts(s, { passed: 3, failed: 0, flaky: 1, skipped: 0 });
  assert.deepEqual(s.failedTests, []);
});

test('one failed with multi-line ANSI error -> FAILED, exit 0, clean failedTests entry', () => {
  const { code, summary: s } = run('one-failed.json');
  assert.equal(code, 0);
  assert.equal(s.status, 'FAILED');
  assertCounts(s, { passed: 1, failed: 1, flaky: 0, skipped: 0 });
  assert.equal(s.duration, 7001);
  assert.deepEqual(s.failedTests, [
    {
      title: 'S09 Document download allowed (SX employee) @smoke › S09 SX document file -> 302 to signed blob',
      file: 'tests/smoke/documents.spec.ts',
      error: 'Error: expect(received).toBe(expected)',
    },
  ]);
});

test('missing results.json -> FAILED with all counts 0, exit 0', () => {
  const { code, summary: s } = run(null);
  assert.equal(code, 0);
  assert.equal(s.status, 'FAILED');
  assertCounts(s, { passed: 0, failed: 0, flaky: 0, skipped: 0 });
  assert.equal(s.duration, 0);
  assert.deepEqual(s.failedTests, []);
});

test('unreadable results.json -> FAILED with all counts 0, exit 0', () => {
  const { code, summary: s } = run('unreadable.json');
  assert.equal(code, 0);
  assert.equal(s.status, 'FAILED');
  assertCounts(s, { passed: 0, failed: 0, flaky: 0, skipped: 0 });
});

test('error outside tests (global setup) -> FAILED with one global entry', () => {
  const { code, summary: s } = run('global-error.json');
  assert.equal(code, 0);
  assert.equal(s.status, 'FAILED');
  assertCounts(s, { passed: 0, failed: 0, flaky: 0, skipped: 0 });
  assert.equal(s.failedTests.length, 1);
  assert.equal(s.failedTests[0].error, 'Error: [session] /api/health not OK after 6 tries');
});

test('CI env vars are used for branch, commit, trigger, runLink', () => {
  const { summary: s } = run('all-passed.json', {
    ...BASE_ENV,
    GITHUB_ACTIONS: 'true',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_EVENT_NAME: 'schedule',
    RUN_LINK: 'https://github.com/o/r/actions/runs/1',
  });
  assert.equal(s.branch, 'main');
  assert.equal(s.commit, 'a'.repeat(40));
  assert.equal(s.trigger, 'schedule');
  assert.equal(s.runLink, 'https://github.com/o/r/actions/runs/1');
});

test('missing or invalid PROJECT/ENVIRONMENT/OWNER -> exit 1, no summary', () => {
  const cases: Record<string, string>[] = [
    { ENVIRONMENT: 'staging', OWNER: 'x' },
    { PROJECT: 'example-suite', OWNER: 'x' },
    { PROJECT: 'example-suite', ENVIRONMENT: 'staging' },
    { PROJECT: 'Example-Suite', ENVIRONMENT: 'staging', OWNER: 'x' },
    { PROJECT: 'example-suite', ENVIRONMENT: 'stag ing', OWNER: 'x' },
  ];
  for (const env of cases) {
    const { code, stderr, summary } = run('all-passed.json', env);
    assert.equal(code, 1, JSON.stringify(env));
    assert.match(stderr, /\[make-summary\] env (PROJECT|ENVIRONMENT|OWNER)/);
    assert.equal(summary, null);
  }
});
