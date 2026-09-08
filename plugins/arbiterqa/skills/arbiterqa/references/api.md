# ArbiterQA HTTP API (fallback)

Use this when MCP is unavailable. Prefer MCP tools when the host supports them.

**Base URL:** `https://api.arbiterqa.com`  
**Auth:** `Authorization: Bearer <key>` from `npx @rbtrqa/cli login` / `print-key`  
**Dashboard:** `https://app.arbiterqa.com`

## Discover

```
GET /api/validations
```

Public. Use only ids with `runnable: true`. Respect `requiresConfiguration` /
`subjectType`. Catalog dump with parameters: `GET /api/validations?include=parameters`.

```
GET /api/validation-sets
```

Public curated email standards (category + tier).

```
GET /api/email-clients
```

Bearer. Selectable mail clients with plan inclusion and native/extra credit flags.

## Estimate and run

Same body on both doors (unified shape — top-level `type` required):

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

### Email (curated standard)

```json
{
  "type": "email",
  "subject": "March launch — 20% off",
  "standards": [{ "category": "marketing", "tier": "standard" }]
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

A body **without** top-level `type` is **400 `LEGACY_REQUEST_SHAPE`**. Do not send
the old line-array shape.

Optional `detail`: `brief` (default) | `verbose` (adds `references` / `note` on results).

## Read jobs

```
GET /api/jobs
GET /api/jobs?detail=verbose
```

Bearer. Email jobs: poll until not `pending`, or use MCP `await_email_job`.

## Credits and org

```
GET /api/credits
GET /api/keys
GET /api/org
```

Bearer (session or key). Key mint/rotate/revoke stay session-only.

## Feedback

```
GET /api/feedback/due
GET /api/feedback/questions?setId=&jobId=
POST /api/feedback
```

The product asks the questions; do not invent customer verdicts on validation results.

## Errors

Structured `{ code, title, message, developerMessage, details? }`. Branch on `code` — it is
stable; the prose is written for people and gets reworded. `details` carries the specifics
(which field, which ids, which values are allowed).

The full list is below, and also served as JSON at `GET /api/errors` (public, no key) or from
the MCP tool `explain_error` called with no arguments. Do not guess codes.

<!-- BEGIN GENERATED: error-codes — edit src/server/errors/apiErrorCatalog.ts, then run `bun run errors:docs` -->

| Code | HTTP | What it means and what to do |
| --- | --- | --- |
| `AI_MISTAKE_NOTES_REQUIRED` | 400 | Provide aiMistakeNotes when humanVerdict differs from the stored AI status. |
| `CLIENT_SELECTION_NOT_IN_JOB` | 400 | clients was supplied for a validation id that no email line in this job selects. details.validationId names it. Select the validation on the job, or remove its clients entry. Refused before pricing, so nothing is charged and no job is created. |
| `CLIENT_SELECTION_RENDERLESS_CHECK` | 400 | clients was supplied for a functional validation. Functional checks read the MIME, which is identical across mail clients, so they render nothing and accept no client selection. details.validationId names it. Remove the clients entry. Refused before pricing, so nothing is charged and no job is created. |
| `CONFLICTING_PARAMETERS` | 400 | Two validations[] entries set the same parameter name to values that differ. A job carries one flat parameter map, so per-validation values for the same name cannot be expressed. Align the values or drop one. details.path points at the second entry. |
| `DUPLICATE_VALIDATION` | 400 | The same validation id appears more than once in validations[] with configurations that are not identical. Identical duplicates are collapsed automatically; differing ones are refused so neither is silently dropped. details.path names the repeat entry. |
| `EMPTY_CLIENT_SELECTION` | 400 | clients was supplied as an empty object. "Render nothing" is expressed by not selecting the validation, not by an empty map. details.validationId names the entry. Add viewport keys with client ids (or an empty array for the native default), or remove the entry. Refused before pricing, so nothing is charged and no job is created. |
| `FEEDBACK_ANCHOR_REQUIRED` | 400 | This set anchors to real work: validation-scope sets require jobId and validationId; a per-standard set requires the jobId of a job that ran the standard. details.needs lists what is missing. Take the ids from your own job record (GET /api/jobs). |
| `FEEDBACK_ANSWERS_INVALID` | 400 | One or more answers fail their question's answer-shape schema, or the submission does not answer the set exactly (every question in the set answered once, nothing extra). details.problems lists each question with its complaints; GET /api/feedback/questions serves each question's schema. |
| `FEEDBACK_RATIONALE_REQUIRED` | 400 | Provide verdictComments or feedbackNotes when humanVerdict is fail or error. |
| `INVALID_CAPTURE_SIZE` | 400 | Use one of the supported capture size IDs: mobile-sm, tablet-portrait, or desktop-md. |
| `INVALID_CLIENT_SELECTION` | 400 | clients on a validation entry must be an object keyed by a known viewport, each holding an array of client id strings. details.path names the offending key. Client id validity and plan gating are enforced separately. |
| `INVALID_ENUM_VALUE` | 400 | Use one of the allowed values listed in details.allowedValues. |
| `INVALID_PARAMETER_VALUE` | 400 | Check the parameter formatJson, submitted value, and validation message. |
| `INVALID_REQUEST_BODY` | 400 | Check the request schema, required fields, content type, and JSON formatting. |
| `JOB_ACCEPTS_ONE_SUBJECT` | 400 | POST /api/jobs and POST /api/jobs/estimate accept exactly one entry in validations; details.subjectCount reports how many were sent. Send one request per subject and each returns its own jobId. Refused before pricing, so nothing is charged and no job is created. |
| `JOB_SUBJECT_REQUIRED` | 400 | Supply url on a url line, or html and baseUrl on a static_html line. details names the line and the missing field. Refused before pricing, so nothing is charged and no job is created. |
| `LEGACY_REQUEST_SHAPE` | 400 | The legacy validations line-array body is no longer accepted. Send the unified job request: top-level type ("url" \| "static_html" \| "email") with its subject fields (url, or html + baseUrl, or subject), validations[] as string ids or { id, severity, parameters, clients } objects, and standards: [{ category, tier }] for a curated standard. details.hint maps each legacy field this body used to its unified home. See docs/api/API-REFERENCE.md (POST /api/jobs). |
| `MISSING_REQUIRED_FIELD` | 400 | Add the missing field listed in details.field and retry. |
| `NO_VALIDATIONS_SELECTED` | 400 | Add at least one valid validationId or validationSet. |
| `ONE_STANDARD_PER_JOB` | 400 | standards[] carries at most one curated {category, tier} entry and at most one bare {category} label, and never both — the job has one category seat. details.path names the extra entry. A subject needing different standards is separate jobs. |
| `PLAN_EXCLUDES_SELECTED_CHECKS` | 400 | After plan gating, no selected validation remains runnable — a job that would do nothing is refused rather than accepted at a zero quote. details.gatedValidationIds lists what was excluded and details.missingFeatures the plan features that would unlock them. Nothing was charged and no job was created. |
| `PLAYGROUND_INVALID_URL` | 400 | Provide a public http(s) URL. Private, loopback, link-local, and internal addresses are rejected. See details.reason. |
| `SIGNUP_INVALID_EMAIL` | 400 | Provide a syntactically valid email address in the `email` field. It becomes the account owner, so a human must be able to sign in with it later. |
| `UNKNOWN_EMAIL_CLIENT` | 400 | A client id in clients does not exist in the rbtr render catalog at that form factor. details.validationId names the validation and details.unknownClients lists the (formFactor, clientId) pairs. GET /api/email-clients returns the current catalog. Refused before pricing, so nothing is charged and no job is created. |
| `UNKNOWN_FIELD` | 400 | Remove or correct the fields in details.unknownFields. The accepted top-level fields are listed in the error message; the most common cause is a typo on a field that matters (e.g. "validation" for "validations"). |
| `VALIDATION_NOT_RUNNABLE` | 400 | Use an id from GET /api/validations where runnable is true. An id we run but do not list is refused too, so that it can never run unpriced. |
| `VALIDATION_STANDARD_CONFLICT` | 400 | A tier cannot be combined with a hand-built validationSets list — the explicit sets already decide membership and severities, and silently replacing them would rewrite the request. A tier beside explicit validation ids is fine: membership is the union (this is what the unified wire shape normalizes to). Sending category alongside an explicit list is also allowed; it records which standard the list came from. |
| `VALIDATION_STANDARD_NOT_APPLICABLE` | 400 | standards[] applies to email jobs only; url and static_html jobs select validations directly. Remove standards or set type to email. details.path names the offending location. |
| `VALIDATION_STANDARD_NOT_PUBLISHED` | 400 | Call GET /api/validation-sets for the published category and tier pairs, or name the checks yourself in the request’s validations array. |
| `VALIDATION_SUBJECT_MISMATCH` | 400 | Every named validation must match the job type: url/static_html jobs take url-subject checks, email jobs take email-subject checks. details.mismatches names each offender with its subject type. Pick ids from GET /api/validations whose subjectType matches your job. |
| `VALIDATION_TYPE_UNSUPPORTED` | 400 | Use a supported validation type, such as url or static_html. |
| `AUTH_REQUIRED` | 401 | Sign in and retry the request with a valid session. |
| `INSUFFICIENT_CREDITS` | 402 | The organization does not hold enough credits for this job. Nothing was charged and no job was created. See details.balance, details.required and details.shortfall; quote first with POST /api/jobs/estimate. |
| `ADMIN_REQUIRED` | 403 | Authenticate as an admin user before calling this endpoint. |
| `CUSTOMER_SCOPE_MISMATCH` | 403 | Use the authenticated customer ID, or sign in as the correct customer. |
| `INSUFFICIENT_SCOPE` | 403 | The API key lacks one or more required scopes. Mint a new key with the needed scopes (scopes are fixed at creation) and retry. |
| `PLAN_EXCLUDES_CUSTOM_CONFIGURATION` | 403 | The organization's plan does not include custom check configuration, so per-check `parameters` values are refused rather than silently ignored — an ignored value changes results invisibly. Sending values equal to the defaults still counts. Remove the custom values, or upgrade the plan (details.feature names the unlocking feature). Nothing was charged and no job was created. |
| `PLAN_EXCLUDES_EMAIL_CHECKS` | 403 | The organization's plan does not include email checks. details.feature names the plan feature that unlocks them; upgrade the plan in the billing portal and retry. Nothing was charged and no job was created. |
| `PLAN_EXCLUDES_REQUESTED_CLIENTS` | 403 | An explicitly named (formFactor, clientId) pair in clients is outside the organization's plan grants. Explicit requests are refused, never silently narrowed. details.validationId names the validation, details.refusedClients the pairs, and details.missingFeatures the plan feature(s) that unlock them. Nothing was charged and no job was created. |
| `PLAN_EXCLUDES_WEBSITE_CHECKS` | 403 | The organization's plan does not include website checks. details.feature names the plan feature that unlocks them; upgrade the plan in the billing portal and retry. Nothing was charged and no job was created. |
| `UNAUTHORIZED_DOMAIN` | 403 | Sign in with an email address on an invited domain. There is no self-serve allowlist to change: domain restriction is enforced by the identity provider for this deployment, so an unexpected refusal here is a support question. |
| `CUSTOMER_NOT_FOUND` | 404 | No organization matches that customerId. Omit it to act as the organization your credential belongs to — that is the default, and naming a different tenant is refused as CUSTOMER_SCOPE_MISMATCH rather than answered. |
| `FEEDBACK_CHECK_NOT_IN_JOB` | 404 | No result row exists for this validationId on this jobId (with the given capture identity, when supplied). Feedback anchors to a check that actually ran — take jobId and validationId from the job's own result rows. |
| `FEEDBACK_NOT_FOUND` | 404 | Record feedback first, or treat this result as pending review. |
| `FEEDBACK_SET_UNKNOWN` | 404 | No active feedback set has this id (for looks-wrong feedback, no active set serves this verdict for this audience). GET /api/feedback/questions returns the set currently being asked, with its id. |
| `JOB_NOT_FOUND` | 404 | Verify the jobId and customer scope. |
| `PLAYGROUND_RUN_NOT_FOUND` | 404 | Unknown or expired playground run id. Runs are kept in memory for a limited time (PLAYGROUND_RUN_TTL_MINUTES). |
| `STORAGE_OBJECT_NOT_FOUND` | 404 | Check customerId, jobId, and storage key. Legacy jobs may use _screenshot. |
| `VALIDATION_NOT_FOUND` | 404 | Use GET /api/validations for offered ids, or a published content slug from /validations/:slug/standard. |
| `ACCOUNT_EXISTS` | 409 | A tenant already exists for this email address. POST /api/signup only provisions NEW accounts and never returns a credential for an existing one. Sign in at /auth/login and use POST /api/keys, or `npx @rbtrqa/cli login` for a CLI key. |
| `FEEDBACK_ALREADY_GIVEN` | 409 | This user already completed this set (or already filed this looks-wrong set for this job and check). Feedback is append-only: the original submission stands and was paid at most once. There is nothing to retry. |
| `FEEDBACK_NOT_DUE` | 409 | The set is not currently due for this credential. Job-scope sets are served one at a time by GET /api/feedback/questions — submit the set that endpoint returns. For validation scope, the set must match the result row's verdict (details.expectedSetId when known). |
| `JOB_CHARGE_CONFLICT` | 409 | A credit_ledger charge already exists for this job id under a different tenant or a different amount. Job ids are minted server-side and are not accepted in the request body, so this should be unreachable — treat it as an invariant violation and check the logs for billing.charge_conflict. Nothing was charged and no job was created. |
| `PLAYGROUND_LIMIT_REACHED` | 429 | The anonymous session used all its free playground runs. Sign up for a free account, or authenticate with an API key and use POST /api/jobs. |
| `PLAYGROUND_RATE_LIMITED` | 429 | Too many playground runs from this IP in the current window. Wait for the window to pass, or sign up and use the authenticated API. |
| `INTERNAL_ERROR` | 500 | Retry the request. If it persists, contact support with the requestId. |
| `JOB_EXECUTION_FAILED` | 500 | The job failed after it was accepted and charged. Settlement refunds undelivered captures and any errored result rows, so a partial run is not billed in full. Retry if retryable is true; otherwise contact support with the requestId and jobId. |
| `BILLING_NOT_PROVISIONED` | 503 | The customer row has no Kinde billing customer, or its billing customer holds no live agreement. Signup provisions both, so this org predates billing or was provisioned outside it. Repair by reprovisioning the org (scripts/reprovision-kinde-orgs.ts); no default plan is substituted. |
| `BILLING_PROVIDER_UNREACHABLE` | 503 | The Kinde Management API or the synced plan catalog could not be read. No plan data is assumed during the outage — every request needing the plan fails until Kinde answers. Check Kinde status, credentials, and network egress; a cached resolution (≤5 min) is still served where one exists. |
| `EMAIL_CLIENT_CATALOG_UNAVAILABLE` | 503 | The rbtr client catalog is unreachable and nothing is cached, so client ids in clients cannot be validated. Refusing beats skipping: an unvetted id would fail at capture time, after the charge. Retry, or resubmit without per-validation clients. Nothing was charged and no job was created. |
| `PLAN_NOT_PUBLISHED` | 503 | The customer's Kinde agreement is missing a usable credits entitlement (absent, ≤0, or the 2147483647 unlimited sentinel on a paid plan) or the plan code is not one we grant for. Fix the plan's credits meter in the Kinde dashboard; Free ignores that field and uses FREE_MONTHLY_CREDITS. Requests needing the plan fail until the entitlement is set. |
| `SERVICE_UNAVAILABLE` | 503 | A dependency this endpoint requires is unconfigured or unreachable, so the request was refused before any work or billing. This is our deployment, not your request: the body is unchanged and retrying is safe. Call sites override this message with the specific dependency; the request log carries it either way. |

<!-- END GENERATED: error-codes -->
