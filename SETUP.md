# Releasing `@rbtrqa/cli`

Published to npm (org **`rbtrqa`**) from this repo by `.github/workflows/release.yml`,
using **npm trusted publishing** — GitHub OIDC, no npm token stored anywhere.

## Release

1. In `lksy-private`, project the skill and open the sync PR here:

   ```sh
   bun run skills:project
   bun run cli:sync -- --version x.y.z
   ```

   `bun run cli:sync:check` reports whether this repo's `skills/` and `plugins/` have drifted.

2. Merge the PR.
3. Tag it — the workflow checks the tag equals `package.json` and publishes:

   ```sh
   git tag vx.y.z && git push origin vx.y.z
   ```

4. In `lksy-private`, record the publication: `POST /api/admin/skills/arbiterqa/confirm-npm`.

`workflow_dispatch` with `dry_run` runs `npm publish --dry-run`.

## One-time: trusted publisher

Needs an npm session with web 2FA (tokens cannot create trust):

```sh
npm login --auth-type=web
npm trust github @rbtrqa/cli --file release.yml --repo rbtr-qa/arbiterqa --allow-publish -y
npm trust list @rbtrqa/cli
```

Or npmjs.com → `@rbtrqa/cli` → Settings → Trusted publisher → GitHub Actions →
`rbtr-qa/arbiterqa` / `release.yml`. Renaming the workflow file breaks the trust.
