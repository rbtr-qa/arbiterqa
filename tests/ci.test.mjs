// `run` / `start` / `wait` against a local stub of the jobs API. The stub plays the server's
// documented shapes; the CLI runs as a real subprocess so exit codes, stdout, stderr and the
// files it writes are exactly what a CI runner sees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verdictFor, summaryMarkdown } from '../bin/ci.mjs';
import { KEY, job, pending, blockedByRequired, expiredWithRefund, scenario, outputs } from './helpers/stub.mjs';

// ── Pure verdict ─────────────────────────────────────────────────────────────

test('verdict: a failed job whose policy is clean passes (an optional check failed)', () => {
  const d = verdictFor(job({ status: 'failed' }));
  assert.equal(d.verdict, 'pass');
});

test('verdict: prohibited blocks and names the blocker', () => {
  const d = verdictFor(
    job({
      status: 'failed',
      validationSets: [
        { id: 's', validations: [], failuresBySeverity: { required: [], prohibited: ['tracking-pixel'] } },
      ],
      overallPassPolicy: { blockedByRequired: false, blockedByProhibited: true },
    })
  );
  assert.equal(d.verdict, 'blocked');
  assert.deepEqual(d.blocking, ['tracking-pixel']);
});

test('verdict: no pass policy is undecided, never a pass', () => {
  assert.equal(verdictFor(job({ overallPassPolicy: undefined })).verdict, 'undecided');
  assert.equal(verdictFor(expiredWithRefund).verdict, 'undecided');
  assert.equal(verdictFor(pending()).verdict, 'undecided');
});

test('summary leads with the verdict, the policy and the blockers', () => {
  const md = summaryMarkdown(blockedByRequired, verdictFor(blockedByRequired), 'https://x/jobs/job_123');
  const lines = md.split('\n');
  assert.match(lines[0], /ArbiterQA: blocked \(exit 1\)/);
  assert.match(md, /blockedByRequired: true/);
  assert.match(md, /\*\*Blocking:\*\* `logo-usage`/);
  assert.match(md, /\| `logo-usage` \| required \| fail \|/);
});

// ── End to end through the binary ────────────────────────────────────────────

test('run: pending then completed → exit 0, outputs and summary written', async () => {
  const r = await scenario({
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: pending() } }, { body: { job: job() } }],
  });
  assert.equal(r.code, 0, r.stderr);
  const o = outputs(r.w.output);
  assert.equal(o['job-id'], 'job_123');
  assert.equal(o.verdict, 'pass');
  assert.equal(o['credits-charged'], '4');
  assert.match(o['job-url'], /\/jobs\/job_123$/);
  assert.match(readFileSync(r.w.summary, 'utf8'), /ArbiterQA: pass/);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).jobId, 'job_123');
  assert.match(r.seen[0].ua, /^@rbtrqa\/cli\/\d+\.\d+\.\d+ \(ci\)$/);
  assert.equal(r.seen[0].auth, `Bearer ${KEY}`);
});

test('run: status failed with a clean policy → exit 0', async () => {
  const r = await scenario({
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: job({ status: 'failed' }) } }],
  });
  assert.equal(r.code, 0, r.stderr);
});

test('run: blocked by required → exit 1, blocker listed, only failed screenshots saved', async () => {
  const r = await scenario({
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: blockedByRequired } }],
  });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(outputs(r.w.output)['blocking-validations'], 'logo-usage');
  assert.match(r.stderr, /Blocking: logo-usage/);
  assert.deepEqual(readdirSync(r.w.evidence).sort(), ['job.json', 'logo-usage-desktop.png']);
  const shot = r.seen.find((x) => x.key.startsWith('GET /api/jobs/screenshots/'));
  assert.equal(shot.auth, `Bearer ${KEY}`);
});

test('run: blocked by prohibited → exit 1', async () => {
  const j = job({
    status: 'failed',
    validationSets: [{ id: 's', validations: [], failuresBySeverity: { prohibited: ['p'] } }],
    overallPassPolicy: { blockedByRequired: false, blockedByProhibited: true },
  });
  const r = await scenario({ 'POST /api/jobs': [{ body: pending() }], 'GET /api/jobs/job_123': [{ body: { job: j } }] });
  assert.equal(r.code, 1, r.stderr);
});

