# oed-mcp

**openEuler Infra gateway as local MCP tools.**

A zero-dependency [MCP](https://modelcontextprotocol.io) server (stdio) that
exposes the [`oed` CLI](https://gitcode.com/openeuler/oed-cli) — openEuler's
unified CLI for every community online service — to any local MCP client:
Claude Code, Cursor, Trae, Cline, Codex CLI, Gemini CLI, and friends.

Same three tools and the same model-facing contracts as
[`dsh-plugin-oed`](https://gitcode.com/hourunze/dsh-plugin-oed), in the
transport-agnostic envelope.

## Prerequisites

```bash
node >= 18                 # only to run this server
```

The `oed` CLI is picked up from PATH. Not installed? The server bootstraps
itself — in order: `uvx --from oed-cli oed` (ephemeral venv, no system
changes; first run downloads the package from PyPI), or a one-shot
`pip install --user oed-cli`. Opt out with `OED_MCP_AUTO_INSTALL=0` and a
missing `oed` becomes a clear error telling you (or the model) to install it.

## Install

After `npm i -g oed-mcp` (or use the `npx -y oed-mcp` form below):

**Claude Code**

```bash
claude mcp add oed -- oed-mcp
```

**Cursor / Trae / Cline — `mcp.json`**

```json
{
  "mcpServers": {
    "oed": { "command": "npx", "args": ["-y", "oed-mcp"] }
  }
}
```

**Any client with a raw command** — the server is a plain stdio process:

```bash
oed-mcp          # JSON-RPC 2.0, one message per line, on stdin/stdout
```

**dsh** — two ways:

Install as a plugin (appears on the Plugins page; dsh applies the bundled
patch automatically):

```bash
dsh plugin add oed-mcp
```

Or hand-wire the patch (a new Cordis entry must use `- insert:` — top-level
patch entries only override existing ones):

```yaml
- insert:
    - id: mcp-oed
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: oed
        transport: stdio
        command: npx
        args: ['-y', 'oed-mcp']
```

## Tools

| Tool | Purpose |
|---|---|
| `oed_services` | List every discovered openEuler service (name, base_url, description). |
| `oed_describe` | Per-service operation list, or per-operation flag cheatsheet (`--flags`, required markers, `body_schema` for POST/PUT/PATCH). |
| `oed_call` | Invoke one operation: `params` = query/path params object, `body` = JSON request body (top-level fields from `body_schema`), `dry_run` = preview without network. |

Notes baked into the tool descriptions so the model can't trip on them: forum
`Api-Key`/`Api-Username` are gateway-managed (never pass them), `ag` (AtomGit)
calls need `oed ag login` once, and body fields only ever go in `body`.

## Auth model

This server is **local by design**: it runs on your machine, so authentication
uses your own oed credentials (`oed ag login` → OS keyring). Most gateway
endpoints (CVE, packages, forum reads, mailman, search, SIG docs) are
anonymous; only `ag` operations need the login. Cloud/remote MCP deployments
are out of scope here on purpose.

## Layout

One file, zero npm dependencies: `index.js` speaks newline-delimited
JSON-RPC 2.0 over stdio (the MCP stdio transport) and forwards every tool call
to `execFile('oed', ...)` — oed's JSON stdout goes to the model verbatim, its
fixed exit codes (0 ok / 1 user error / 2 network / 3 upstream / 4 not found)
surface as `isError` tool results.
