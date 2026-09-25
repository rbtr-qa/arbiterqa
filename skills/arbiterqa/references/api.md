# ArbiterQA HTTP API (fallback)

Use this when MCP is unavailable. Prefer MCP tools when the host supports them.

**Base URL:** `https://api.arbiterqa.com`  
**Auth:** `Authorization: Bearer <key>` from `npx @rbtrqa/cli login` / `print-key`  
**Dashboard:** `https://app.arbiterqa.com`

## Discover

```
GET /api/validations
```

Public. Use only ids with `runnable: true`, matching `subjectType`. An id with
`customOnly: true` needs its `custom_only` parameters sent in `parameters` or it is
skipped; `customParameters` lists every parameter a job may send (a Standard-only one is
refused as `PARAMETER_NOT_CUSTOMIZABLE`). Catalog dump with parameters:
`GET /api/validations?include=parameters`.

```
GET /api/validation-sets
GET /api/validation-sets/:setId
```

Public Validation Sets. Optional `?subjectType=url|email`. Run a set with
`validationSetId` on `POST /api/jobs`. Every set runs with zero input — no set contains a
Custom-only check, so a set is the safe first run; add a Custom-only check by id beside
the set, with its `parameters`.

```
GET /api/email-clients
```

Bearer. Selectable mail clients with plan inclusion. Choosing more clients changes which renders you get, not the price.

### Where a check can run

Every catalog entry carries `capture`:

```json
"capture": {
  "offered": { "mobile": "all", "desktop": ["gmail_chrome"] },
  "standard": { "desktop": ["gmail_chrome"] },
  "note": "Judged in the mail client that rendered it, at each width we capture."
}
```

`offered` is where the check **can** run — a viewport that is absent is one it cannot run at, and
`"all"` means every surface in that subject's catalog (browsers for a webpage, mail clients for an
email). `standard` is what we capture when you say nothing. An **empty** `offered` means the check
reads the message source and renders nothing anywhere; `note` says why, in the check's own words.
Read this before sending `capture` on a job — a viewport or surface outside `offered` is refused
with `CAPTURE_PROHIBITED_HERE`, and no plan upgrade changes that.

## Estimate and run

Same body on both doors (unified shape — top-level `type` required). A job costs the sum of each selected validation's `price.credits` (from `GET /api/validations`), charged once per validation per job whatever widths or mail clients it is examined in; the estimate's `lines[].items[]` lists exactly those validation items.

```
POST /api/jobs/estimate
POST /api/jobs
Authorization: Bearer <key>
Content-Type: application/json
```

### URL

```json
{
  "type": "url",
  "url": "https://www.example.com",
  "validations": [
    "logo-usage",
    { "id": "font-size-body-min-max", "parameters": { "minPx": "14px" } }
  ]
}
```

### Static HTML

```json
{
  "type": "static_html",
  "baseUrl": "https://www.example.com",
  "html": "<html>…</html>",
  "validations": ["no-lorem-ipsum"]
}
```

### URL (Validation Set)

```json
{
  "type": "url",
  "url": "https://www.example.com",
  "validationSetId": "brand-compliance"
}
```

### Email (Validation Set)

```json
{
  "type": "email",
  "subject": "March launch — 20% off",
  "validationSetId": "marketing"
}
```

### Email (explicit checks)

```json
{
  "type": "email",
  "validations": [
    "email-unsubscribe-present",
    {
      "id": "email-tracking-integrity",
      "parameters": { "enforceGa4Channels": false }
    }
  ]
}
```

### Choosing where a check runs

`capture` on a validation entry names the viewports and surfaces to examine it in — browsers for a
webpage, mail clients for an email:

```json
{
  "type": "email",
  "validations": [
    { "id": "email-layout-not-broken", "capture": { "mobile": ["gmail_chrome_mobile"], "desktop": [] } }
  ]
}
```

An empty array under a viewport means "whatever that viewport renders by default". Omit `capture`
and the check runs where the catalog's `standard` says. Sending it costs nothing extra: a check is
charged once per job whatever it is examined in.

Three refusals, and they mean different things:

- **`CAPTURE_PROHIBITED_HERE`** — the check declares it cannot run there. `details.reason` is its
  own recorded words. No plan changes this; ask for it somewhere in `capture.offered`.
- **`PLAN_EXCLUDES_REQUESTED_CLIENTS`** — the mail client is outside this organization's plan. An
  upgrade does change this.
- **`UNKNOWN_EMAIL_CLIENT`** — the surface id is not in the catalog at that viewport.

`clients` is the email-only spelling of `capture` and still works. Send one or the other, never
both.

