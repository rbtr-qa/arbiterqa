# Setup: `rbtr-qa` GitHub + `@rbtrqa/cli` on npm org **`rbtrqa`**

## GitHub (working)

`mhhlines` is **admin** on **`rbtr-qa/arbiterqa`**. Sync handoff from this repo:

```sh
./scripts/push-rbtr-qa-arbiterqa-github.sh "feat: @rbtrqa/cli@0.3.0"
```

Requires `gh auth login` (already configured on maintainer machines).

## npm auth (one-time per machine)

Pick **one** — not both:

### A. Browser login (recommended for laptops)

```sh
npm login --auth-type=web
npm whoami   # must print your npm username
```

### B. Token in Secret Manager (recommended for agents / CI until trusted publishing)

1. Create a **Granular Access Token** on npmjs.com → org **`rbtrqa`** → Packages → Read and Write → `@rbtrqa/cli`
2. Store it:

   ```sh
   gcloud secrets create rbtr-local-npm-token --project=project-3d6158cf-00c9-4900-b14 --replication-policy=automatic
   echo -n 'npm_…' | gcloud secrets versions add rbtr-local-npm-token --data-file=-
   ```

3. Add to `.env.example` / `env:sync` as `NPM_TOKEN=<secret:npm-token>` when wired, or export `NPM_TOKEN` locally.

## Publish `@rbtrqa/cli@0.3.0`

```sh
./scripts/publish-npm-handoff.sh           # dry-run
./scripts/publish-npm-handoff.sh --publish # ship
```

Then configure **trusted publishing** on npmjs.com → `@rbtrqa/cli` → GitHub Actions → `rbtr-qa/arbiterqa` / `release.yml`.

## After first publish

```sh
bun run skills:project -- --confirm-handoff
```

## Optional later — recover unscoped `npx arbiterqa`

Michael still owns **`arbiterqa@0.2.0`**. Not blocking `@rbtrqa/cli`. File npm support dispute if you want the old one-liner back.
