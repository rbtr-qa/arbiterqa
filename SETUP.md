# Setup: `rbtr-qa` GitHub org + npm ownership

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

## 3. Move npm package off Michael's account (no publish from Michael)

Goal: keep the unscoped name **`arbiterqa`** so `npx arbiterqa` stays unchanged.

1. Create an **ArbiterQA npm organization** (or use a maintainer org you control — not `@rbtr`, that scope is taken by another project)
2. Michael invites ArbiterQA maintainers as **`arbiterqa` package owners** (or grants org team read/write)
3. Michael removes himself after maintainers accept
4. Configure **trusted publishing** on npm for `arbiterqa` → GitHub repo `rbtr-qa/arbiterqa`, workflow `release.yml`
5. First publish **0.3.0** from GitHub Actions (OIDC), not from a personal laptop token

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
