# oed-mcp

**openEuler Infra gateway as local MCP tools.**

A zero-dependency [MCP](https://modelcontextprotocol.io) server (stdio) that
exposes the [`oed` CLI](https://gitcode.com/openeuler/oed-cli) — openEuler's
unified CLI for every community online service — to any local MCP client:
Claude Code, Cursor, Trae, Cline, Codex CLI, Gemini CLI, and friends.

Same three tools and the same model-facing contracts as
[`dsh-plugin-oed`](https://gitcode.com/hourunze/dsh-plugin-oed), in the
transport-agnostic envelope.

## Quickstart

One prerequisite: **Node ≥ 18**. That's all — the server fetches the `oed`
CLI by itself on first use (via `uvx`, or a one-shot `pip install --user`),
or uses it from PATH if you already have it.

**Claude Code**

```bash
claude mcp add oed -- npx -y oed-mcp
```

**Cursor / Trae / Cline** — put this in the client's `mcp.json`
(Cursor: `~/.cursor/mcp.json`; Trae: `~/.trae/mcp.json` intl /
`~/.trae-cn/mcp.json` CN):

```json
{
  "mcpServers": {
    "oed": { "command": "npx", "args": ["-y", "oed-mcp"] }
  }
}
```

**Cursor CLI from scratch**

```bash
curl https://cursor.com/install -fsS | bash   # install the CLI
cursor-agent login                            # one-time browser auth
# then write ~/.cursor/mcp.json as above
```

**dsh**

```bash
dsh plugin add oed-mcp
```

**Gemini CLI / Qwen Code** — this repo ships `gemini-extension.json` /
`qwen-extension.json`:

```bash
gemini extensions install Hourunze1997/oed-mcp   # or: qwen extensions install ...
```

**Claude Code plugin** — this repo is also a plugin marketplace (bundles the
`oed-cli` Agent Skill + the MCP server):

```
/plugin marketplace add Hourunze1997/oed-mcp
/plugin install oed@oed-marketplace
```

**Verify** — ask your client:

> 查一下 CVE-2019-10082 在 openEuler 的安全公告编号和严重程度

Expect it to call `oed_describe` → `oed_call` and answer
**openEuler-SA-2020-1002 / Medium**.

Everything above works anonymously (CVE, packages, forum, mailman, search).
Only AtomGit (`ag`) operations need `oed ag login` once — the token is stored
in the OS keyring.

## Manual setup

**Any client with a raw command** — the server is a plain stdio process:

```bash
oed-mcp          # JSON-RPC 2.0, one message per line, on stdin/stdout
```

**dsh, hand-wired** — equivalent to `dsh plugin add`, if you'd rather edit the
patch yourself (a new Cordis entry must use `- insert:` — top-level patch
entries only override existing ones):

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

## Bootstrap behavior

Runner resolution order: `oed` on PATH → `uvx --from oed-cli oed` (ephemeral
venv, nothing system-wide changes) → one-shot `pip install --user oed-cli`.
Runner successes are cached; failures are not — install `oed` mid-session and
the next call just works. Set `OED_MCP_AUTO_INSTALL=0` to disable all
automatic installation and get an actionable error instead.

## Auth model

This server is **local by design**: it runs on your machine, so authentication
uses your own oed credentials (`oed ag login` → OS keyring). Most gateway
endpoints (CVE, packages, forum reads, mailman, search, SIG docs) are
anonymous; only `ag` operations need the login. Cloud/remote MCP deployments
are out of scope here on purpose.

## Layout

One file, zero npm dependencies: `index.js` speaks newline-delimited
JSON-RPC 2.0 over stdio (the MCP stdio transport), forwards every tool call to
the resolved `oed` runner — oed's JSON stdout goes to the model verbatim, its
fixed exit codes (0 ok / 1 user error / 2 network / 3 upstream / 4 not found)
surface as `isError` tool results. A dsh bundle patch (`cordis.patch.yml`)
makes the same package installable with `dsh plugin add`.
