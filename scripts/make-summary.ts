/**
 * Shared make-summary v1, keep identical across all QA repos.
 *
 * Reads qa-report/results.json (Playwright JSON reporter) and writes qa-report/summary.json (schema v1)
 * for the central QA report. Paths are relative to the current directory.
 *
 * Env (required): PROJECT, ENVIRONMENT (both ^[a-z0-9-]+$), OWNER.
 * Env (CI):       GITHUB_REF_NAME, GITHUB_SHA, GITHUB_EVENT_NAME, RUN_LINK.
 *                 Local fallback: git branch / commit, trigger "local", runLink "".
 *
 * Exits 0 even when tests failed; exits 1 only on missing or invalid env, or if summary.json can't be written.
 * No project-specific imports: copy this file unchanged into other repos.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RESULTS = path.join('qa-report', 'results.json');
const SUMMARY = path.join('qa-report', 'summary.json');
const SLUG = /^[a-z0-9-]+$/;
const MAX_ERROR = 300;

type Status = 'PASSED' | 'PASSED_WITH_FLAKY' | 'FAILED';
interface FailedTest { title: string; file: string; error: string }
interface Summary {
  schemaVersion: 1;
  project: string;
  environment: string;
  owner: string;
  status: Status;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
  duration: number;
  branch: string;
  commit: string;
  trigger: string;
  runLink: string;
  timestamp: string;
  failedTests: FailedTest[];
}

// Minimal shape of the Playwright JSON report (only the fields used here).
interface PwError { message?: string; location?: { file?: string } }
interface PwTest { status?: string; results?: { error?: PwError; errors?: PwError[] }[] }
interface PwSpec { title: string; file?: string; tests?: PwTest[] }
interface PwSuite { title: string; file?: string; suites?: PwSuite[]; specs?: PwSpec[] }
interface PwReport {
  config?: { rootDir?: string };
  suites?: PwSuite[];
  errors?: PwError[];
  stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number; duration?: number };
}

function fail(msg: string): never {
  console.error(`[make-summary] ${msg}`);
  process.exit(1);
}

function requiredEnv(name: string, pattern?: RegExp): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) fail(`env ${name} is required`);
  if (pattern && !pattern.test(v)) fail(`env ${name}="${v}" must match ${pattern}`);
  return v;
}

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** First non-empty line, ANSI codes stripped, max 300 characters. */
function firstLine(message: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  const clean = (message ?? '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  const line = clean.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.slice(0, MAX_ERROR);
}

function readReport(): PwReport | null {
  try {
    const report = JSON.parse(fs.readFileSync(RESULTS, 'utf8')) as PwReport;
    return report && typeof report === 'object' && report.stats ? report : null;
  } catch {
    return null;
  }
}

/** Spec file path relative to the repo (cwd), e.g. tests/smoke/feed.spec.ts. */
function relFile(file: string, rootDir: string | undefined): string {
  if (!rootDir) return file;
  const rel = path.relative(process.cwd(), path.resolve(rootDir, file));
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
}

/** One entry per test whose final outcome is unexpected; title = describe path + test title. */
function collectFailed(report: PwReport): FailedTest[] {
  const out: FailedTest[] = [];
  const walk = (suite: PwSuite, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'unexpected') continue;
        const last = t.results?.[t.results.length - 1];
        const err = last?.error ?? last?.errors?.[0];
        out.push({
          title: [...titles, spec.title].join(' › '),
          file: relFile(spec.file ?? suite.file ?? '', report.config?.rootDir),
          error: firstLine(err?.message),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title ? [...titles, child.title] : titles);
  };
  // Top-level suites are files; their title is the file path, which goes into `file` instead.
  for (const fileSuite of report.suites ?? []) walk(fileSuite, []);
  // Errors outside tests (e.g. global setup) fail the run but have no test entry.
  for (const e of report.errors ?? []) {
    out.push({ title: 'Global error (outside tests)', file: relFile(e.location?.file ?? '', report.config?.rootDir), error: firstLine(e.message) });
  }
  return out;
}

function main(): void {
  const project = requiredEnv('PROJECT', SLUG);
  const environment = requiredEnv('ENVIRONMENT', SLUG);
  const owner = requiredEnv('OWNER');

  const report = readReport();
  const s = report?.stats ?? {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  const passed = n(s.expected);
  const failed = n(s.unexpected);
  const flaky = n(s.flaky);
  const skipped = n(s.skipped);
  const failedTests = report ? collectFailed(report) : [];
  const globalErrors = (report?.errors ?? []).length > 0;

  const status: Status =
    !report || failed > 0 || globalErrors ? 'FAILED' : flaky > 0 ? 'PASSED_WITH_FLAKY' : 'PASSED';

  const ci = Boolean(process.env.GITHUB_ACTIONS);
  const summary: Summary = {
    schemaVersion: 1,
    project,
    environment,
    owner,
    status,
    passed,
    failed,
    flaky,
    skipped,
    total: passed + failed + flaky + skipped,
    duration: n(s.duration),
    branch: process.env.GITHUB_REF_NAME || git('rev-parse', '--abbrev-ref', 'HEAD'),
    commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD'),
    trigger: process.env.GITHUB_EVENT_NAME || (ci ? '' : 'local'),
    runLink: process.env.RUN_LINK ?? '',
    timestamp: new Date().toISOString(),
    failedTests,
  };

  try {
    fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
    fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + '\n');
  } catch (e) {
    fail(`cannot write ${SUMMARY}: ${(e as Error).message}`);
  }

  if (!report) console.warn(`[make-summary] ${RESULTS} missing or unreadable, status FAILED`);
  console.log(
    `[make-summary] ${summary.status}: ${passed} passed, ${failed} failed, ${flaky} flaky, ${skipped} skipped -> ${SUMMARY}`,
  );
}

main();
