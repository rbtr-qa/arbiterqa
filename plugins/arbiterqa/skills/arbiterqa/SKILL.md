---
name: arbiterqa
description: >
  QA webpages, HTML and emails with ArbiterQA: a pass, fail or error verdict per
  check, with evidence. Use when the user asks to QA, validate or audit a URL,
  landing page, HTML or email before shipping.
---

# ArbiterQA

ArbiterQA is a headless QA agent for **webpages and emails**. You send a subject,
pick validations (or a Validation Set), and get back **pass / fail / error**
per check — with evidence. Prefer the **MCP server**; use HTTP only when MCP is
unavailable.

## Connect

| Where you are | Endpoint | Sign-in |
| --- | --- | --- |
| Claude (claude.ai, Desktop, mobile) | Connector `https://api.arbiterqa.com/mcp/claude` | Claude runs ArbiterQA sign-in |
| Claude Code | Plugin: `/plugin marketplace add rbtr-qa/arbiterqa`, then `/plugin install arbiterqa@arbiterqa` | Sign-in on first tool call |
| Cursor, CI, other MCP hosts | `https://api.arbiterqa.com/mcp` | `Authorization: Bearer <key>` |
| Plain HTTP | `https://api.arbiterqa.com` | `Authorization: Bearer <key>` |

Both MCP endpoints serve the same tools. On `/mcp` the discovery tools and
`create_account` need **no key**; `/mcp/claude` asks for sign-in before anything.

Get a key for header use:

```sh
npx @rbtrqa/cli login        # browser device flow; creates account if needed
npx @rbtrqa/cli print-key    # emit the stored API key
```

**No browser available?** Sign yourself up: MCP `create_account` (public on `/mcp`), or
`POST /api/signup` with `{ "email": "you@example.com" }` → `{ apiKey, keyId,
customerId, orgCode, email }`. Same free account a human gets. **Store `apiKey`
immediately — it is shown once.** Use an address your user controls: signing in
with it later claims the account. An address that already has one is refused
(`ACCOUNT_EXISTS`) — sign in and mint a key instead.

Never commit a key.

## Tools

| Tool | Auth on `/mcp` | Use for |
| --- | --- | --- |
| `search_validations`, `list_validations`, `get_validation` | no | Discover checks |
| `recommend_checks`, `compare_checks`, `list_validation_sets`, `get_validation_set` | no | Choose a set |
| `describe_job_request`, `check_job_request`, `explain_error` | no | Shape / debug requests |
| `create_account` | no | Get a key with no browser (shown once) |
| `estimate_job`, `run_job`, `get_job`, `await_job` | Bearer | Quote and execute |
| `fetch_capture`, `list_email_clients` | Bearer / mixed | Artifacts & clients |
| `get_credits`, `list_keys`, `get_org` | Bearer | Account |

Do **not** invent HTTP when these tools exist. Act on structured fields:
`results`, `validationSets`, `skipped_validations`, and (with `detail=verbose`)
`results[].references` / `results[].note`. Do not expect a generated markdown
repair brief — agents act on those structured fields only.

## Invariants agents get wrong

1. **One subject per job.** A second subject is `400 JOB_ACCEPTS_ONE_SUBJECT`. Batch = N jobs.
2. **Credits.** With billing on, the quote is charged before work; undelivered work is refunded. `402 INSUFFICIENT_CREDITS` means top up — do not retry the same body hoping it becomes free.
3. **Every job is async.** `run_job` (and `POST /api/jobs`) returns the job `pending` at once, for every subject; call `await_job` (or poll `get_job`) until it is `completed`, `failed` or `expired`. A webpage job takes about a minute. An email job also returns `emailCapture.testEmail` — the human sends one message there first. `expired` = nothing ran, charge refunded. Any ended job may carry `interruption` — a capture that did not arrive or a run that stopped: `cause` says why, `affectedValidationIds` names the checks it cost (refunded). `subject_unreachable` means the page itself would not load — fix the URL or the page, not the check.
4. **Unified request shape only.** Top-level `type` (`url` | `static_html` | `email`). Legacy line-array bodies are refused (`LEGACY_REQUEST_SHAPE`). See `references/api.md`.
5. **Skipped ≠ failed.** Plan trims, a Custom-only parameter you did not supply, and a mail client that gave a check nothing to examine appear in `skipped_validations`; they are not ERROR rows. Plan trims and missing values are never charged; a check the mail client gave nothing to examine is refunded.
6. **A check declares where it can run.** Each catalog entry's `capture.offered` lists the viewports (and, where restricted, the surfaces) it is able to judge — an empty one means it reads the message source and renders nothing. Send `validations[].capture` to choose within that; outside it is `400 CAPTURE_PROHIBITED_HERE`, which is a fact about the check and not a plan limit, so do not answer it by suggesting an upgrade.

## Typical flow

1. Discover: `search_validations` / `recommend_checks` (or `list_validation_sets` / `get_validation_set`). Jobs name `validations[]` and/or `validationSetId`.
2. `estimate_job` with the same body you will run.
3. `run_job`, then `await_job` with its `jobId`. For email, tell the user the `testEmail` first.
4. Summarize from `results` / `validationSets`; cite fail `references` when present.

## HTTP fallback

Base URL: `https://api.arbiterqa.com`. Full shapes: `references/api.md`.
Front door: `https://api.arbiterqa.com/llms.txt`.
