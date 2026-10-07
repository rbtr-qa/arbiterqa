// The composite action's shell steps, run with bash the way a runner runs them: same env
// names, GITHUB_ACTION_PATH at the repo root, GITHUB_OUTPUT a file. The `run:` blocks
// contain no ${{ }} expressions (inputs arrive through `env:`), so they run verbatim here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, KEY, job, pending, blockedByRequired, expiredWithRefund, stub, workspace, outputs } from './helpers/stub.mjs';

const ACTION = readFileSync(join(ROOT, 'action.yml'), 'utf8');

/** The literal `run: |` body of the step with this id. */
function stepScript(id) {
  const at = ACTION.indexOf(`- id: ${id}\n`);
  assert.ok(at >= 0, `step ${id} not found`);
  const body = ACTION.slice(ACTION.indexOf('run: |\n', at) + 'run: |\n'.length);
  const lines = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '') {
      lines.push('');
      continue;
    }
    if (!line.startsWith('        ')) break;
    lines.push(line.slice(8));
  }
  return lines.join('\n');
}

test('run blocks carry no ${{ }} expressions (inputs only through env)', () => {
  for (const id of ['guard', 'gate']) assert.ok(!stepScript(id).includes('${{'), id);
});

function bash(script, env) {
  return new Promise((resolve) => {
    // Exactly how the runner invokes a composite step's `shell: bash`.
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { env: { PATH: process.env.PATH, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function gate(script, inputs = {}) {
  const s = await stub(script);
  const w = workspace();
  const r = await bash(stepScript('gate'), {
    GITHUB_ACTION_PATH: ROOT,
    GITHUB_OUTPUT: w.output,
    GITHUB_STEP_SUMMARY: w.summary,
    RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'runner-')),
    ARBITER_API_KEY: KEY,
    ARBITER_API_URL: s.base,
    ARBITER_WAIT_TIMEOUT_SECONDS: '1920',
    ARBITER_EVIDENCE_DIR: w.evidence,
    ARBITER_NO_BROWSER: '1',
    ARBITER_POLL_INTERVAL_MS: '10',
    ARBITER_RETRY_BASE_MS: '5',
    REQUEST: w.request,
    SEND: '',
    FAIL_ON_UNDECIDED: 'true',
    ...inputs,
  });
  s.close();
  return { ...r, w, seen: s.seen };
}

const passing = {
  'POST /api/jobs': [{ body: pending() }],
  'GET /api/jobs/job_123': [{ body: { job: job() } }],
};

test('guard: empty key skips with a notice', async () => {
  const w = workspace();
  const r = await bash(stepScript('guard'), { ARBITER_API_KEY: '', GITHUB_OUTPUT: w.output });
  assert.equal(r.code, 0);
  assert.match(r.out, /::notice title=ArbiterQA skipped::/);
  assert.equal(outputs(w.output).skip, 'true');
});

test('guard: a key is masked and the gate proceeds', async () => {
  const w = workspace();
  const r = await bash(stepScript('guard'), { ARBITER_API_KEY: KEY, GITHUB_OUTPUT: w.output });
  assert.equal(r.code, 0);
  assert.match(r.out, /::add-mask::/);
  assert.equal(outputs(w.output).skip, 'false');
});

test('gate: pass → step succeeds with outputs', async () => {
  const r = await gate(passing);
  assert.equal(r.code, 0, r.out);
  const o = outputs(r.w.output);
  assert.equal(o.verdict, 'pass');
  assert.equal(o['job-id'], 'job_123');
});

test('gate: blocked → step fails with an error annotation', async () => {
  const r = await gate({
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: blockedByRequired } }],
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=ArbiterQA blocked::/);
  assert.equal(outputs(r.w.output)['blocking-validations'], 'logo-usage');
});

test('gate: undecided fails by default and warns when fail-on-undecided is false', async () => {
  const script = {
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: expiredWithRefund } }],
  };
  const strict = await gate(script);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /::error title=ArbiterQA undecided::/);
  const lenient = await gate(script, { FAIL_ON_UNDECIDED: 'false' });
  assert.equal(lenient.code, 0);
  assert.match(lenient.out, /::warning title=ArbiterQA undecided::/);
});

test('gate: a refused request is undecided', async () => {
  const r = await gate({ 'POST /api/jobs': [{ status: 400, body: { code: 'VALIDATION_NOT_RUNNABLE' } }] });
  assert.equal(r.code, 1);
  assert.match(r.out, /VALIDATION_NOT_RUNNABLE/);
  assert.equal(outputs(r.w.output).verdict, 'undecided');
});

const emailJob = pending({
  validations: [{ type: 'email' }],
  emailCapture: { testEmail: 'abc123@capture.rbtr.qa', captureMode: 'dedicated' },
});

test('gate: send gets the address and job id, then the job is awaited', async () => {
  const sentTo = join(mkdtempSync(join(tmpdir(), 'sent-')), 'sent');
  const r = await gate(
    { 'POST /api/jobs': [{ body: emailJob }], 'GET /api/jobs/job_123': [{ body: { job: job() } }] },
    { SEND: `echo "$ARBITER_TEST_EMAIL $ARBITER_JOB_ID" > ${sentTo}` }
  );
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(sentTo, 'utf8').trim(), 'abc123@capture.rbtr.qa job_123');
  assert.equal(outputs(r.w.output)['test-email'], 'abc123@capture.rbtr.qa');
});

test('gate: a failed send fails the step and never waits, even when undecided only warns', async () => {
  const r = await gate(
    { 'POST /api/jobs': [{ body: emailJob }], 'GET /api/jobs/job_123': [{ body: { job: job() } }] },
    { SEND: 'echo smtp down >&2; exit 7', FAIL_ON_UNDECIDED: 'false' }
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=ArbiterQA send failed::/);
  assert.match(r.out, /not an ArbiterQA verdict/);
  assert.equal(r.seen.filter((x) => x.key.startsWith('GET')).length, 0);
  assert.equal(outputs(r.w.output).verdict, undefined);
});

test('gate: the key never reaches the log', async () => {
  const r = await gate(passing);
  assert.ok(!r.out.includes(KEY));
});
