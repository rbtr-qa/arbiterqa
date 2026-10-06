# Releasing `@rbtrqa/cli`

Published to npm (org **`rbtrqa`**) from this repo by `.github/workflows/release.yml`,
using **npm trusted publishing** — GitHub OIDC, no npm token stored anywhere.

`skills/` and `plugins/` are synced here from upstream; never edit them in this repo.
`bin/`, `action.yml`, `tests/`, `package.json`, the README and the workflows are edited here
(`npm test` runs on every pull request).

## Release

1. Skill and plugin updates arrive as a sync pull request that also bumps the
   `package.json` version. Review and merge it.
2. Tag the merge — the workflow checks the tag equals `package.json` and publishes:

   ```sh
   git tag vx.y.z && git push origin vx.y.z
   ```

   Only exact `vX.Y.Z` tags publish.

3. Move the GitHub Action's major tag to the same commit, so `uses: rbtr-qa/arbiterqa@v1`
   picks it up. It is a floating tag and never publishes to npm:

   ```sh
   git tag -f v1 vx.y.z && git push -f origin v1
   ```

   A breaking change to the action's inputs, outputs or exit codes starts `v2` instead.

`workflow_dispatch` with `dry_run` runs `npm publish --dry-run`.

## One-time: trusted publisher

Needs an npm session with web 2FA (tokens cannot create trust):

```sh
npm login --auth-type=web
npm trust github @rbtrqa/cli --file release.yml --repo rbtr-qa/arbiterqa -y
npm trust list @rbtrqa/cli
```

Or npmjs.com → `@rbtrqa/cli` → Settings → Trusted publisher → GitHub Actions →
`rbtr-qa/arbiterqa` / `release.yml`. Renaming the workflow file breaks the trust.
