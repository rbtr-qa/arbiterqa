/**
 * `start`, `wait` and `run` — submit one ArbiterQA job, wait for it, and turn the answer into
 * an exit code a CI system can gate on.
 *
 *   npx @rbtrqa/cli start request.json   POST /api/jobs, print the pending job
 *   npx @rbtrqa/cli wait <jobId>         poll until the job ends, then decide
 *   npx @rbtrqa/cli run request.json     start, then wait
 *
 * Exit codes (the whole contract):
 *   0  pass       the job finished and nothing required or prohibited failed
 *   1  blocked    a required check failed, or a prohibited one was found
 *   2  undecided  no verdict: the request was refused, the job expired, the wait timed out,
 *                 or the service could not be reached
 *
 * `status: "failed"` on its own is NOT exit 1. The server marks a job failed when any check
 * fails at any severity — one optional check is enough — so the gate reads
 * `overallPassPolicy`, which is the severity-aware answer.
 *
 * Reports, only when the environment asks for them:
 *   GITHUB_OUTPUT         job-id, job-url, test-email (start); verdict, credits, blockers (wait)
 *   GITHUB_STEP_SUMMARY   a markdown verdict (wait)
 *   ARBITER_EVIDENCE_DIR  job.json always, plus a PNG per failed or errored render (wait)
 *
 * The API key is read here and sent as a header. It is never printed and never written.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const EXIT = { pass: 0, blocked: 1, undecided: 2 };

/** The server ticks a pending job at most once every 5s, so polling faster buys nothing. */
const DEFAULT_POLL_MS = 5000;
/** Past the server's 30-minute expiry, so an abandoned job is seen ending rather than timed out. */
const DEFAULT_WAIT_SECONDS = 1920;
const PROGRESS_EVERY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 5;

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** stdout to a pipe is asynchronous; the caller exits right after, so wait for the flush. */
const emit = (job) => new Promise((r) => process.stdout.write(JSON.stringify(job) + '\n', r));

/** A refusal or failure the caller can print. `undecided` is always the exit it maps to. */
class CiError extends Error {
  constructor(message, body) {
    super(message);
    this.body = body;
  }
}

function describeError(status, body) {
  const code = body?.code ? ` ${body.code}` : '';
  const text = body?.message || body?.developerMessage || body?.error || '';
  const req = body?.request_id ? ` (request ${body.request_id})` : '';
  return `HTTP ${status}${code}${text ? ` — ${text}` : ''}${req}`;
}

/**
 * Retry policy. GETs are safe to repeat on any 5xx or network failure. A POST that creates a
 * job is repeated only when the server says nothing happened (503 SERVICE_UNAVAILABLE, or a
 * retryable JOB_EXECUTION_FAILED) or the connection never opened — a timeout mid-POST may
 * have created a charged job, and a blind retry would create a second one.
 */
function shouldRetry({ method, status, body, error }) {
  if (error) {
    if (method === 'GET') return true;
    return error.cause?.code === 'ECONNREFUSED' || error.code === 'ECONNREFUSED';
  }
  if (status === 503) return true;
  if (status === 500 && body?.code === 'JOB_EXECUTION_FAILED' && body?.details?.retryable) return true;
  return method === 'GET' && status >= 500;
}

export function makeApi({ base, apiKey, version }) {
  const retryBase = envInt('ARBITER_RETRY_BASE_MS', 1000);
  return async function api(method, path, body) {
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res;
      let parsed;
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': `@rbtrqa/cli/${version} (ci)`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        parsed = await res.json().catch(() => ({}));
      } catch (error) {
        last = new CiError(`${method} ${path} could not reach ${base}: ${error.cause?.code || error.message}`);
        if (attempt < MAX_ATTEMPTS && shouldRetry({ method, error })) {
          await sleep(retryBase * 2 ** (attempt - 1));
          continue;
        }
        if (method !== 'GET') {
          last.message += '\n  The job may or may not have been created — check the console before re-running.';
        }
        throw last;
      }
      if (res.ok) return parsed;
      last = new CiError(describeError(res.status, parsed), parsed);
      last.status = res.status;
      if (attempt < MAX_ATTEMPTS && shouldRetry({ method, status: res.status, body: parsed })) {
        await sleep(retryBase * 2 ** (attempt - 1));
        continue;
      }
      throw last;
    }
    throw last;
  };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

