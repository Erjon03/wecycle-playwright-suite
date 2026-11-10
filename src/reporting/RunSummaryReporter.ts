import * as fs from 'fs';
import * as path from 'path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/**
 * Writes a short run summary (every test with its status) next to the full HTML report:
 *   run-summary/<project>_<date>_<time>.md / .html / .json
 * In GitHub Actions the Markdown is also added to the run's summary page.
 * The .json files feed scripts/combine-run-summaries.ts (one report for all shops).
 *
 * The files get shared with people outside the repo, so they carry no environment details:
 * URLs in error messages are replaced by <url>, and values of URL/credential env vars by <redacted>.
 * Shop-agnostic: the only shop detail used is the profile's display name (config.metadata.project).
 */

/** blocked = failed only because a page did not load in time (slow/unreachable shop), not a real test failure */
export type Status = 'passed' | 'failed' | 'flaky' | 'blocked' | 'skipped';

export interface Row {
  browser: string;
  file: string;
  title: string;
  status: Status;
  durationMs: number;
  error?: string;
}

export interface RunInfo {
  project: string;
  started: string; // ISO date
  durationMs: number;
  overall: FullResult['status'];
  trigger: string;
  runUrl?: string;
}

export interface RunSummary {
  info: RunInfo;
  rows: Row[];
}

interface Options {
  outputDir?: string;
}

const STATUS_ORDER: Status[] = ['failed', 'flaky', 'blocked', 'passed', 'skipped'];
const STATUS_LABEL: Record<Status, string> = {
  failed: '❌ failed',
  flaky: '⚠️ flaky',
  blocked: '🚧 blocked',
  passed: '✅ passed',
  skipped: '⏭️ skipped',
};

// page.goto / reload / waitForURL ran into the navigation timeout: the shop did not deliver the page in time
const PAGE_LOAD_TIMEOUT = /^TimeoutError: page\.(goto|reload|goBack|goForward|waitForURL|waitForNavigation): Timeout \d+ms exceeded/;

/**
 * A failure whose first error is a page-load timeout counts as "blocked" (reported under Blocked/Skipped),
 * not as "failed". Also applied when older summaries are combined, so their numbers match.
 */
export function classify(row: Row): Row {
  return row.status === 'failed' && row.error && PAGE_LOAD_TIMEOUT.test(row.error) ? { ...row, status: 'blocked' } : row;
}

export default class RunSummaryReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  private readonly outputDir: string;

  constructor(options: Options = {}) {
    this.outputDir = options.outputDir ?? 'run-summary';
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  onEnd(result: FullResult): void {
    // `playwright test --list` also ends here, without running anything → no summary
    if (this.suite.allTests().every((t) => t.results.length === 0)) return;
    const rows = this.suite.allTests().map((t) => this.toRow(t));
    rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

    const summary: RunSummary = {
      info: {
        project: String(this.config.metadata?.project ?? process.env.PROJECT ?? 'unknown'),
        started: result.startTime.toISOString(),
        durationMs: result.duration,
        overall: result.status,
        trigger: describeTrigger(),
        runUrl: githubRunUrl(),
      },
      rows,
    };

    const base = path.join(this.outputDir, `${slug(summary.info.project)}_${fileStamp(summary.info.started)}`);
    const md = toMarkdown(summary);
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(`${base}.md`, md);
    fs.writeFileSync(`${base}.html`, toHtml([summary]));
    fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));

    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    console.log(`Run summary: ${base}.html\n\nStatus report:\n${toStatusReport(summary)}`);
  }

  private toRow(test: TestCase): Row {
    const outcome = test.outcome();
    const last = test.results[test.results.length - 1];
    const status: Status =
      outcome === 'expected' ? 'passed' : outcome === 'unexpected' ? 'failed' : outcome;
    return classify({
      browser: test.parent.project()?.name ?? '',
      file: path.relative(this.config.rootDir, test.location.file),
      // titlePath: ['', project, file, ...describe blocks, test title]
      title: test.titlePath().slice(3).join(' › '),
      status,
      durationMs: test.results.reduce((sum, r) => sum + r.duration, 0),
      error: status === 'failed' || status === 'flaky' ? firstErrorLine(test, last) : undefined,
    });
  }
}

