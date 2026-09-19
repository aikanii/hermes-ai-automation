# Hermes

An open, self-hostable workflow automation engine, a from-scratch build in the spirit of n8n.

Hermes lets you define workflows as a graph of **nodes** (trigger, HTTP request, transform, conditional
branch, custom code, etc.) connected together, and executes them by passing **items** (arrays of JSON
objects) from node to node.

This repo currently implements **Phase 0**: a testable core execution engine, a handful of built-in node
types, workflow validation, and a minimal HTTP API to run workflows. No UI yet; workflows are plain JSON.

## Project structure

```
packages/
  core/     Framework-agnostic workflow engine (types, graph execution, node registry)
  nodes/    Built-in node implementations (Manual Trigger, HTTP Request, Set, IF, Code)
  api/      Fastify server + a standalone demo script
examples/
  sample-workflow.json   A working example workflow
```

## Requirements (all free)

- Node.js 20+
- pnpm (`npm install -g pnpm`)

## Setup

```bash
pnpm install
```

## Run the demo (no server needed)

Executes the sample workflow directly and prints the result:

```bash
pnpm demo
```

## Run the API server

```bash
pnpm dev:api
```

Then, in another terminal:

```bash
curl -X POST http://localhost:3000/workflows/execute \
  -H "Content-Type: application/json" \
  -d @examples/sample-workflow.json
```

The API also exposes `GET /health` and `GET /nodes`. Invalid workflow JSON returns `400` with an
`issues` array; a valid workflow that cannot execute (for example, because it contains a cycle or an
unknown node type) returns `422` with the complete execution result.

## Development checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

The tests use Fastify's in-process request injection, so they do not need a running API server.

## How the engine works

1. A **Workflow** is JSON: a list of `nodes` and a list of `connections` (edges between node ids).
2. The workflow is validated before execution. Nodes with no incoming connections (triggers) run first,
   and may receive optional root input supplied to `executeWorkflow`.
3. Once a node finishes, its output items become available to whatever node(s) it's connected to. Empty
   branches stay empty; they do not create phantom items in downstream nodes.
4. A node type implements `{ description, execute(items, ctx) }` and returns an array of **output
   branches** — most nodes return one branch (`[items]`), but branching nodes like `IF` return two
   (`[trueItems, falseItems]`), matching how n8n itself models branching.
5. Adding a new integration means writing one new file that implements `INodeType` and registering it —
   no changes to the engine required. The built-in registration helper is idempotent, which is useful
   for tests and hot reloads.

## Built-in nodes (Phase 0)

| Node | Type identifier | Purpose |
|---|---|---|
| Manual Trigger | `hermes.manualTrigger` | Starts a workflow run |
| HTTP Request | `hermes.httpRequest` | Calls any REST API |
| Set | `hermes.set` | Adds/overwrites fields on items |
| IF | `hermes.if` | Branches items into true/false paths |
| Code | `hermes.code` | Runs sandboxed custom JS (via `isolated-vm`) |

## Roadmap

- **Phase 1** — Visual builder: React + React Flow canvas, save/load workflows, live execution status
- **Phase 2** — Triggers & persistence: webhook & cron triggers, Postgres-backed execution history, retries
- **Phase 3** — Integrations: standardized Node SDK, Slack/Gmail/Sheets/Postgres/OpenAI nodes, etc.
- **Phase 4** — SaaS multi-tenancy: auth, encrypted per-tenant credentials, usage metering, isolated queues (Redis + BullMQ)
- **Phase 5** — AI-agent nodes: LLM call, prompt chaining, tool-calling agents

## License

TBD — recommend a fair-code style license (similar to n8n's own licensing approach) if Hermes will be
offered as both self-hosted and hosted SaaS.
