# ArbiterQA

QA agent for email and webpages that checks against the [SchemaFirst.org](https://schemafirst.org) open GTM standard and your brand specifications, returning pass / fail verdicts with evidence.

## Install

```sh
npx @rbtrqa/cli install
npx @rbtrqa/cli login
```

`install` detects your coding agent (Claude Code, Cursor, Codex CLI, Gemini CLI, or a plain `AGENTS.md`) and adds the ArbiterQA skill. `login` creates your account on first run and stores an API key.

## MCP

```json
{
  "mcpServers": {
    "arbiterqa": {
      "url": "https://api.arbiterqa.com/mcp",
      "headers": {
        "Authorization": "Bearer ${ARBITER_API_KEY}"
      }
    }
  }
}
```

Discovery tools need no key. Estimate, run and account tools need the key from `npx @rbtrqa/cli print-key`.

## Links

- [Website](https://www.arbiterqa.com)
- [Validation catalog](https://www.arbiterqa.com/validations)
- [Developers](https://www.arbiterqa.com/developers)
- [llms.txt](https://www.arbiterqa.com/llms.txt)

## Commands

| Command | What it does |
|
