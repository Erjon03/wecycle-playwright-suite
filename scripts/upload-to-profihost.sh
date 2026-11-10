#!/usr/bin/env bash
# Uploads qa-report/summary.json (+ results.json if present) to Profihost via SFTP for the central QA report:
#   qa-reports/<project>/<environment>/<YYYY-MM-DD>/<HHMMSS>/
# Date and time are taken from summary.json's "timestamp" (UTC), so the folder and the JSON always agree.
#
# Env (GitHub secrets): PROFIHOST_HOST, PROFIHOST_USER, PROFIHOST_SSH_KEY (ed25519 private key),
#   PROFIHOST_KNOWN_HOSTS (output of ssh-keyscan [-p <port>] <host>), optional PROFIHOST_PORT (default 22).
#
# Exit codes: 0 = uploaded, or skipped because PROFIHOST_HOST is not set (notice);
#             1 = upload failed (::warning:: annotation; the workflow step uses continue-on-error).
# Uses `sftp -b` only (no ssh commands), because the account may be SFTP-only. Secrets are never echoed.

set -uo pipefail

REPORT_DIR="${QA_REPORT_DIR:-qa-report}"
SUMMARY="$REPORT_DIR/summary.json"
RESULTS="$REPORT_DIR/results.json"
STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail() {
  echo "::warning title=Profihost upload failed::$1"
  echo "- **Profihost upload: FAILED** ($1)" >>"$STEP_SUMMARY"
  exit 1
}

if [ -z "${PROFIHOST_HOST:-}" ]; then
  echo "::notice title=Profihost upload skipped::secret PROFIHOST_HOST is not set, nothing uploaded"
  echo "- Profihost upload: skipped (secret \`PROFIHOST_HOST\` not set)" >>"$STEP_SUMMARY"
  exit 0
fi

missing=()
[ -n "${PROFIHOST_USER:-}" ] || missing+=(PROFIHOST_USER)
[ -n "${PROFIHOST_SSH_KEY:-}" ] || missing+=(PROFIHOST_SSH_KEY)
[ -n "${PROFIHOST_KNOWN_HOSTS:-}" ] || missing+=(PROFIHOST_KNOWN_HOSTS)
[ ${#missing[@]} -eq 0 ] || fail "PROFIHOST_HOST is set but secret(s) missing: ${missing[*]}"

PORT="${PROFIHOST_PORT:-22}"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "PROFIHOST_PORT must be a number"

[ -f "$SUMMARY" ] || fail "$SUMMARY not found (did the summary step run?)"

# project, environment, date, time, status and counts from summary.json (one value per line)
if ! meta="$(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/.exec(s.timestamp || "");
  if (!m) throw new Error("timestamp is not ISO 8601 UTC: " + s.timestamp);
  for (const k of ["project", "environment"]) if (!/^[a-z0-9-]+$/.test(s[k] || "")) throw new Error(k + " is not a valid slug");
  console.log([s.project, s.environment, m[1], m[2] + m[3] + m[4], s.status,
    `passed ${s.passed}, failed ${s.failed}, flaky ${s.flaky}, skipped ${s.skipped}, total ${s.total}`].join("\n"));
' "$SUMMARY" 2>&1)"; then
  fail "cannot read $SUMMARY: $(echo "$meta" | grep -m1 Error)"
fi
{ read -r project; read -r environment; read -r day; read -r time; read -r status; read -r counts; } <<<"$meta"

DEST="qa-reports/$project/$environment/$day/$time"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT # key, known_hosts and batch file are deleted in every case
umask 077
printf '%s\n' "$PROFIHOST_SSH_KEY" >"$tmp/key"
chmod 600 "$tmp/key"
printf '%s\n' "$PROFIHOST_KNOWN_HOSTS" >"$tmp/known_hosts"

{
  # leading "-": ignore "already exists"
  dir=""
  for part in qa-reports "$project" "$environment" "$day" "$time"; do
    dir="${dir:+$dir/}$part"
    echo "-mkdir $dir"
  done
  echo "put $SUMMARY $DEST/summary.json"
  if [ -f "$RESULTS" ]; then echo "put $RESULTS $DEST/results.json"; fi
} >"$tmp/batch"

[ -f "$RESULTS" ] || echo "::notice::$RESULTS not found, uploading summary.json only"

if ! sftp -b "$tmp/batch" -P "$PORT" -i "$tmp/key" \
  -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/known_hosts" \
  -o ConnectTimeout=30 \
  "$PROFIHOST_USER@$PROFIHOST_HOST"; then
  fail "sftp exited with an error"
fi

echo "Uploaded to $DEST/"
echo "- Profihost upload: OK → \`$DEST/\` · tests **$status** ($counts)" >>"$STEP_SUMMARY"