function firstErrorLine(test: TestCase, last: TestCase['results'][number] | undefined): string | undefined {
  // flaky: the last attempt passed, so take the error of the first failed attempt
  const result = last?.errors.length ? last : test.results.find((r) => r.errors.length);
  const message = result?.errors[0]?.message;
  if (!message) {
    // test.fail() for a known issue, but the test passed → no error, the issue may be fixed
    if (test.expectedStatus === 'failed' && last?.status === 'passed') {
      const reason = test.annotations.find((a) => a.type === 'fail')?.description;
      return `Expected to fail${reason ? ` (${reason})` : ''}, but passed: issue may be fixed`;
    }
    return undefined;
  }
  const line = stripAnsi(message).split('\n').find((l) => l.trim()) ?? '';
  return redact(line.trim()).slice(0, 200);
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

// env vars whose values must never end up in a summary (shop URL/host, credentials, codes)
// (optional per-shop suffix, e.g. BASE_URL_VF, PROMOTION_CODE_SBS)
const SECRET_ENV = /(_URL|_HOST|USERNAME|PASSWORD|SECRET|TOKEN|_KEY|_CODE|CLIENT_ID)(_[A-Z0-9]+)?$/;

function secretValues(): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 4 || !SECRET_ENV.test(key) || key.startsWith('GITHUB_') || key.startsWith('RUNNER_')) continue;
    values.add(value);
    // the host alone can show up without "https://", e.g. in DNS errors
    if (/^https?:\/\//.test(value)) {
      try {
        values.add(new URL(value).host);
      } catch {
        /* not a URL */
      }
    }
  }
  return [...values].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
}

export function redact(s: string): string {
  let out = s.replace(/https?:\/\/\S+/g, '<url>');
  for (const v of secretValues()) out = out.split(v).join('<redacted>');
  return out;
}

function describeTrigger(): string {
  if (!process.env.GITHUB_ACTIONS) return 'local run';
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  const labels: Record<string, string> = {
    schedule: 'daily CI run',
    push: 'CI run (push)',
    pull_request: 'CI run (pull request, @smoke only)',
    workflow_dispatch: 'CI run (started manually)',
  };
  // RUN_GREP: optional, set by the workflow to the "grep" input of a manual run
  const grep = process.env.RUN_GREP?.trim();
  return (labels[event] ?? `CI run (${event})`) + (grep ? `, only tests matching ${grep}` : '');
}