function uniq(xs) {
  return [...new Set(xs)];
}

/** The one decision. Pure: a job in, `{ verdict, reason, blocking }` out. */
export function verdictFor(job) {
  if (!job || job.status === 'pending') {
    return { verdict: 'undecided', reason: 'the job is still pending', blocking: [] };
  }
  if (job.status === 'expired') {
    return { verdict: 'undecided', reason: 'the job expired before anything ran', blocking: [] };
  }
  const policy = job.overallPassPolicy;
  if (!policy || typeof policy !== 'object') {
    return { verdict: 'undecided', reason: 'the job has no pass policy to decide on', blocking: [] };
  }
  const sets = Array.isArray(job.validationSets) ? job.validationSets : [];
  const blocking = uniq(
    sets.flatMap((s) => [...(s.failuresBySeverity?.required ?? []), ...(s.failuresBySeverity?.prohibited ?? [])])
  );
  if (policy.blockedByRequired || policy.blockedByProhibited) {
    const why = [policy.blockedByRequired && 'required', policy.blockedByProhibited && 'prohibited']
      .filter(Boolean)
      .join(' and ');
    return { verdict: 'blocked', reason: `${why} checks failed`, blocking };
  }
  return { verdict: 'pass', reason: 'no required or prohibited check failed', blocking: [] };
}

// ── Reports ──────────────────────────────────────────────────────────────────

function cell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function subjectOf(job) {
  const line = job.validations?.[0] ?? {};
  if (line.type === 'static_html') return `static HTML (base ${line.url || 'unknown'})`;
  if (line.url) return line.url;
  if (line.type === 'email' || job.emailCapture) return 'email';
  return line.type || 'subject';
}

export function summaryMarkdown(job, decision, jobUrl) {
  const icon = { pass: '✅', blocked: '❌', undecided: '⚠️' }[decision.verdict];
  const out = [];
  out.push(`## ${icon} ArbiterQA: ${decision.verdict} (exit ${EXIT[decision.verdict]})`, '');
  out.push(decision.reason.charAt(0).toUpperCase() + decision.reason.slice(1) + '.', '');
  if (job.overallPassPolicy) {
    out.push(
      `Pass policy: \`blockedByRequired: ${!!job.overallPassPolicy.blockedByRequired}\` · ` +
        `\`blockedByProhibited: ${!!job.overallPassPolicy.blockedByProhibited}\``,
      ''
    );
  }
  if (decision.blocking.length) {
    out.push(`**Blocking:** ${decision.blocking.map((id) => `\`${id}\``).join(', ')}`, '');
  }
  out.push(`Subject: ${cell(subjectOf(job))} · status \`${job.status}\``);
  if (job.credits) {
    out.push(
      `Credits: charged ${job.credits.charged ?? 0}, refunded ${job.credits.refunded ?? 0}, net ${job.credits.net ?? 0}`
    );
  }
  out.push('');
  for (const set of job.validationSets ?? []) {
    out.push(`### ${cell(set.name || set.id)}`, '', '| Validation | Severity | Status |', '|---|---|---|');
    for (const v of set.validations ?? []) {
      out.push(`| \`${cell(v.validationId)}\` | ${cell(v.severity)} | ${cell(v.status)} |`);
    }
    out.push('');
  }
  const skipped = job.skipped_validations ?? [];
  if (skipped.length) {
    out.push('### Skipped (not blocking)', '');
    for (const s of skipped) out.push(`- \`${cell(s.validationId)}\` — ${cell(s.reasonCode)}`);
    out.push('');
  }
  if (job.interruption) {
    const refund = job.interruption.refund?.refundedCredits;
    out.push(
      `**Interrupted:** \`${cell(job.interruption.cause)}\` — ${cell(job.interruption.message)}` +
        (refund != null ? ` (refunded ${refund} credits)` : ''),
      ''
    );
  }
  out.push(`[Open the job](${jobUrl})`, '');
  return out.join('\n');
}

