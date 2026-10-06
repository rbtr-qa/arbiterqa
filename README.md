# ArbiterQA (`rbtr-qa/arbiterqa`)

Public home for **`npx @rbtrqa/cli`**, the agent skill, the Claude Code plugin and the
**ArbiterQA GitHub Action**.

## Claude

- **Claude Code**: `/plugin marketplace add rbtr-qa/arbiterqa`, then `/plugin install arbiterqa@arbiterqa`. The plugin carries the skill and the MCP server; the first tool call opens an ArbiterQA sign-in.
- **claude.ai, Claude Desktop, mobile**: Settings → Connectors → Add custom connector → `https://api.arbiterqa.com/mcp/claude`, then sign in.

## npm (Cursor, Codex, Gemini, AGENTS.md)

```sh
npx @rbtrqa/cli install
npx @rbtrqa/cli login
```

| Command | What it does |
| --- | --- |
| `install` / `update` | Install or refresh the skill (and Cursor MCP entry) in this project |
| `login` | Browser sign-in; stores an API key and writes `ARBITER_API_KEY` to `./.env` |
| `status` | Who you are signed in as |
| `print-key` | Print the API key to stdout |
| `logout` | Revoke the key and forget it |
| `run <request.json>` | Run one job and exit with its verdict (below) |
| `start <request.json>` | Start a job and print it; for email, the address to send to |
| `wait <jobId>` | Wait for a job, then exit with its verdict |

`ARBITER_API_KEY` in the environment wins over a stored login. Node ≥ 18.17, no dependencies.

## Run checks in CI

`request.json` is a [`POST /api/jobs`](https://api.arbiterqa.com/llms-full.txt) body: one
subject (`url`, `static_html` or `email`) and a `validationSetId` and/or `validations`.

```sh
ARBITER_API_KEY=… npx @rbtrqa/cli run request.json
```

| Exit | Verdict | Meaning |
| --- | --- | --- |
| `0` | pass | The job finished and no **required** or **prohibited** check failed |
| `1` | blocked | A required check failed, or a prohibited one was found |
| `2` | undecided | No verdict: the request was refused, the job expired, the wait timed out, or the service was unreachable |

The verdict reads the job's `overallPassPolicy`, which weighs severity. A job's `status` is
`failed` when *any* check fails, including an optional one; that alone is not exit 1.

| Variable | Effect |
| --- | --- |
| `ARBITER_EVIDENCE_DIR` | Write `job.json` (always) and a PNG of each failed or errored render |
| `ARBITER_WAIT_TIMEOUT_SECONDS` | Stop waiting after this long (default 1920; jobs expire and refund at 30 minutes) |
| `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY` | Set by GitHub Actions; outputs and a markdown summary are written to them |

## GitHub Action

```yaml
- uses: rbtr-qa/arbiterqa@v1
  with:
    api-key: ${{ secrets.ARBITER_API_KEY }}
    request: request.json
```

Add the key as a repository secret, then make the job a **required status check** (branch
protection or a ruleset) so a blocked verdict stops the merge.

### Inputs

| Input | Default | |
| --- | --- | --- |
| `api-key` | — | Always pass a secret. Empty skips with a notice (fork pull requests get no secrets). |
| `request` | — | Path to the job request. |
| `send` | — | Email only: shell command that sends the email. Runs after the job starts with `ARBITER_TEST_EMAIL` and `ARBITER_JOB_ID` set. If it fails, the step fails without waiting. |
| `fail-on-undecided` | `true` | `false` turns exit 2 into a warning, so only real quality problems fail the check. |
| `timeout-seconds` | `1920` | |
| `upload-evidence` | `true` | Upload `job.json` and failed screenshots as an artifact. |
| `artifact-name` | `arbiterqa-evidence` | Change it if the action runs twice in one job. |

Outputs: `verdict`, `job-id`, `job-url`, `test-email`, `credits-charged`, `credits-refunded`,
`blocking-validations`. The step summary shows the verdict, the pass policy, the blocking
checks, every check's status, skips and the job link.

### A preview deployment

```yaml
on: pull_request

concurrency:
  group: arbiterqa-${{ github.ref }}
  cancel-in-progress: true

jobs:
  arbiterqa:
    runs-on: ubuntu-latest
    steps:
      # …deploy the preview and expose its URL as steps.preview.outputs.url
      - name: Write the job request
        env:
          URL: ${{ steps.preview.outputs.url }}
        run: jq -n --arg url "$URL" '{type: "url", url: $url, validationSetId: "brand-compliance"}' > request.json
      - uses: rbtr-qa/arbiterqa@v1
        with:
          api-key: ${{ secrets.ARBITER_API_KEY }}
          request: request.json
```

From Vercel or Netlify deployment events instead, use `on: deployment_status`, run when
`github.event.deployment_status.state == 'success'`, and read the URL from
`github.event.deployment_status.environment_url`.

`cancel-in-progress` stops the superseded run, which saves runner minutes. It does **not**
save credits: the cancelled run's job was already charged and still finishes.

### Built HTML

```yaml
- run: npm run build
- run: |
    jq -n --rawfile html dist/index.html \
      '{type: "static_html", html: $html, baseUrl: "https://www.example.com/", validationSetId: "brand-compliance"}' > request.json
- uses: rbtr-qa/arbiterqa@v1
  with:
    api-key: ${{ secrets.ARBITER_API_KEY }}
    request: request.json
```

### Email

The checks judge the email your stack actually sends, with your ESP's tracking links,
headers and authentication. So your workflow sends it, to the one-time address the job gives
you:

```yaml
- run: jq -n '{type: "email", subject: "Welcome to Acme", validationSetId: "operational"}' > request.json
- uses: rbtr-qa/arbiterqa@v1
  with:
    api-key: ${{ secrets.ARBITER_API_KEY }}
    request: request.json
    send: npm run send-welcome-email -- --to "$ARBITER_TEST_EMAIL"
```

On a paid plan you can send to your organization's capture inbox instead and match the
message by subject. Put the run id in the subject so a run never matches another run's mail:

```json
{
  "type": "email",
  "validationSetId": "operational",
  "emailCapture": {
    "mode": "universal",
    "source": { "select": "subject", "subject": "ci-RUN_ID", "subject_match": "contains", "on_multiple": "error" }
  }
}
```

### Debugging a red check

- **Exit 1 (blocked)**: the summary lists the blocking checks. Open the job link for each
  finding and its screenshot, or download the evidence artifact.
- **Exit 2 (undecided)**: usually one of these:
  - the email never arrived (`interruption.cause: email_not_received`; the job refunds itself)
  - the request was refused (the log shows the error code, for example `VALIDATION_NOT_RUNNABLE`
    or `INSUFFICIENT_CREDITS`)
  - the service was unavailable after retries
- **Re-run locally**: `ARBITER_API_KEY=… npx @rbtrqa/cli run request.json`.
- **Skipped checks never block.** `SKIPPED_NOT_IN_PLAN` means your plan excludes the check,
  `SKIPPED_INVALID_PARAMETER` means a parameter value was rejected, and
  `SKIPPED_CLIENT_DID_NOT_RENDER` means an email client produced no render.
- `job.json` in the artifact is the complete record.

The action runs `node` from the runner (GitHub-hosted runners have it; on self-hosted, add
`actions/setup-node`). The code it runs is pinned by the tag you use.

## Releasing

See [SETUP.md](./SETUP.md).
