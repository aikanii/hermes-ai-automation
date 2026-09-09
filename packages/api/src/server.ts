import Fastify from "fastify";
import { registerBuiltInNodes } from "@hermes/nodes";
import { executeWorkflow, type Workflow } from "@hermes/core";

registerBuiltInNodes();

const app = Fastify({ logger: true });

/**
 * POST /workflows/execute
 * Body: a full Workflow JSON object.
 * Runs it immediately and returns the execution result.
 *
 * This is deliberately the simplest possible entry point for Phase 0.
 * Phase 2 will add: POST /workflows (save), GET /workflows/:id, webhook-triggered
 * execution, and queued (BullMQ) execution instead of running inline on the request.
 */
app.post("/workflows/execute", async (request, reply) => {
  const workflow = request.body as Workflow;

  if (!workflow || !workflow.nodes) {
    return reply.status(400).send({ error: "Request body must be a valid Workflow JSON object." });
  }

  const result = await executeWorkflow(workflow);
  return reply.send(result);
});

app.get("/health", async () => ({ status: "ok" }));

const PORT = Number(process.env.PORT ?? 3000);

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`Hermes API listening on port ${PORT}`);
});