function writeOutputs(values) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  const lines = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`);
  if (lines.length) appendFileSync(path, lines.join('\n') + '\n');
}

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}

async function writeEvidence(job, { apiKey, version }) {
  const dirEnv = process.env.ARBITER_EVIDENCE_DIR;
  if (!dirEnv) return;
  const dir = resolve(dirEnv);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job, null, 2) + '\n');
  const used = new Set();
  for (const row of job.results ?? []) {
    if (row.status === 'pass' || !row.screenshotUrl) continue;
    let name = safeName(`${row.validationId}-${row.captureSizeId || row.captureClientId || 'page'}`);
    for (let i = 2; used.has(name); i++) name = safeName(`${row.validationId}-${row.captureSizeId || 'page'}-${i}`);
    used.add(name);
    try {
      const res = await fetch(row.screenshotUrl, {
        headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': `@rbtrqa/cli/${version} (ci)` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`  ⚠ screenshot for ${row.validationId}: HTTP ${res.status}`);
        continue;
      }
      writeFileSync(join(dir, `${name}.png`), Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      console.error(`  ⚠ screenshot for ${row.validationId}: ${e.message}`);
    }
  }
  console.error(`  Evidence → ${dir}`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function jobUrlFor(base, jobId) {
  return `${base}/jobs/${encodeURIComponent(jobId)}`;
}

function readRequest(path) {
  if (!path) throw new CiError('Pass the job request file: npx @rbtrqa/cli start request.json');
  let text;
  try {
    text = readFileSync(resolve(path), 'utf8');
  } catch (e) {
    throw new CiError(`Cannot read ${path}: ${e.code || e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CiError(`${path} is not valid JSON: ${e.message}`);
  }
}

function announceCapture(job) {
  const cap = job.emailCapture;
  if (!cap) return;
  const address = cap.testEmail || cap.universalEmail;
  if (address) console.error(`  Send the email to: ${address}`);
  if (cap.captureMode === 'universal' && cap.source) {
    console.error(`  Matching: ${JSON.stringify(cap.source)}`);
  }
  if (cap.expiresAt) console.error(`  Address expires ${cap.expiresAt}`);
}

async function start(ctx, requestPath) {
  const body = readRequest(requestPath);
  const job = await ctx.api('POST', '/api/jobs', body);
  const jobId = job.jobId;
  if (!jobId) throw new CiError('The server accepted the request but returned no jobId.');
  const url = jobUrlFor(ctx.base, jobId);
  console.error(`✓ Job ${jobId} started (${job.status})`);
  if (job.credits?.charged != null) console.error(`  Charged ${job.credits.charged} credits`);
  console.error(`  ${url}`);
  announceCapture(job);
  writeOutputs({
    'job-id': jobId,
    'job-url': url,
    'test-email': job.emailCapture?.testEmail || job.emailCapture?.universalEmail,
  });
  return job;
}

function progressLine(job, elapsedMs, deadlineMs) {
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  const parts = [`${job.status}`, `${s(elapsedMs)} elapsed`, `${s(Math.max(0, deadlineMs - elapsedMs))} left`];
  const cap = job.emailCapture;
  if (cap?.captureStatus) parts.push(`capture ${cap.captureStatus}`);
  if (cap?.captureStatus === 'searching') parts.push('no email received yet');
  // The ETA counts from the message's arrival, so it means nothing while still searching.
  else if (cap?.estimatedWaitSeconds != null && cap?.etaObservedAt) {
    const left = cap.estimatedWaitSeconds - (Date.now() - Date.parse(cap.etaObservedAt)) / 1000;
    if (Number.isFinite(left)) parts.push(`ETA ~${Math.max(0, Math.round(left))}s`);
  }
  return `  … ${parts.join(' · ')}`;
}

