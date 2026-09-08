# ArbiterQA distribution (`rbtr-qa/arbiterqa`)

Public home for **`npx @rbtrqa/cli`**, the agent skill, and the Claude Code plugin.

## npm

```sh
npx @rbtrqa/cli install
npx @rbtrqa/cli login
```

## Maintainer scripts (from `lksy-private`)

```sh
./scripts/push-rbtr-qa-arbiterqa-github.sh   # sync this tree → github.com/rbtr-qa/arbiterqa
./scripts/publish-npm-handoff.sh --publish  # publish @rbtrqa/cli (needs npm auth — see SETUP.md)
```

See [SETUP.md](./SETUP.md) for npm/GitHub auth (no manual rsync).
