# ArbiterQA

**The best damn QA agent in the world for emails and webpages.**

ArbiterQA is headless and agent-native: your coding agent sends any email or
webpage, runs opinionated visual and functional validations, and gets back
**pass, fail, or error — with evidence**. This package teaches your agent how.

## Install

From your project root:

```sh
npx arbiterqa install
```

This detects your coding agent (Claude Code, Cursor, Codex CLI, Gemini CLI —
or a plain `AGENTS.md`) and installs the ArbiterQA skill: instructions your
agent reads to discover validations, run jobs, and interpret results. When it
finds Cursor, it also writes a remote **MCP** entry into `.cursor/mcp.json`
(so the agent can call typed tools without raw HTTP).

Then log in (creates your account on first run):

```sh
npx arbiterqa login
```

That's it. Ask your agent things like *"run ArbiterQA on this landing page
before we ship"* or *"QA this email template"*.

## MCP server

ArbiterQA is also a **remote MCP server**. Agents that speak MCP get typed
tools instead of assembling HTTP themselves.

```
https://api.arbiterqa.com/mcp
```

Streamable HTTP. Discovery tools (`search_validations`, `get_validation`,
`recommend_checks`, `list_validations`, …) need **no key**. Estimate, run,
account, and feedback tools need a Bearer API key from `npx arbiterqa login`.

Protected-resource metadata (RFC 9728):

```
https://api.arbiterqa.com/.well-known/oauth-protected-resource/mcp
```

### Cursor / MCP host config

`npx arbiterqa install` writes this when `.cursor/` is present. You can also
paste it yourself (set `ARBITER_API_KEY` from `npx arbiterqa print-key`):

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

Prefer MCP when your host supports it; use the HTTP API (and this skill) when
it does not.

## Commands

| Command | What it does |
| --- | --- |
| `npx arbiterqa install` | Install the skill (and Cursor MCP entry) into detected agent harnesses |
| `npx arbiterqa update` | Refresh a previous install to the latest skill / MCP config |
| `npx arbiterqa login` | Browser device-flow login; stores an API key in `~/.config/arbiter/hosts.json` (chmod 600) |
| `npx arbiterqa status` | Show who is logged in, on which API host |
| `npx arbiterqa print-key` | Print the stored API key (for scripts/CI) |
| `npx arbiterqa logout` | Forget the local credential and revoke the key (says so plainly if revocation needs the dashboard) |

Options: `--api <url>` / `ARBITER_API_URL` to target a different host,
`--name <key name>` on login.

## What gets installed

A single skill folder (instructions + API reference, no code):

- `.claude/skills/arbiterqa/` (Claude Code)
- `.cursor/skills/arbiterqa/` (Cursor)
- `.agents/skills/arbiterqa/` (Codex CLI)
- `.gemini/skills/arbiterqa/` (Gemini CLI)
- or an `ArbiterQA` section appended to `AGENTS.md`

Plus, when `.cursor/` exists:

- `.cursor/mcp.json` — remote MCP server entry for `https://api.arbiterqa.com/mcp`
  (merged into an existing file; never deletes other servers)

Re-running `install`/`update` replaces only these managed locations.

## Requirements

Node ≥ 18.17 (for `npx` and built-in `fetch`). The skill itself has no runtime
dependencies — your agent talks to the ArbiterQA HTTP API or MCP server
directly.

---

https://www.arbiterqa.com · https://api.arbiterqa.com/mcp · https://api.arbiterqa.com/llms.txt
