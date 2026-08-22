# ArbiterQA Claude Code plugin

Local marketplace entry for development. Customer distribution requires copying
`plugins/` to a **public** git host (this repo is private).

## Develop

```bash
claude --plugin-dir ./plugins/arbiterqa
# or
claude plugin marketplace add "$(pwd)/plugins"
claude plugin install arbiterqa@arbiterqa-plugins
```

Enable the plugin and paste an API key from `npx arbiterqa login` / `print-key`.

Skill prose under `skills/arbiterqa/` is **generated** by `bun run skills:project`
from the canonical tree `skills/arbiterqa/` — do not edit the copy here.

## Validate

```bash
claude plugin validate ./plugins/arbiterqa
```
