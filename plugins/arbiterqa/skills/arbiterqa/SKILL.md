---
name: arbiterqa
description: >
  Run ArbiterQA quality checks on webpages and emails. Prefer MCP tools at
  https://api.arbiterqa.com/mcp. Use when the user asks to QA, validate, or
  audit a URL, landing page, HTML, or email before shipping.
---

# ArbiterQA

ArbiterQA is a headless QA agent for **webpages and emails**. You send a subject,
pick validations (or a curated email standard), and get back **pass / fail / error**
per check — with evidence. Prefer the **MCP server**; use HTTP only when MCP is
unavailable.

## Authentication

```sh
npx arbiterqa login        # browser sign-in; creates account if needed
npx arbiterqa print-key    # emit the stored API key
```

**No browser available?** Sign yourself up: MCP `create_account` (public), or
`POST /api/signup` with `{ "email": "you@example.com" }` → `{ apiKey, keyId,
customerId, orgCode, email }`. Same free account a human gets. **Store `apiKey`
immediately — it is shown once.** Use an address your user controls: signing in
with it later claims the account. An address that already has one is refused
(`ACCOUNT_EXISTS`) — sign in and mint a key instead.

MCP and HTTP both use `Authorization: Bearer <key>` for estimate / run / account /
feedback tools. Discovery tools on MCP need **no key**.

Never commit the key. Claude Code plugin users set it via the plugin enable prompt
(`userConfig.api_key`).

## Prefer MCP

Endpoint: `https://api.arbiterqa.com/mcp` (streamable HTTP).

Protected-resource metadata:
`https://api.arbiterqa.com/.well-known/oauth-protected-resource/mcp`

| Tool | Auth | Use for |
| --- | --- | --- |
| `search_validations`, `list_validations`, `get_validation` | no | Discover checks |
| `recommend_checks`, `compare_checks`, `list_validation_standards` | no | Choose a set |
| `describe_job_request`, `check_job_request`, `explain_error` | no | Shape / debug requests |
| `create_account` | no | Get a key with no browser (shown once) |
| `estimate_job`, `run_job`, `get_job`, `await_email_job` | Bearer | Quote and execute |
| `fetch_capture`, `list_email_clients` | Bearer / mixed | Artifacts & clients |
| `get_credits`, `list_keys`, `get_org` | Bearer | Account |
| `list_feedback_due`, `list_feedback_questions`, `submit_feedback_answers` | Bearer | Customer feedback |

Do **not** invent HTTP when these tools exist. Act on structured fields:
`results`, `validationSets`, `skipped_validations`, and (with `detail=verbose`)
`results[].references` / `results[].note`. Do not expect a generated markdown
repair brief — agents act on those structured fields only.

## Invariants agents get wrong

1. **One subject per job.** A second subject is `400 JOB_ACCEPTS_ONE_SUBJECT`. Batch = N jobs.
2. **Credits.** With billing on, the quote is charged before work; undelivered work is refunded. `402 INSUFFICIENT_CREDITS` means top up — do not retry the same body hoping it becomes free.
3. **Email is async.** `run_job` returns `pending` + `testEmail`; the human sends mail there; poll with `await_email_job` / `get_job`. URL and `static_html` jobs are synchronous.
4. **Unified request shape only.** Top-level `type` (`url` | `static_html` | `email`). Legacy line-array bodies are refused (`LEGACY_REQUEST_SHAPE`). See `references/api.md`.
5. **Skipped ≠ failed.** Registry gaps and plan trims appear in `skipped_validations`; they are not ERROR rows.

## Typical flow

1. Discover: `search_validations` / `recommend_checks` (or `list_validation_standards` for email).
2. `estimate_job` with the same body you will run.
3. `run_job`. For email, tell the user the `testEmail` and await completion.
4. Summarize from `results` / `validationSets`; cite fail `references` when present.
5. Offer feedback tools only when due — do not invent verdicts for the customer.

## HTTP fallback

Base URL: `https://api.arbiterqa.com`. Full shapes: `references/api.md`.
Front door: `https://api.arbiterqa.com/llms.txt`.
