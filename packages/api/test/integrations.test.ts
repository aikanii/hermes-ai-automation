import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";
import { executeWorkflow } from "@hermes/core";
import { registerBuiltInNodes } from "@hermes/nodes";

registerBuiltInNodes();

test("Slack, GitHub, chat, and agent nodes use configurable HTTP providers", async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let agentCompletionCount = 0;
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    requests.push({ path: request.url ?? "", body });

    if (request.url === "/v1/chat/completions") {
      agentCompletionCount += 1;
      if (Array.isArray(body.tools) && body.tools.length > 0 && agentCompletionCount === 1) {
        return sendJson(response, {
          model: "test-model",
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-1",
                type: "function",
                function: { name: "get_weather", arguments: JSON.stringify({ city: "Cagayan" }) },
              }],
            },
          }],
        });
      }
      return sendJson(response, {
        model: "test-model",
        choices: [{ message: { role: "assistant", content: "The weather tool says it is warm." } }],
      });
    }
    if (request.url === "/tool") return sendJson(response, { temperature: 30, unit: "C" });
    if (request.url === "/slack") return sendJson(response, { ok: true, ts: "123" });
    if (request.url === "/repos/acme/project/issues") return sendJson(response, { id: 7, title: "Created" });
    response.statusCode = 404;
    return sendJson(response, { error: "not found" });
  });
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const slack = await executeWorkflow({
      id: "slack-test",
      name: "Slack test",
      nodes: [{
        id: "slack",
        name: "Slack",
        type: "hermes.slack",
        parameters: { webhookUrl: `${baseUrl}/slack`, text: "Hello {{$json.name}}" },
      }],
      connections: [],
    }, { inputItems: [{ json: { name: "Ada" } }] });
    assert.equal(slack.status, "success");
    assert.equal(slack.nodeResults.slack.outputItems?.[0][0].json.ok, true);

    const github = await executeWorkflow({
      id: "github-test",
      name: "GitHub test",
      nodes: [{
        id: "github",
        name: "GitHub",
        type: "hermes.github",
        parameters: {
          baseUrl,
          method: "POST",
          path: "repos/acme/project/issues",
          body: { title: "Issue for {{$json.name}}" },
        },
      }],
      connections: [],
    }, { inputItems: [{ json: { name: "Ada" } }] });
    assert.equal(github.status, "success");
    assert.equal(github.nodeResults.github.outputItems?.[0][0].json.github.id, 7);

    const chat = await executeWorkflow({
      id: "chat-test",
      name: "Chat test",
      nodes: [{
        id: "chat",
        name: "AI Chat",
        type: "hermes.ai.chat",
        parameters: { endpoint: `${baseUrl}/v1`, model: "test-model" },
      }],
      connections: [],
    }, { inputItems: [{ json: { prompt: "Say hello" } }] });
    assert.equal(chat.status, "success");
    assert.equal(chat.nodeResults.chat.outputItems?.[0][0].json.response, "The weather tool says it is warm.");

    agentCompletionCount = 0;
    const agent = await executeWorkflow({
      id: "agent-test",
      name: "Agent test",
      nodes: [{
        id: "agent",
        name: "AI Agent",
        type: "hermes.ai.agent",
        parameters: {
          endpoint: `${baseUrl}/v1`,
          model: "test-model",
          maxIterations: 3,
          tools: [{
            name: "get_weather",
            description: "Get the weather for a city.",
            url: `${baseUrl}/tool`,
            method: "GET",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          }],
        },
      }],
      connections: [],
    }, { inputItems: [{ json: { prompt: "What is the weather?" } }] });
    assert.equal(agent.status, "success");
    assert.equal(agent.nodeResults.agent.outputItems?.[0][0].json.response, "The weather tool says it is warm.");

    const slackRequest = requests.find((request) => request.path === "/slack");
    assert.equal(slackRequest?.body.text, "Hello Ada");
    const githubRequest = requests.find((request) => request.path === "/repos/acme/project/issues");
    assert.deepEqual(githubRequest?.body, { title: "Issue for Ada" });
  } finally {
    await close(server);
  }
});

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, body: Record<string, unknown>): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
