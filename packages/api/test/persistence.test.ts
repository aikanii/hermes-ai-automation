import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/server";

const storedWorkflow = {
  id: "persisted-workflow",
  name: "Persisted workflow",
  active: true,
  nodes: [
    { id: "trigger", name: "Manual Trigger", type: "hermes.manualTrigger", parameters: {} },
  ],
  connections: [],
};

test("workflows can be saved, listed, executed, updated, and deleted", async () => {
  const app = buildApp({ logger: false, storePath: ":memory:" });
  try {
    const created = await app.inject({ method: "POST", url: "/workflows", payload: storedWorkflow });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, storedWorkflow.id);
    assert.equal(typeof created.json().createdAt, "string");

    const list = await app.inject({ method: "GET", url: "/workflows" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);
    assert.equal(list.json()[0].name, storedWorkflow.name);

    const fetched = await app.inject({ method: "GET", url: `/workflows/${storedWorkflow.id}` });
    assert.equal(fetched.statusCode, 200);
    assert.deepEqual(fetched.json().nodes, storedWorkflow.nodes);

    const execution = await app.inject({
      method: "POST",
      url: `/workflows/${storedWorkflow.id}/execute`,
      payload: {},
    });
    assert.equal(execution.statusCode, 200);
    assert.equal(execution.json().status, "success");

    const updated = await app.inject({
      method: "PUT",
      url: `/workflows/${storedWorkflow.id}`,
      payload: { ...storedWorkflow, name: "Updated workflow" },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().name, "Updated workflow");

    const deleted = await app.inject({ method: "DELETE", url: `/workflows/${storedWorkflow.id}` });
    assert.equal(deleted.statusCode, 204);

    const missing = await app.inject({ method: "GET", url: `/workflows/${storedWorkflow.id}` });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});