test('wait: expired with interruption → exit 2, refund shown, job.json still written', async () => {
  const r = await scenario(
    { 'GET /api/jobs/job_123': [{ body: { job: expiredWithRefund } }] },
    { args: ['wait', 'job_123'], withRequest: false }
  );
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /email_not_received/);
  assert.match(r.stderr, /refunded 6 credits/);
  assert.ok(existsSync(join(r.w.evidence, 'job.json')));
  assert.equal(outputs(r.w.output).verdict, 'undecided');
});

test('run: job expires while being polled → exit 2', async () => {
  const r = await scenario({
    'POST /api/jobs': [{ body: pending() }],
    'GET /api/jobs/job_123': [
      { body: { job: pending() } },
      { body: { job: pending() } },
      { body: { job: expiredWithRefund } },
    ],
  });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /expired/);
});

test('run: 402 at the door → exit 2 with the code and details, no polling', async () => {
  const r = await scenario({
    'POST /api/jobs': [
      {
        status: 402,
        body: {
          code: 'INSUFFICIENT_CREDITS',
          message: 'Not enough credits.',
          details: { balance: 1, required: 4, shortfall: 3 },
          request_id: 'req_9',
        },
      },
    ],
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /HTTP 402 INSUFFICIENT_CREDITS — Not enough credits\. \(request req_9\)/);
  assert.match(r.stderr, /"shortfall":3/);
  assert.equal(r.seen.filter((x) => x.key.startsWith('GET')).length, 0);
});

test('run: 503 then success on the POST is retried once, not duplicated', async () => {
  const r = await scenario({
    'POST /api/jobs': [{ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } }, { body: pending() }],
    'GET /api/jobs/job_123': [{ body: { job: job() } }],
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.seen.filter((x) => x.key === 'POST /api/jobs').length, 2);
});

test('run: a 500 that is not retryable is never re-POSTed', async () => {
  const r = await scenario({ 'POST /api/jobs': [{ status: 500, body: { code: 'INTERNAL_ERROR' } }] });
  assert.equal(r.code, 2);
  assert.equal(r.seen.filter((x) => x.key === 'POST /api/jobs').length, 1);
});

test('wait: missing pass policy → exit 2', async () => {
  const r = await scenario(
    { 'GET /api/jobs/job_123': [{ body: { job: job({ overallPassPolicy: undefined }) } }] },
    { args: ['wait', 'job_123'], withRequest: false }
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no pass policy/);
});

test('wait: timeout while pending → exit 2 and says the job refunds itself', async () => {
  const r = await scenario(
    { 'GET /api/jobs/job_123': [{ body: { job: pending() } }] },
    { args: ['wait', 'job_123'], withRequest: false, env: { ARBITER_WAIT_TIMEOUT_SECONDS: '0' } }
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Gave up waiting/);
  assert.match(r.stderr, /refunded/);
});

test('start: email job prints the address and writes test-email', async () => {
  const r = await scenario(
    {
      'POST /api/jobs': [
        {
          body: pending({
            validations: [{ type: 'email' }],
            emailCapture: { testEmail: 'abc123@capture.rbtr.qa', captureMode: 'dedicated', captureStatus: 'searching' },
          }),
        },
      ],
    },
    { args: ['start'] }
  );
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Send the email to: abc123@capture\.rbtr\.qa/);
  assert.equal(outputs(r.w.output)['test-email'], 'abc123@capture.rbtr.qa');
});

test('no key → exit 2 without calling the API', async () => {
  const r = await scenario({}, { env: { ARBITER_API_KEY: '', ARBITER_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'cfg-')) } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /No API key/);
  assert.equal(r.seen.length, 0);
});

test('the key never appears in stdout, stderr, outputs, summary or evidence', async () => {
  const runs = [
    await scenario({
      'POST /api/jobs': [{ body: pending() }],
      'GET /api/jobs/job_123': [{ body: { job: blockedByRequired } }],
    }),
    await scenario({ 'POST /api/jobs': [{ status: 402, body: { code: 'INSUFFICIENT_CREDITS' } }] }),
  ];
  for (const r of runs) {
    const files = [r.w.output, r.w.summary];
    if (existsSync(r.w.evidence)) files.push(...readdirSync(r.w.evidence).map((f) => join(r.w.evidence, f)));
    for (const text of [r.stdout, r.stderr, ...files.map((f) => readFileSync(f, 'utf8'))]) {
      assert.ok(!text.includes(KEY), 'API key leaked');
      assert.ok(!text.includes('SECRET_never'), 'API key fragment leaked');
    }
  }
});
