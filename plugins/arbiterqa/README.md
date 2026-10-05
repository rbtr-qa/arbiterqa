# ArbiterQA plugin for Claude Code

QA webpages, HTML and emails from Claude Code: a pass, fail or error verdict per check, with the
evidence behind it.

## Install

```text
/plugin marketplace add rbtr-qa/arbiterqa
/plugin install arbiterqa@arbiterqa
```

The plugin brings the ArbiterQA skill and the ArbiterQA MCP server
(`https://api.arbiterqa.com/mcp/claude`). The first tool call opens an ArbiterQA sign-in in your
browser — sign in or create a free account, approve, and you're connected. No key to copy.
Disconnect any time under Keys & Connections at https://app.arbiterqa.com/settings/keys.

## CI and headless use

Where nobody can sign in, use an API key against the key endpoint instead:

```sh
claude mcp add --transport http arbiterqa https://api.arbiterqa.com/mcp \
  --header "Authorization: Bearer $ARBITER_API_KEY"
```

Get a key with `npx @rbtrqa/cli login`, then `npx @rbtrqa/cli print-key`.

## Develop

```sh
claude --plugin-dir ./plugins/arbiterqa
claude plugin validate ./plugins/arbiterqa
```

Everything in this folder except this README is generated from the canonical skill; edit the
skill, not the copy.
