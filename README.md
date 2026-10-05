# ArbiterQA distribution (`rbtr-qa/arbiterqa`)

Public home for **`npx @rbtrqa/cli`**, the agent skill, and the Claude Code plugin.

## Claude

- **Claude Code**: `/plugin marketplace add rbtr-qa/arbiterqa`, then `/plugin install arbiterqa@arbiterqa`. The plugin carries the skill and the MCP server; the first tool call opens an ArbiterQA sign-in.
- **claude.ai, Claude Desktop, mobile**: Settings → Connectors → Add custom connector → `https://api.arbiterqa.com/mcp/claude`, then sign in.

## npm (Cursor, Codex, Gemini, AGENTS.md)

```sh
npx @rbtrqa/cli install
npx @rbtrqa/cli login
```

## Releasing

See [SETUP.md](./SETUP.md).