A body **without** top-level `type` is **400 `LEGACY_REQUEST_SHAPE`**. Do not send
the old line-array shape.

Optional `detail`: `brief` (default) | `verbose` (adds `references` / `note` on results).

## Read jobs

```
GET /api/jobs
GET /api/jobs?detail=verbose
```

Bearer. Email jobs: poll until not `pending`, or use MCP `await_email_job`.

## Report a verdict

```
POST /api/jobs/:jobId/validations/:validationId/verdict
{ "verdict": "pass" | "fail" | "error", "note": "why the automation has it wrong" }
```

Bearer. When a validation's result on your job is wrong, say what it should have been. One
verdict per validation per job, stamped across every render; it is immutable, but sending the
same verdict again adds or updates `note`. The reply lists each render's standing and
`disagrees`; include `note` whenever you disagree — it is what improves the validation. MCP:
`report_verdict`.

## Credits and org

```
GET /api/credits
GET /api/keys
GET /api/org
```

Bearer (session or key). Key mint/rotate/revoke stay session-only.

## Errors

Structured `{ code, title, message, developerMessage, details? }`. Branch on `code` — it is
stable; the prose is written for people and gets reworded. `details` carries the specifics
(which field, which ids, which values are allowed).

The full list is below, and also served as JSON at `GET /api/errors` (public, no key) or from
the MCP tool `explain_error` called with no arguments. Do not guess codes.

<!-- BEGIN GENERATED: error-codes — generated from the API error catalog by `bun run errors:docs`; do not edit by hand -->

