#!/usr/bin/env node
// oed-mcp — expose the oed CLI (openEuler Infra gateway) as local MCP tools.
//
// Zero-dependency MCP server speaking newline-delimited JSON-RPC 2.0 over
// stdio (the standard MCP stdio transport). Three tools shell out to `oed`,
// which already guarantees JSON on stdout and fixed exit codes 0/1/2/3/4.
// stdout is the protocol channel only — every log line goes to stderr.

import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline'

const VERSION = '0.1.0'
const OED_TIMEOUT_MS = 180_000
const SERVER_NAME = 'oed-mcp'

// ---------------------------------------------------------------------------
// oed bridge — same design as dsh-plugin-oed: never parse oed's output, hand
// it to the model verbatim. Non-zero exit codes are reported through
// isError so the client renders them as tool failures.

function runOed(args, cb) {
  execFile(
    'oed',
    args,
    { timeout: OED_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const out = String(stdout || '').trim()
      let exitCode = 0
      let text = out
      if (!out) {
        const reason = err?.killed
          ? 'oed call aborted'
          : String(stderr || '').trim() || (err ? `oed failed: ${err.message}` : 'oed produced no output')
        text = reason
      }
      if (err) exitCode = typeof err.code === 'number' ? err.code : 1
      cb({ exitCode, text })
    },
  )
}

function resultFor({ exitCode, text }) {
  if (exitCode === 0) return { content: [{ type: 'text', text }], isError: false }
  // oed prints errors as JSON on stdout too; hand them to the model verbatim
  // with the documented exit code so it can react (retry, login, fix args).
  return { content: [{ type: 'text', text: `oed exit ${exitCode}:\n${text}` }], isError: true }
}

// ---------------------------------------------------------------------------
// Tool definitions — carried over verbatim from dsh-plugin-oed so both
// harnesses teach the model the same contracts and trap rules.

const servicesTool = {
  name: 'oed_services',
  description:
    'List every openEuler community service discovered from the gateway feed ' +
    '(service_name, base_url, description). Call this first for any openEuler ' +
    'task: CVE security notices, packages, forum/discourse, SIG docs, mailman, ' +
    'search, repos, issues.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run(_args, cb) {
    runOed(['services'], cb)
  },
}

const describeTool = {
  name: 'oed_describe',
  description:
    'Describe one oed service or operation. With only `service`: every ' +
    'operationId. With `operation` too: the per-operation cheatsheet — ' +
    'auto-derived --flags, required markers, and for POST/PUT/PATCH the ' +
    'body_schema / body_required_fields needed to build the `body` argument ' +
    'of oed_call.',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'service name, e.g. "cve", "forum", "ag"' },
      operation: { type: 'string', description: 'operationId, e.g. "getSecurityNoticeByCveId"' },
    },
    required: ['service'],
    additionalProperties: false,
  },
  run(args, cb) {
    const op = args.operation ? [args.service, args.operation, '--help'] : [args.service, '--help']
    runOed(op, cb)
  },
}

const callTool = {
  name: 'oed_call',
  description:
    'Invoke one openEuler gateway operation through oed. `params` carries ' +
    'query/path parameters as an object keyed by the spec names (e.g. ' +
    '{"cveId": "CVE-2019-10082"}). `body` carries the JSON request body for ' +
    'POST/PUT/PATCH — top-level fields from body_schema, never body fields ' +
    'inside params. Forum calls need no credentials (gateway-injected); ' +
    '`ag` (AtomGit) calls need "oed ag login" done once. Set dry_run=true ' +
    'to preview the request without network. Prefer describe first when you ' +
    'do not know the flags.',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string' },
      operation: { type: 'string' },
      params: { type: 'object', description: 'query/path parameters object' },
      body: { type: 'object', description: 'JSON request body (POST/PUT/PATCH)' },
      dry_run: { type: 'boolean', description: 'preview the request, no network' },
    },
    required: ['service', 'operation'],
    additionalProperties: false,
  },
  run(args, cb) {
    const cmd = [args.service, args.operation]
    if (args.params && Object.keys(args.params).length > 0) {
      cmd.push('--params', JSON.stringify(args.params))
    }
    if (args.body !== undefined && args.body !== null) {
      cmd.push('--json', JSON.stringify(args.body))
    }
    if (args.dry_run) cmd.push('--dry-run')
    runOed(cmd, cb)
  },
}

const TOOLS = [servicesTool, describeTool, callTool]

// ---------------------------------------------------------------------------
// JSON-RPC / MCP wiring

const LATEST_PROTOCOL = '2025-06-18'
let pending = 0

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      // Echo the client's requested protocol version when present so
      // negotiation always lands on something both sides accept.
      reply(id, {
        protocolVersion: params?.protocolVersion ?? LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          'Tools for the openEuler Infra gateway via the local oed CLI. ' +
          'Typical loop: oed_services to see services, oed_describe for a ' +
          'service/operation contract, oed_call to execute.',
      })
      return
    case 'tools/list':
      reply(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      })
      return
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) {
        replyError(id, -32602, `Unknown tool: ${params?.name}`)
        return
      }
      pending++
      tool.run(params.arguments ?? {}, ({ exitCode, text }) => {
        pending--
        reply(id, resultFor({ exitCode, text }))
        maybeExit()
      })
      return
    }
    case 'ping':
      reply(id, {})
      return
    default:
      if (method?.startsWith('notifications/')) return // no reply for notifications
      replyError(id, -32601, `Method not found: ${method}`)
  }
}

function maybeExit() {
  // stdin closed and all in-flight oed calls settled — leave cleanly.
  if (stdinClosed && pending === 0) process.exit(0)
}

let stdinClosed = false
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    replyError(null, -32700, 'Parse error')
    return
  }
  if (typeof msg?.id === 'undefined' || msg.id === null) return // notification
  handle(msg)
})
rl.on('close', () => {
  stdinClosed = true
  maybeExit()
})

process.stderr.write(`${SERVER_NAME} ${VERSION} ready — tools: ${TOOLS.map((t) => t.name).join(', ')}\n`)
