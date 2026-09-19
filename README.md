# Hermes

An open, self-hostable workflow automation engine, built from scratch in the spirit of n8n.

Hermes lets you define workflows as a graph of **nodes** (trigger, HTTP request, transform, conditional
branch, custom code, integrations, and AI agents) connected together. It executes them by passing
**items** (arrays of JSON objects) from node to node.

The repository now contains a usable Phase 1/2/3/5 MVP: a visual builder, file-backed workflow
persistence, built-in integrations, and OpenAI-compatible chat and tool-calling agent nodes. The larger
roadmap items such as durable queues, execution history, authentication, and multi-tenancy are still
future work.

## Project structure

```
packages/
  core/     Framework-agnostic workflow engine, types, validation, and node registry
  nodes/    Built-in nodes, integrations, and AI-agent implementations
  api/      Fastify API, JSON workflow store, and standalone demo script
  web/      React + React Flow visual workflow builder
examples/
  sample-workflow.json   A working example workflow
```

## Requirements

- Node.js 20+
- pnpm (`npm install -g pnpm`, or use Corepack)

## Setup

```bash
pnpm install
```

## Visual builder

Start the API and builder in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Open <http://localhost:5173>. The builder provides:

- a node palette for core, integration, and AI nodes;
- a React Flow canvas with branch-aware connections;
- a node inspector for names and JSON parameters;
- save/load against the workflow API;
- editable root input items and one-click execution;
- a run result panel and workflow status indicator.

The Vite development server proxies `/workflows`, `/nodes`, and `/health` to the API, so browser code
uses relative URLs and does not depend on `localhost` from the browser.

## Run the demo

The demo executes the sample workflow directly without starting a server:

```bash
pnpm demo
```

## API

Start the API:

```bash
pnpm dev:api
```

Execute a workflow directly:

```bash
curl -X POST http://localhost:3000/workflows/execute \
  -H "Content-Type: application/json" \
  -d @examples/sample-workflow.json
```

The API exposes:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/nodes` | Node catalog used by the builder |
| `GET` | `/workflows` | List saved workflow summaries |
| `POST` | `/workflows` | Create or save a workflow |
| `GET` | `/workflows/:id` | Load a saved workflow |
| `PUT` | `/workflows/:id` | Replace a saved workflow |
| `DELETE` | `/workflows/:id` | Delete a saved workflow |
| `POST` | `/workflows/execute` | Execute an inline workflow |
| `POST` | `/workflows/:id/execute` | Execute a saved workflow |

The default store is `.data/workflows.json`. Set `HERMES_WORKFLOW_STORE` to use another path, or use
`:memory:` in tests. Writes are serialized and atomically renamed to avoid partial JSON files.

Inline execution accepts either a workflow directly or an execution envelope:

```json
{
  "workflow": { "id": "wf_1", "name": "Example", "nodes": [], "connections": [] },
  "inputItems": [{ "json": { "name": "Ada" } }],
  "credentials": {
    "openai": { "apiKey": "do-not-commit-this" }
  }
}
```

Credentials are per-run and are never persisted with saved workflows. For local development, the
nodes also understand environment variables such as `OPENAI_API_KEY`, `SLACK_WEBHOOK_URL`,
`SLACK_BOT_TOKEN`, and `GITHUB_TOKEN`.

Invalid workflow JSON returns `400` with an `issues` array. A valid workflow that cannot execute (for
example, because it contains a cycle, an unknown node type, or a node error) returns `422` with the
complete execution result.

## Built-in nodes

| Node | Type identifier | Purpose |
|---|---|---|
| Manual Trigger | `hermes.manualTrigger` | Starts a workflow run |
| HTTP Request | `hermes.httpRequest` | Calls any REST API with timeout and response handling |
| Set | `hermes.set` | Adds or overwrites fields on items |
| IF | `hermes.if` | Branches items into true/false paths |
| Code | `hermes.code` | Runs sandboxed custom JavaScript via `isolated-vm` |
| Slack | `hermes.slack` | Sends incoming-webhook or `chat.postMessage` messages |
| GitHub | `hermes.github` | Calls the GitHub REST API with optional token credentials |
| AI Chat | `hermes.ai.chat` | Calls an OpenAI-compatible chat-completions endpoint |
| AI Agent | `hermes.ai.agent` | Runs bounded tool-calling loops against explicit HTTP tools |

Integration and AI parameters support simple item templates such as `{{$json.email}}`. AI nodes use
`openai` credentials by default, can target any OpenAI-compatible endpoint with `endpoint`, and accept
`credentialName` for another credential namespace. Agent tools are explicit HTTP actions and are
bounded by `maxIterations` (1–10) and the node timeout.

## Development checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

The test suite uses Fastify's in-process request injection and local HTTP provider stubs, so it does
not call Slack, GitHub, or an external AI provider. The web package is included in the recursive build.

## How the engine works

1. A **Workflow** is JSON: a list of `nodes` and a list of `connections` (edges between node ids).
2. The workflow is validated before execution. Nodes with no incoming connections (triggers) run first,
   and may receive optional root input supplied to `executeWorkflow`.
3. Once a node finishes, its output items become available to whatever node(s) it is connected to.
   Empty branches stay empty; they do not create phantom items in downstream nodes.
4. A node type implements `{ description, execute(items, ctx) }` and returns an array of **output
   branches** — most nodes return one branch (`[items]`), while branching nodes such as IF return two
   (`[trueItems, falseItems]`).
5. Adding a new integration means writing a node that implements `INodeType` and registering it. The
   built-in registration helper is idempotent, which is useful for tests and hot reloads.

## Roadmap

- **Current MVP** — visual builder, JSON persistence, Slack/GitHub integrations, OpenAI-compatible chat,
  and bounded HTTP tool-calling agents.
- **Next** — webhook and cron triggers, execution history, retries, and a Postgres repository.
- **Later** — Gmail/Sheets/Postgres provider nodes, auth, encrypted credential storage, usage metering,
  queues, and multi-tenant isolation.

## License

TBD — recommend a fair-code style license if Hermes will be offered as both self-hosted and hosted SaaS.