| Code | HTTP | What it means and what to do |
| --- | --- | --- |
| `CAPTURE_PROHIBITED_HERE` | 400 | A (viewport, surface) pair in capture is prohibited by the validation's own capture declaration. details.validationId names the validation, details.prohibited lists the refused pairs, and details.reason carries the declaration's recorded rationale. What a validation can be captured in ships with the module and moves only by migration, so this is not a plan limit and no upgrade changes it. GET /api/validations publishes the offered viewports and surfaces per validation. Refused before pricing, so nothing is charged and no job is created. |
| `CLIENT_SELECTION_NOT_IN_JOB` | 400 | clients was supplied for a validation id that no email line in this job selects. details.validationId names it. Select the validation on the job, or remove its clients entry. Refused before pricing, so nothing is charged and no job is created. |
| `CLIENT_SELECTION_RENDERLESS_CHECK` | 400 | clients was supplied for a functional validation. Functional checks read the MIME, which is identical across mail clients, so they render nothing and accept no client selection. details.validationId names it. Remove the clients entry. Refused before pricing, so nothing is charged and no job is created. |
| `CONFLICTING_PARAMETERS` | 400 | Two validations[] entries set the same parameter name to values that differ. A job carries one flat parameter map, so per-validation values for the same name cannot be expressed. Align the values or drop one. details.path points at the second entry. |
| `DUPLICATE_VALIDATION` | 400 | The same validation id appears more than once in validations[] with configurations that are not identical. Identical duplicates are collapsed automatically; differing ones are refused so neither is silently dropped. details.path names the repeat entry. |
| `EMPTY_CLIENT_SELECTION` | 400 | clients was supplied as an empty object. "Render nothing" is expressed by not selecting the validation, not by an empty map. details.validationId names the entry. Add viewport keys with client ids (or an empty array for the native default), or remove the entry. Refused before pricing, so nothing is charged and no job is created. |
| `INVALID_CAPTURE_SIZE` | 400 | Use one of the supported capture size IDs: mobile, tablet, or desktop. |
| `INVALID_CLIENT_SELECTION` | 400 | clients on a validation entry must be an object keyed by a known viewport, each holding an array of client id strings. details.path names the offending key. Client id validity and plan gating are enforced separately. |
| `INVALID_ENUM_VALUE` | 400 | Use one of the allowed values listed in details.allowedValues. |
| `INVALID_PARAMETER_VALUE` | 400 | Check the submitted value against the Parameter format requirements returned in details. |
| `INVALID_REQUEST_BODY` | 400 | Check the request schema, required fields, content type, and JSON formatting. |
| `JOB_ACCEPTS_ONE_SUBJECT` | 400 | POST /api/jobs and POST /api/jobs/estimate accept exactly one entry in validations; details.subjectCount reports how many were sent. Send one request per subject and each returns its own jobId. Refused before pricing, so nothing is charged and no job is created. |
| `JOB_SUBJECT_REQUIRED` | 400 | Supply url on a url line, or html and baseUrl on a static_html line. details names the line and the missing field. Refused before pricing, so nothing is charged and no job is created. |
| `LEGACY_REQUEST_SHAPE` | 400 | The legacy validations line-array body is no longer accepted. Send the unified job request: top-level type ("url" \| "static_html" \| "email") with its subject fields (url, or html + baseUrl, or subject), validations[] as string ids or { id, severity, parameters, clients } objects, and optional validationSetId. details.hint maps each legacy field this body used to its unified home. See the POST /api/jobs reference. |
| `MISSING_REQUIRED_FIELD` | 400 | Add the missing field listed in details.field and retry. |
| `NO_VALIDATIONS_SELECTED` | 400 | Add at least one validation id in validations[], or name a validationSetId from GET /api/validation-sets. |
| `ONE_VALIDATION_SET_PER_JOB` | 400 | Send a single validationSetId string. A subject that needs a different set is a separate job. |
| `PARAMETER_NOT_CUSTOMIZABLE` | 400 | A parameters key names a Standard-only parameter: its value is set by the validation's Standard and a job cannot change it. details.failures lists each validationId and parameterName refused. GET /api/validations publishes only the parameters a job may send, under customParameters. Refused before pricing, so nothing is charged and no job is created. |
| `PLAN_EXCLUDES_SELECTED_CHECKS` | 400 | After plan gating, no selected validation remains runnable — a job that would do nothing is refused rather than accepted at a zero quote. details.gatedValidationIds lists what was excluded and details.missingFeatures the plan features that would unlock them. Nothing was charged and no job was created. |
| `PLAYGROUND_INVALID_URL` | 400 | Provide a public http(s) URL. Private, loopback, link-local, and internal addresses are rejected. See details.reason. |
| `SIGNUP_INVALID_EMAIL` | 400 | Provide a syntactically valid email address in the `email` field. It becomes the account owner, so a human must be able to sign in with it later. |
| `UNKNOWN_EMAIL_CLIENT` | 400 | A client id in clients does not exist in the rbtr render catalog at that form factor. details.validationId names the validation and details.unknownClients lists the (formFactor, clientId) pairs. GET /api/email-clients returns the current catalog. Refused before pricing, so nothing is charged and no job is created. |
| `UNKNOWN_FIELD` | 400 | Remove or correct the fields in details.unknownFields. The accepted top-level fields are listed in the error message; the most common cause is a typo on a field that matters (e.g. "validation" for "validations"). |
| `VALIDATION_NOT_RUNNABLE` | 400 | Use an id from GET /api/validations where runnable is true. An id we run but do not list is refused too, so that it can never run unpriced. |
| `VALIDATION_SET_CONFLICT` | 400 | Send validationSetId, or an explicit validations[] list, not both with an internal validationSets array. Extra checks belong in validations[]. |
| `VALIDATION_SET_NOT_FOUND` | 400 | Call GET /api/validation-sets (or GET /api/validation-sets/:setId) for published ids, or name checks in validations[]. |
| `VALIDATION_SET_SUBJECT_MISMATCH` | 400 | validationSetId must match the job type: url and static_html jobs take url sets; email jobs take email sets. details.setSubjectType and details.jobSubjectType name the mismatch. |
| `VALIDATION_SUBJECT_MISMATCH` | 400 | Every named validation must match the job type: url/static_html jobs take url-subject checks, email jobs take email-subject checks. details.mismatches names each offender with its subject type. Pick ids from GET /api/validations whose subjectType matches your job. |
| `VALIDATION_TYPE_UNSUPPORTED` | 400 | Use a supported validation type, such as url or static_html. |
| `AUTH_REQUIRED` | 401 | Sign in and retry the request with a valid session. |
| `INSUFFICIENT_CREDITS` | 402 | The organization does not hold enough credits for this job. Nothing was charged and no job was created. See details.balance, details.required and details.shortfall; quote first with POST /api/jobs/estimate. |
| `ADMIN_REQUIRED` | 403 | Authenticate as an admin user before calling this endpoint. |
| `CUSTOMER_SCOPE_MISMATCH` | 403 | Use the authenticated customer ID, or sign in as the correct customer. |
| `INSUFFICIENT_SCOPE` | 403 | The API key lacks one or more required scopes. Mint a new key with the needed scopes (scopes are fixed at creation) and retry. |
| `PLAN_EXCLUDES_EMAIL_CHECKS` | 403 | The organization's plan does not include email checks. details.feature names the plan feature that unlocks them; upgrade the plan in the billing portal and retry. Nothing was charged and no job was created. |
| `PLAN_EXCLUDES_REQUESTED_CLIENTS` | 403 | An explicitly named (formFactor, clientId) pair in clients is outside the organization's plan grants. Explicit requests are refused, never silently narrowed. details.validationId names the validation, details.refusedClients the pairs, and details.missingFeatures the plan feature(s) that unlock them. Nothing was charged and no job was created. |
| `PLAN_EXCLUDES_WEBSITE_CHECKS` | 403 | The organization's plan does not include website checks. details.feature names the plan feature that unlocks them; upgrade the plan in the billing portal and retry. Nothing was charged and no job was created. |
| `UNAUTHORIZED_DOMAIN` | 403 | Sign in with an email address on an invited domain. There is no self-serve allowlist to change: domain restriction is enforced by the identity provider for this deployment, so an unexpected refusal here is a support question. |
| `CUSTOMER_NOT_FOUND` | 404 | No organization matches that customerId. Omit it to act as the organization your credential belongs to — that is the default, and naming a different tenant is refused as CUSTOMER_SCOPE_MISMATCH rather than answered. |
| `JOB_NOT_FOUND` | 404 | Verify the jobId and customer scope. |
| `PLAYGROUND_RUN_NOT_FOUND` | 404 | Unknown or expired playground run id. Runs are kept in memory for a limited time (PLAYGROUND_RUN_TTL_MINUTES). |
| `STORAGE_OBJECT_NOT_FOUND` | 404 | Check customerId, jobId, and storage key. Legacy jobs may use _screenshot. |
| `VALIDATION_NOT_FOUND` | 404 | Use GET /api/validations for offered ids, or a published content slug from /validations/:slug/standard. |
| `VERDICT_TARGET_NOT_FOUND` | 404 | No validation_results rows match (jobId, validationId) inside the caller's tenant. Verify both ids against GET /api/jobs/:jobId. |
| `ACCOUNT_EXISTS` | 409 | A tenant already exists for this email address. POST /api/signup only provisions NEW accounts and never returns a credential for an existing one. Sign in at /auth/login and use POST /api/keys, or `npx @rbtrqa/cli login` for a CLI key. |
| `JOB_CHARGE_CONFLICT` | 409 | A credit_ledger charge already exists for this job id under a different tenant or a different amount. Job ids are minted server-side and are not accepted in the request body, so this should be unreachable — treat it as an invariant violation and check the logs for billing.charge_conflict. Nothing was charged and no job was created. |
| `VERDICT_ALREADY_RECORDED` | 409 | A verdict is immutable once recorded. Repeating the SAME verdict is accepted and updates the note; a different verdict is refused. details.recorded carries the stored verdict. |
| `PLAYGROUND_LIMIT_REACHED` | 429 | The anonymous session used all its free playground runs. Sign up for a free account, or authenticate with an API key and use POST /api/jobs. |
| `PLAYGROUND_RATE_LIMITED` | 429 | Too many playground runs from this IP in the current window. Wait for the window to pass, or sign up and use the authenticated API. |
| `INTERNAL_ERROR` | 500 | Retry the request. If it persists, contact support with the requestId. |
| `JOB_EXECUTION_FAILED` | 500 | The job failed after it was accepted and charged. Settlement refunds undelivered captures and any errored result rows, so a partial run is not billed in full. Retry if retryable is true; otherwise contact support with the requestId and jobId. |
| `BILLING_NOT_PROVISIONED` | 503 | The organization has no billing customer with our billing provider, or that customer holds no live agreement, so no plan can be resolved and no default is substituted. Nothing on the caller side fixes it: contact support, and the repair happens in our provisioning. |
| `BILLING_PROVIDER_UNREACHABLE` | 503 | The Kinde Management API or the synced plan catalog could not be read. No plan data is assumed during the outage — every request needing the plan fails until Kinde answers. Check Kinde status, credentials, and network egress; a cached resolution (≤5 min) is still served where one exists. |
| `EMAIL_CLIENT_CATALOG_UNAVAILABLE` | 503 | The rbtr client catalog is unreachable and nothing is cached, so client ids in clients cannot be validated. Refusing beats skipping: an unvetted id would fail at capture time, after the charge. Retry, or resubmit without per-validation clients. Nothing was charged and no job was created. |
| `PLAN_NOT_PUBLISHED` | 503 | The customer's Kinde agreement is missing a usable credits entitlement (absent, ≤0, or the 2147483647 unlimited sentinel on a paid plan) or the plan code is not one we grant for. Fix the plan's credits meter in the Kinde dashboard; Free ignores that field and uses FREE_MONTHLY_CREDITS. Requests needing the plan fail until the entitlement is set. |
| `SERVICE_UNAVAILABLE` | 503 | A dependency this endpoint requires is unconfigured or unreachable, so the request was refused before any work or billing. This is our deployment, not your request: the body is unchanged and retrying is safe. Call sites override this message with the specific dependency; the request log carries it either way. |

<!-- END GENERATED: error-codes -->
