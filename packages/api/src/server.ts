import Fastify, { type FastifyInstance } from "fastify";
import { registerBuiltInNodes } from "@hermes/nodes";
import {
  executeWorkflow,
  nodeRegistry,
  type Workflow,
  validateWorkflow,
} from "@hermes/core";

export interface AppOptions {
  logger?: boolean;
}

/**
 * Build the Fastify application without starting a listener. Keeping construction
 * separate from startup makes the API easy to exercise with Fastify's inject API
 * and prevents imports from unexpectedly opening a port.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  registerBuiltInNodes();

  const app = Fastify({ logger: options.logger ?? true });

  app.get("/", async () => ({
    name: "Hermes API",
    endpoints: {
      health: "GET /health",
      nodes: "GET /nodes",
      execute: "POST /workflows/execute",
    },
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/nodes", async () =>
    nodeRegistry.values().map((nodeType) => ({ ...nodeType.description }))
  );

  /**
   * POST /workflows/execute
   * Body: a full Workflow JSON object.
   * Runs it immediately and returns the execution result.
   */
  app.post("/workflows/execute", async (request, reply) => {
    const body = request.body as unknown;
    const issues = validateWorkflow(body);
    if (issues.length > 0) {
      return reply.status(400).send({
        error: "Request body must be a valid Workflow JSON object.",
        issues,
      });
    }

    const result = await executeWorkflow(body as Workflow);
    // A syntactically valid workflow can still fail at runtime (unknown node type,
    // a cycle, a node error, etc.). Use 422 so clients can distinguish that from
    // a successful run while retaining the detailed execution result.
    if (result.status === "error") {
      return reply.status(422).send(result);
    }
    return reply.send(result);
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
