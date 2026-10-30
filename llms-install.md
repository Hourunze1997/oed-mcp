# oed-mcp — Agent Installation Guide

oed-mcp is a local stdio MCP server exposing the openEuler Infra gateway
(CVE security notices, packages, forum, mailman, search, issues) as MCP tools.

## Install

Node.js >= 18 required. Run with npx (no global install needed):

```bash
npx -y oed-mcp
```

Register it in your MCP client config as a stdio server:

```json
{
  "mcpServers": {
    "oed-mcp": {
      "command": "npx",
      "args": ["-y", "oed-mcp"]
    }
  }
}
```

## Auto-bootstrap

On first start the server checks for the `oed` CLI (openEuler Infra command
line, `pip install oed-cli`). If missing, it installs it automatically via pip.
No environment variables or API keys are required.

## Verify

Start the server on stdio and call the `list_services` tool; it should return
the openEuler community service list (cve, forum, mailman, search, ...).
Anonymous access works for cve / search / mailman / quickissue / easysoftware.
Other services need an openEuler token (`oed auth login` on the CLI side).
