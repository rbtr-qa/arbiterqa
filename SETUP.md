# Setup: `rbtr-qa` GitHub org + `@rbtrqa/cli` on npm

## 1. Create GitHub org (human, one time)

GitHub org slugs cannot contain dots — use **`rbtr-qa`**. Display name can be **rbtr.qa**.

1. Open https://github.com/organizations/plan
2. Create organization **`rbtr-qa`** (Free plan is fine to start)
3. Require 2FA for all members; create a **`release`** team with repo + Actions access
4. Add named maintainers (no shared login)

## 2. Create public repository

Create **`rbtr-qa/arbiterqa`** (public), then push this directory as the initial commit:

```sh
cd docs/handoffs/rbtr-qa-arbiterqa   # from lksy-private checkout
git init
git add .
git commit -m "feat: initial ArbiterQA CLI + Claude plugin distribution"
git branch -M main
git remote add origin git@github.com:rbtr-qa/arbiterqa.git
git push -u origin main
```

## 3. Publish `@rbtrqa/cli` on npm org **`rbtrqa`**

Customer install command: **`npx @rbtrqa/cli`**. Bin names inside the package stay `arbiterqa` / `arbiter`.

1. Log in to npm with access to org **`rbtrqa`**: `npm login`
2. **First publish (manual once)** — trusted publishing requires an existing package:

   ```sh
   cd docs/handoffs/rbtr-qa-arbiterqa   # or clone github.com/rbtr-qa/arbiterqa
   npm publish --access public
   ```

3. Configure **trusted publishing** on npmjs.com → **`@rbtrqa/cli`** → Settings → Trusted publishing:

   | Field | Value |
   | --- | --- |
   | Provider | GitHub Actions |
   | Repository | `rbtr-qa/arbiterqa` |
   | Workflow | `release.yml` |

4. Future releases: tag `v0.3.1` (etc.) → Actions publishes via OIDC (no long-lived npm token)

### Optional legacy track — unscoped `arbiterqa`

Michael's unscoped **`arbiterqa@0.2.0`** is not under our control. To recover `npx arbiterqa` later, file npm support → **Dispute a package, org, or username** and request org **`rbtrqa`** be added as owners. Not blocking ship.

## 4. After first npm publish

In `lksy-private` Admin → Skills → **Confirm npm published**, or:

```sh
bun run skills:project -- --confirm-handoff
```

That clears `npm_package` blocked and stamps Cursor/Codex/Gemini/`AGENTS.md` followers.

## Slugs we cannot use

| Slug | Why |
| --- | --- |
| `arbiterqa` (GitHub) | Personal user since 2018 |
| `rbtr` (GitHub) | Personal user (unrelated) |
| `rbtr.qa` (GitHub org) | Dots not allowed |
| `@rbtr` (npm) | Existing third-party org |
| unscoped `arbiterqa` (npm) | Michael's account — use `@rbtrqa/cli` instead |