function githubRunUrl(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

// display name e.g. "My Shop (staging)" → "my-shop-staging"
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ISO date → "2026-11-04_0300"
export function fileStamp(iso: string): string {
  return iso.slice(0, 16).replace('T', '_').replace(':', '');
}

function count(rows: Row[]): Record<Status, number> {
  const c: Record<Status, number> = { passed: 0, failed: 0, flaky: 0, blocked: 0, skipped: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

// Playwright marks the run "failed" for blocked tests too; those alone do not make the summary FAILED
function isFailed(run: RunSummary): boolean {
  if (run.rows.some((r) => r.status === 'failed') || endedEarly(run)) return true;
  return run.info.overall !== 'passed' && !run.rows.some((r) => r.status === 'blocked');
}

function endedEarly(run: RunSummary): boolean {
  return run.info.overall === 'interrupted' || run.info.overall === 'timedout';
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ') + ' UTC';
}

function md(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function mdTable(list: Row[], withError: boolean): string {
  return [
    `| Status | Test | File | Browser | Time${withError ? ' | Error' : ''} |`,
    `|---|---|---|---|---${withError ? '|---' : ''}|`,
    ...list.map(
      (r) =>
        `| ${STATUS_LABEL[r.status]} | ${md(r.title)} | ${md(r.file)} | ${r.browser} | ${formatDuration(r.durationMs)}` +
        (withError ? ` | ${md(r.error ?? '')}` : '') +
        ' |',
    ),
  ].join('\n');
}

export function toMarkdown(run: RunSummary): string {
  const { info, rows } = run;
  const c = count(rows);
  const problems = rows.filter((r) => r.status === 'failed' || r.status === 'flaky' || r.status === 'blocked');
  const lines = [
    `## Test run: ${info.project} ${isFailed(run) ? '❌ FAILED' : '✅ PASSED'}`,
    '',
    `**${formatDate(info.started)}** · ${info.trigger} · duration ${formatDuration(info.durationMs)}` +
      (info.runUrl ? ` · [full report and traces](${info.runUrl})` : ''),
    '',
    '**Status report:**',
    '',
    '```',
    toStatusReport(run),
    '```',
    '',
    `| Total | ✅ Passed | ❌ Failed | ⚠️ Flaky | 🚧 Blocked | ⏭️ Skipped |`,
    `|---|---|---|---|---|---|`,
    `| ${rows.length} | ${c.passed} | ${c.failed} | ${c.flaky} | ${c.blocked} | ${c.skipped} |`,
    '',
  ];
  if (endedEarly(run)) lines.push(`> Run ended early (${info.overall}): not every test ran.`, '');
  if (c.blocked) lines.push(`> 🚧 Blocked = ${BLOCKED_NOTE}.`, '');
  if (problems.length) lines.push('### Failed, flaky and blocked tests', '', mdTable(problems, true), '');
  lines.push('<details><summary>All tests</summary>', '', mdTable(rows, false), '', '</details>', '');
  return lines.join('\n');
}

export const BLOCKED_NOTE = 'the page did not load in time (slow or unreachable shop), not a real test failure';

/**
 * The team's status report for one shop (7 lines, ready to paste), e.g.
 *   Project: My Shop (staging)
 *   Tests run: 117
 *   Passed: 99
 *   Failed: 0
 *   Blocked/Skipped: 18 (15 blocked: page did not load in time, 3 skipped)
 *   Failed – already reported: 0
 *   Tickets: none
 * With real failures the last two lines are placeholders: which failures are known bugs (and their tickets)
 * is decided by a person after triage.
 */
export function toStatusReport(run: RunSummary): string {
  const c = count(run.rows);
  const passed = c.passed + c.flaky;
  const failed = run.rows.filter((r) => r.status === 'failed');
  const knownFixed = failed.filter((r) => r.error?.startsWith('Expected to fail')).length;

  const passedNote = c.flaky ? ` (${c.flaky} flaky, passed on retry)` : '';
  const failedNotes = [
    knownFixed ? `${knownFixed} known issue${knownFixed === 1 ? '' : 's'} now passing, may be fixed` : '',
    endedEarly(run) ? `run ended early (${run.info.overall}), not every test ran` : '',
  ].filter(Boolean);
  const blockedSkipped = c.blocked + c.skipped;
  const bsNote = c.blocked
    ? ` (${c.blocked} blocked: page did not load in time${c.skipped ? `, ${c.skipped} skipped` : ''})`
    : '';

  return [
    `Project: ${run.info.project}`,
    `Tests run: ${run.rows.length}`,
    `Passed: ${passed}${passedNote}`,
    `Failed: ${failed.length}${failedNotes.length ? ` (${failedNotes.join('; ')})` : ''}`,
    `Blocked/Skipped: ${blockedSkipped}${bsNote}`,
    `Failed – already reported: ${failed.length ? '<fill in>' : '0'}`,
    `Tickets: ${failed.length ? '<fill in>' : 'none'}`,
  ].join('\n');
}

export const REPORT_HINT = 'fill in "<fill in>" after triage (known bugs and their tickets) before posting';

export function toCombinedMarkdown(runs: RunSummary[]): string {
  const overview = [
    `# Test runs: ${shops(runs.length)} ${runs.some(isFailed) ? '❌ FAILED' : '✅ PASSED'}`,
    '',
    `**Status report** (${REPORT_HINT}):`,
    '',
    '```',
    runs.map(toStatusReport).join('\n\n'),
    '```',
    '',
    `| Shop | Result | Total | ✅ Passed | ❌ Failed | ⚠️ Flaky | 🚧 Blocked | ⏭️ Skipped | Started | Duration |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...runs.map((run) => {
      const c = count(run.rows);
      return (
        `| ${md(run.info.project)} | ${isFailed(run) ? '❌ failed' : '✅ passed'} | ${run.rows.length} | ${c.passed} | ` +
        `${c.failed} | ${c.flaky} | ${c.blocked} | ${c.skipped} | ${formatDate(run.info.started)} | ${formatDuration(run.info.durationMs)} |`
      );
    }),
    '',
  ];
  return [...overview, ...runs.map(toMarkdown)].join('\n');
}

function shops(n: number): string {
  return `${n} shop${n === 1 ? '' : 's'}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function tiles(rows: Row[]): string {
  const c = count(rows);
  return `<div class="tiles">
    <div class="tile"><b>${rows.length}</b><span>Total</span></div>
    <div class="tile"><b class="t-pass">${c.passed}</b><span>Passed</span></div>
    <div class="tile"><b class="t-fail">${c.failed}</b><span>Failed</span></div>
    <div class="tile"><b class="t-flaky">${c.flaky}</b><span>Flaky</span></div>
    <div class="tile" title="${esc(BLOCKED_NOTE)}"><b class="t-blocked">${c.blocked}</b><span>Blocked</span></div>
    <div class="tile"><b class="t-skip">${c.skipped}</b><span>Skipped</span></div>
  </div>`;
}

function result(failed: boolean): string {
  return `<span class="result ${failed ? 't-fail' : 't-pass'}">${failed ? 'FAILED' : 'PASSED'}</span>`;
}

function runSection(run: RunSummary, heading: 'h1' | 'h2'): string {
  const { info, rows } = run;
  const body = rows
    .map(
      (r) => `<tr class="${r.status}">
  <td><span class="badge">${r.status}</span></td>
  <td>${esc(r.title)}${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}</td>
  <td class="mono">${esc(r.file)}</td>
  <td>${esc(r.browser)}</td>
  <td class="num">${formatDuration(r.durationMs)}</td>
</tr>`,
    )
    .join('\n');
  const prefix = heading === 'h1' ? 'Test run: ' : '';
  return `<section id="${slug(info.project)}">
  <${heading}>${prefix}${esc(info.project)} ${result(isFailed(run))}</${heading}>
  <div class="meta">${formatDate(info.started)} · ${esc(info.trigger)} · duration ${formatDuration(info.durationMs)}${
    endedEarly(run) ? ` · ended early (${info.overall})` : ''
  }${info.runUrl ? ` · <a href="${esc(info.runUrl)}">full report and traces</a>` : ''}</div>
  ${tiles(rows)}${rows.some((r) => r.status === 'blocked') ? `\n  <p class="meta">Blocked = ${esc(BLOCKED_NOTE)}.</p>` : ''}
  <div class="table-wrap">
  <table>
    <thead><tr><th>Status</th><th>Test</th><th>File</th><th>Browser</th><th class="num">Time</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  </div>
</section>`;
}

function overviewSection(runs: RunSummary[]): string {
  const rows = runs
    .map((run) => {
      const c = count(run.rows);
      return `<tr>
  <td><a href="#${slug(run.info.project)}">${esc(run.info.project)}</a></td>
  <td>${result(isFailed(run))}</td>
  <td class="num">${run.rows.length}</td>
  <td class="num t-pass">${c.passed}</td>
  <td class="num t-fail">${c.failed}</td>
  <td class="num t-flaky">${c.flaky}</td>
  <td class="num t-blocked">${c.blocked}</td>
  <td class="num t-skip">${c.skipped}</td>
  <td class="num">${formatDate(run.info.started)}</td>
  <td class="num">${formatDuration(run.info.durationMs)}</td>
</tr>`;
    })
    .join('\n');
  return `<section>
  <h1>Test runs: ${shops(runs.length)} ${result(runs.some(isFailed))}</h1>
  ${tiles(runs.flatMap((r) => r.rows))}
  <div class="table-wrap">
  <table>
    <thead><tr><th>Shop</th><th>Result</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th>
      <th class="num">Flaky</th><th class="num">Blocked</th><th class="num">Skipped</th><th class="num">Started</th><th class="num">Duration</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
</section>`;
}

/** One run → single-shop page; several runs → overview table on top, then one section per shop. */
export function toHtml(runs: RunSummary[]): string {
  const title = runs.length === 1 ? `Test run ${runs[0].info.project}` : `Test runs ${shops(runs.length)}`;
  const teams = `<div class="teams">
  <div class="teams-head"><b>Status report</b><span>${esc(REPORT_HINT)}</span></div>
  <pre>${esc(runs.map(toStatusReport).join('\n\n'))}</pre>
</div>`;
  const content =
    runs.length === 1
      ? runSection(runs[0], 'h1').replace('<div class="tiles">', `${teams}\n  <div class="tiles">`)
      : [overviewSection(runs).replace('<div class="tiles">', `${teams}\n  <div class="tiles">`), ...runs.map((r) => runSection(r, 'h2'))].join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg:#fff; --fg:#1d2330; --muted:#667085; --line:#e4e7ec; --pass:#12805c; --fail:#c4320a; --flaky:#b54708; --skip:#667085; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14171f; --fg:#e6e8ee; --muted:#98a2b3; --line:#2b313d; --pass:#47cd89; --fail:#f97066; --flaky:#fdb022; --skip:#98a2b3; } }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width:1100px; margin:0 auto; }
  section + section { margin-top:48px; padding-top:24px; border-top:2px solid var(--line); }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:18px; margin:0 0 4px; }
  a { color:inherit; }
  .meta { color:var(--muted); margin-bottom:20px; }
  .result { font-weight:600; }
  .t-pass { color:var(--pass); } .t-fail { color:var(--fail); } .t-flaky { color:var(--flaky); } .t-blocked { color:var(--flaky); } .t-skip { color:var(--skip); }
  .tiles { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0 24px; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:10px 16px; min-width:90px; }
  .tile b { display:block; font-size:22px; }
  .tile span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .mono { font-family:ui-monospace, Menlo, monospace; font-size:12px; color:var(--muted); }
  .num { white-space:nowrap; text-align:right; }
  .badge { font-size:12px; font-weight:600; text-transform:uppercase; }
  .passed .badge { color:var(--pass); } .failed .badge { color:var(--fail); }
  .flaky .badge { color:var(--flaky); } .blocked .badge { color:var(--flaky); } .skipped .badge { color:var(--skip); }
  .teams { border:1px solid var(--line); border-left:4px solid var(--muted); border-radius:8px; padding:12px 16px; margin:16px 0; }
  .teams-head { display:flex; gap:12px; flex-wrap:wrap; align-items:baseline; }
  .teams-head span { color:var(--muted); font-size:12px; }
  .teams pre { margin:8px 0 0; font:13px/1.6 ui-monospace, Menlo, monospace; white-space:pre-wrap; user-select:all; }
  .err { margin-top:4px; font-family:ui-monospace, Menlo, monospace; font-size:12px; color:var(--fail); word-break:break-word; }
</style>
</head>
<body>
<main>
${content}
</main>
</body>
</html>
`;
}
