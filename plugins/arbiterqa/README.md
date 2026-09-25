# ArbiterQA Claude Code plugin
Local marketplace entry for development. Customer distribution is the public repo
**github.com/rbtr-qa/arbiterqa**.
## Develop
```bash
claude --plugin-dir ./plugins/arbiterqa
# or
claude plugin marketplace add "$(pwd)/plugins"
claude plugin install arbiterqa@rbtr-plugins
```
Enable the plugin and paste an API key from `npx @rbtrqa/cli login` / `print-key`.
Skill prose under `skills/arbiterqa/` is **generated** by `bun run skills:project`
from the canonical tree `skills/arbiterqa/` — do not edit the copy here.
## Validate
```bash
claude plugin validate ./plugins/arbiterqa
```