async function wait(ctx, jobId) {
  if (!jobId) throw new CiError('Pass the job id: npx @rbtrqa/cli wait <jobId>');
  const pollMs = envInt('ARBITER_POLL_INTERVAL_MS', DEFAULT_POLL_MS);
  const deadlineMs = envInt('ARBITER_WAIT_TIMEOUT_SECONDS', DEFAULT_WAIT_SECONDS) * 1000;
  const startedAt = Date.now();
  let lastProgress = startedAt;
  let job;
  for (;;) {
    const res = await ctx.api('GET', `/api/jobs/${encodeURIComponent(jobId)}`);
    job = res.job ?? res;
    if (job.status !== 'pending') break;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= deadlineMs) {
      console.error(
        `✗ Gave up waiting after ${Math.round(elapsed / 1000)}s; job ${jobId} is still pending. ` +
          'It expires on its own and the charge is refunded.'
      );
      break;
    }
    if (Date.now() - lastProgress >= PROGRESS_EVERY_MS) {
      console.error(progressLine(job, elapsed, deadlineMs));
      lastProgress = Date.now();
    }
    await sleep(Math.min(pollMs, Math.max(0, deadlineMs - elapsed)));
  }
  return finish(ctx, job);
}

async function finish(ctx, job) {
  const decision = verdictFor(job);
  const url = jobUrlFor(ctx.base, job.jobId);
  const mark = { pass: '✓', blocked: '✗', undecided: '⚠' }[decision.verdict];
  console.error(`${mark} ${decision.verdict}: ${decision.reason}`);
  if (decision.blocking.length) console.error(`  Blocking: ${decision.blocking.join(', ')}`);
  for (const s of job.skipped_validations ?? []) {
    console.error(`  Skipped ${s.validationId}: ${s.reasonCode}`);
  }
  if (job.interruption) {
    const refund = job.interruption.refund?.refundedCredits;
    console.error(
      `  Interrupted (${job.interruption.cause}): ${job.interruption.message}` +
        (refund != null ? ` — refunded ${refund} credits` : '')
    );
  }
  if (job.credits) {
    console.error(`  Credits: charged ${job.credits.charged ?? 0}, refunded ${job.credits.refunded ?? 0}`);
  }
  console.error(`  ${url}`);

  await emit(job);
  writeOutputs({
    verdict: decision.verdict,
    'job-id': job.jobId,
    'job-url': url,
    'credits-charged': job.credits?.charged ?? 0,
    'credits-refunded': job.credits?.refunded ?? 0,
    'blocking-validations': decision.blocking.join(','),
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(job, decision, url));
  }
  await writeEvidence(job, ctx);
  return EXIT[decision.verdict];
}

/** Entry point from bin/arbiterqa.mjs. Resolves to the process exit code. */
export async function runCi(command, args, { base, apiKey, version }) {
  if (!apiKey) {
    console.error('✗ No API key. Set ARBITER_API_KEY (in CI: a repository secret), or run: npx @rbtrqa/cli login');
    return EXIT.undecided;
  }
  const ctx = { base, apiKey, version, api: makeApi({ base, apiKey, version }) };
  try {
    if (command === 'start') {
      await emit(await start(ctx, args[0]));
      return 0;
    }
    if (command === 'wait') return await wait(ctx, args[0]);
    if (command === 'run') {
      const job = await start(ctx, args[0]);
      return await wait(ctx, job.jobId);
    }
    throw new CiError(`Unknown command: ${command}`);
  } catch (e) {
    if (!(e instanceof CiError)) throw e;
    console.error(`✗ ${e.message}`);
    const d = e.body?.details;
    if (d && typeof d === 'object') console.error(`  details: ${JSON.stringify(d)}`);
    writeOutputs({ verdict: command === 'start' ? undefined : 'undecided' });
    return EXIT.undecided;
  }
}
