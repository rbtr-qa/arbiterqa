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
The skill under `skills/arbiterqa/` is a published copy — do not edit it here.
## Validate
```bash
claude plugin validate ./plugins/arbiterqa
```
