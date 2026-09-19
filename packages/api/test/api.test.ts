import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/server";

const workflow = {
  id: "test-workflow",
  name: "Test workflow",
  nodes: [
    {
      id: "trigger",
      name: "Manual Trigger",
      type: "hermes.manualTrigger",
      parameters: {},
    },
    {
      id: "set",
      name: "Set value",
      type: "hermes.set",
      parameters: { fields: { value: 42 } },
    },
  ],
  connections: [{ from: "trigger", to: "set" }],
};

test("health and node metadata endpoints are available", async () => {
  const app = buildApp({ logger: false });
  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200);
    assert.equal(root.json().name, "Hermes API");

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: "ok" });

    const nodes = await app.inject({ method: "GET", url: "/nodes" });
    assert.equal(nodes.statusCode, 200);
    assert.deepEqual(
      nodes.json().map((node: { name: string }) => node.name),
      [
        "hermes.manualTrigger",
        "hermes.httpRequest",
        "hermes.set",
        "hermes.if",
        "hermes.code",
      ]
    );
  } finally {
    await app.close();
  }
});

test("execute endpoint runs a valid workflow", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/workflows/execute",
      payload: workflow,
    });

    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.equal(result.status, "success");
    assert.deepEqual(result.nodeResults.set.outputItems, [[{ json: { triggeredAt: result.nodeResults.trigger.outputItems[0][0].json.triggeredAt, value: 42 } }]]);
  } finally {
    await app.close();
  }
});

test("execute endpoint reports validation problems with a 400", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/workflows/execute",
      payload: {
        id: "broken",
        name: "Broken",
        nodes: [],
        connections: [{ from: "missing", to: "also-missing" }],
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "Request body must be a valid Workflow JSON object.");
    assert.ok(body.issues.some((issue: { path: string }) => issue.path === "connections[0].from"));
  } finally {
    await app.close();
  }
});
