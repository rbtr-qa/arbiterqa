// Shared fixtures and a stub of the jobs API for the CLI and Action tests.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = join(ROOT, 'bin', 'arbiterqa.mjs');

export const KEY = 'aqa_test_SECRET_never_print_me_8d1f';
export const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

export function job(overrides = {}) {
  return {
    jobId: 'job_123',
    status: 'completed',
    validations: [{ type: 'url', url: 'https://example.com' }],
    results: [],
    skipped_validations: [],
    validationSets: [
      {
        id: 'default',
        validations: [{ validationId: 'logo-usage', severity: 'required', status: 'pass' }],
        failuresBySeverity: { required: [], recommended: [], optional: [], prohibited: [] },
      },
    ],
    overallPassPolicy: { blockedByRequired: false, blockedByProhibited: false },
    credits: { charged: 4, refunded: 0, net: 4 },
    ...overrides,
  };
}

export const pending = (o = {}) => ({
  jobId: 'job_123',
  status: 'pending',
  validations: [{ type: 'url', url: 'https://example.com' }],
  credits: { charged: 4, refunded: 0, net: 4 },
  ...o,
});

export const blockedByRequired = job({
  status: 'failed',
  results: [
    {
      validationId: 'logo-usage',
      status: 'fail',
      captureSizeId: 'desktop',
      screenshotUrl: 'SELF/api/jobs/screenshots/c/job_123/k',
    },
    { validationId: 'alt-text', status: 'pass', screenshotUrl: 'SELF/api/jobs/screenshots/c/job_123/k2' },
  ],
  validationSets: [
    {
      id: 'default',
      validations: [
        { validationId: 'logo-usage', severity: 'required', status: 'fail' },
        { validationId: 'alt-text', severity: 'recommended', status: 'pass' },
      ],
      failuresBySeverity: { required: ['logo-usage'], recommended: [], optional: [], prohibited: [] },
    },
  ],
  overallPassPolicy: { blockedByRequired: true, blockedByProhibited: false },
});

export const expiredWithRefund = {
  jobId: 'job_123',
  status: 'expired',
  validations: [{ type: 'email' }],
  results: [],
  interruption: {
    cause: 'email_not_received',
    message: 'No email arrived at the capture address.',
    affectedValidationIds: ['email-layout-not-broken'],
    refund: { settled: true, refundedCredits: 6 },
  },
  credits: { charged: 6, refunded: 6, net: 0 },
};

/**
 * Stub server. `script` maps "METHOD path" to a list of responses served in order (the last
 * one repeats): { status, body } or a function of the request.
 */
export async function stub(script) {
  const seen = [];
  const counters = {};
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      seen.push({ key, auth: req.headers.authorization, ua: req.headers['user-agent'], body: raw });
      const list = script[key] ?? (req.url.startsWith('/api/jobs/screenshots/') ? [{ png: true }] : null);
      if (!list) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: 'NOT_FOUND' }));
      }
      const i = Math.min(counters[key] ?? 0, list.length - 1);
      counters[key] = (counters[key] ?? 0) + 1;
      const r = list[i];
      if (r.png) {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      }
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body).replaceAll('SELF', `http://127.0.0.1:${server.address().port}`));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

export function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        PATH: process.env.PATH,
        ARBITER_POLL_INTERVAL_MS: '10',
        ARBITER_RETRY_BASE_MS: '5',
        ARBITER_NO_BROWSER: '1',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-ci-'));
  const request = join(dir, 'request.json');
  writeFileSync(request, JSON.stringify({ type: 'url', url: 'https://example.com', validations: ['logo-usage'] }));
  const output = join(dir, 'gh-output');
  const summary = join(dir, 'gh-summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  return { dir, request, output, summary, evidence: join(dir, 'evidence') };
}

export function outputs(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
}

export async function scenario(script, { args = ['run'], env = {}, withRequest = true } = {}) {
  const s = await stub(script);
  const w = workspace();
  const r = await runCli(withRequest ? [...args, w.request] : args, {
    ARBITER_API_URL: s.base,
    ARBITER_API_KEY: KEY,
    GITHUB_OUTPUT: w.output,
    GITHUB_STEP_SUMMARY: w.summary,
    ARBITER_EVIDENCE_DIR: w.evidence,
    ...env,
  });
  s.close();
  return { ...r, w, seen: s.seen };
}

