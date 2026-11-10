/**
 * Combines the latest run summary of each shop into one report:
 *   run-summary/combined_<date>_<time>.html / .md / -report.txt (status report, ready to paste)
 *
 * Usage: npm run report:combined [-- <folder with run summary .json files>]   (default: run-summary)
 * In GitHub Actions the Markdown is also added to the run's summary page, but only for 2+ shops:
 * with a single shop the reporter has already written the same summary there.
 */
import * as fs from 'fs';
import * as path from 'path';
import { classify, fileStamp, REPORT_HINT, toCombinedMarkdown, toHtml, toStatusReport, type RunSummary } from '../src/reporting/RunSummaryReporter.ts';

const dir = process.argv[2] ?? 'run-summary';

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'))
  : [];
// classify again: summaries written before the "blocked" status existed count page-load timeouts as failed
const summaries: RunSummary[] = files.map((f) => {
  const s: RunSummary = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { ...s, rows: s.rows.map(classify) };
});
if (!summaries.length) {
  console.error(`No run summaries (.json) found in ${dir}`);
  process.exit(1);
}

// latest run per shop, shops in alphabetical order
const latest = new Map<string, RunSummary>();
for (const s of summaries) {
  const prev = latest.get(s.info.project);
  if (!prev || s.info.started > prev.info.started) latest.set(s.info.project, s);
}
const runs = [...latest.values()].sort((a, b) => a.info.project.localeCompare(b.info.project));

const newest = runs.map((r) => r.info.started).sort().at(-1)!;
const base = path.join('run-summary', `combined_${fileStamp(newest)}`);
const md = toCombinedMarkdown(runs);
fs.mkdirSync('run-summary', { recursive: true });
fs.writeFileSync(`${base}.md`, md);
fs.writeFileSync(`${base}.html`, toHtml(runs));

if (process.env.GITHUB_STEP_SUMMARY && runs.length > 1) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
const report = runs.map(toStatusReport).join('\n\n');
fs.writeFileSync(`${base}-report.txt`, report + '\n');
console.log(`Combined report (${runs.length} shop${runs.length === 1 ? '' : 's'}): ${base}.html\n\nStatus report (${REPORT_HINT}):\n\n${report}`);
