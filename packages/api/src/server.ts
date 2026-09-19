import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { registerBuiltInNodes } from "@hermes/nodes";
import {
  executeWorkflow,
  nodeRegistry,
  type ExecuteWorkflowOptions,
  type HermesCredentials,
  type Workflow,
  validateWorkflow,
} from "@hermes/core";
import { FileWorkflowStore, type WorkflowStore } from "./workflow-store";

export interface AppOptions {
  logger?: boolean;
  /** Inject a repository in tests or a deployment with a different storage backend. */
  store?: WorkflowStore;
  /** Path for the default JSON-backed repository; `:memory:` disables persistence. */
  storePath?: string;
}

interface ExecutionPayload {
  workflow: unknown;
  options: ExecuteWorkflowOptions;
  issues: Array<{ path: string; message: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCredentials(value: unknown): HermesCredentials | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const credentials: HermesCredentials = {};
  for (const [name, credential] of Object.entries(value)) {
    if (!isRecord(credential)) {
      return undefined;
    }
    credentials[name] = credential;
  }
  return credentials;
}

function parseExecutionPayload(body: unknown): ExecutionPayload {
  // Both forms are accepted:
  //   { id, name, nodes, connections }
  //   { workflow: { ... }, inputItems, credentials }
  const isEnvelope = isRecord(body) && isRecord(body.workflow) && !Array.isArray(body.nodes);
  const source = isEnvelope ? body : isRecord(body) ? body : {};
  const workflow = isEnvelope ? body.workflow : body;
  const issues: Array<{ path: string; message: string }> = [];

  let inputItems: ExecuteWorkflowOptions["inputItems"];
  if (source.inputItems !== undefined) {
    if (!Array.isArray(source.inputItems)) {
      issues.push({ path: "inputItems", message: "must be an array when provided" });
    } else {
      inputItems = source.inputItems as ExecuteWorkflowOptions["inputItems"];
    }
  }

  let credentials: HermesCredentials | undefined;
  if (source.credentials !== undefined) {
    credentials = parseCredentials(source.credentials);
    if (!credentials) {
      issues.push({ path: "credentials", message: "must be an object of credential objects" });
    }
  }

  return {
    workflow,
    options: { inputItems, credentials },
    issues,
  };
}

function sendExecutionResult(reply: FastifyReply, result: Awaited<ReturnType<typeof executeWorkflow>>) {
  if (result.status === "error") {
    return reply.status(422).send(result);
  }
  return reply.send(result);
}

function storedWorkflowResponse(stored: Awaited<ReturnType<WorkflowStore["get"]>>) {
  if (!stored) {
    return undefined;
  }
  return {
    ...stored.workflow,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

/**
 * Build the Fastify application without starting a listener. Keeping construction
 * separate from startup makes the API easy to exercise with Fastify's inject API
 * and prevents imports from unexpectedly opening a port.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  registerBuiltInNodes();
  const store = options.store ?? new FileWorkflowStore(options.storePath);
  const app = Fastify({ logger: options.logger ?? true });

  app.get("/", async () => ({
    name: "Hermes API",
    endpoints: {
      health: "GET /health",
      nodes: "GET /nodes",
      workflows: "GET /workflows",
      execute: "POST /workflows/execute",
    },
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/nodes", async () =>
    nodeRegistry.values().map((nodeType) => ({ ...nodeType.description }))
  );

  app.get("/workflows", async () => store.list());

  app.post("/workflows", async (request, reply) => {
    const workflow = request.body as unknown;
    const issues = validateWorkflow(workflow);
    if (issues.length > 0) {
      return reply.status(400).send({ error: "Workflow is invalid.", issues });
    }

    const stored = await store.upsert(workflow as Workflow);
    return reply.status(201).send(storedWorkflowResponse(stored));
  });

  app.get<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const stored = await store.get(request.params.id);
    if (!stored) {
      return reply.status(404).send({ error: `Workflow "${request.params.id}" was not found.` });
    }
    return reply.send(storedWorkflowResponse(stored));
  });

  app.put<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const workflow = request.body as unknown;
    const issues = validateWorkflow(workflow);
    if (issues.length > 0) {
      return reply.status(400).send({ error: "Workflow is invalid.", issues });
    }
    if ((workflow as Workflow).id !== request.params.id) {
      return reply.status(400).send({
        error: "Workflow id in the body must match the id in the URL.",
      });
    }

    const stored = await store.upsert(workflow as Workflow);
    return reply.send(storedWorkflowResponse(stored));
  });

  app.delete<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const deleted = await store.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: `Workflow "${request.params.id}" was not found.` });
    }
    return reply.status(204).send();
  });

  /**
   * POST /workflows/execute
   * Body: a full Workflow JSON object, or an envelope with workflow, inputItems,
   * and per-run credentials. Credentials are never written to the workflow store.
   */
  app.post("/workflows/execute", async (request, reply) => {
    const payload = parseExecutionPayload(request.body as unknown);
    const workflowIssues = validateWorkflow(payload.workflow);
    const issues = [...payload.issues, ...workflowIssues];
    if (issues.length > 0) {
      return reply.status(400).send({
        error: "Request body must be a valid workflow execution request.",
        issues,
      });
    }

    const result = await executeWorkflow(payload.workflow as Workflow, payload.options);
    return sendExecutionResult(reply, result);
  });

  app.post<{ Params: { id: string } }>("/workflows/:id/execute", async (request, reply) => {
    const stored = await store.get(request.params.id);
    if (!stored) {
      return reply.status(404).send({ error: `Workflow "${request.params.id}" was not found.` });
    }

    const body = request.body === undefined ? {} : request.body;
    const payload = parseExecutionPayload(body);
    const issues = payload.issues;
    if (isRecord(body) && body.workflow !== undefined) {
      issues.push({ path: "workflow", message: "is not accepted on a stored-workflow execute request" });
    }
    if (issues.length > 0) {
      return reply.status(400).send({ error: "Invalid execution options.", issues });
    }

    const result = await executeWorkflow(stored.workflow, payload.options);
    return sendExecutionResult(reply, result);
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  console.log(`Hermes API listening on ${host}:${port}`);
  return app;
}

if (require.main === module) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
