# ArbiterQA distribution (`rbtr-qa/arbiterqa`)

Public home for the **`npx @rbtrqa/cli`** CLI, agent skill, and Claude Code plugin.
Canonical skill prose is authored in the private app repo (`skills/arbiterqa/`) and
projected here via `bun run skills:project` in `lksy-private`.

## npm — `npx @rbtrqa/cli`

```sh
npx @rbtrqa/cli install
npx @rbtrqa/cli login
npx @rbtrqa/cli print-key
```

See [README.npm.md](./README.npm.md) for the full customer README shipped on npm.

## Claude Code plugin

After this repo is public on GitHub:

```text
/plugin marketplace add rbtr-qa/arbiterqa
/plugin install arbiterqa@rbtr-plugins
```

Paste an API key from `npx @rbtrqa/cli login` / `print-key` when Claude prompts
`userConfig`.

Local validation:

```bash
claude --plugin-dir ./plugins/arbiterqa
claude plugin validate ./plugins/arbiterqa
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `bin/`, `skills/`, `package.json` | npm package (`@rbtrqa/cli@0.3.0`) |
| `plugins/arbiterqa/` | Claude Code plugin + remote MCP binding |
| `plugins/.claude-plugin/marketplace.json` | Marketplace catalog (`rbtr-plugins`) |

## Release (maintainers)

1. Sync skill bytes from `lksy-private` (`bun run skills:project`).
2. Copy this tree to `github.com/rbtr-qa/arbiterqa` (or push from CI).
3. Tag + publish npm via GitHub Actions trusted publishing (see `.github/workflows/release.yml`).
4. Confirm in Admin → Skills so via-npm surfaces clear `blocked`.

Ownership checklist: [SETUP.md](./SETUP.md)
