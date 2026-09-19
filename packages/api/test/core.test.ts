import assert from "node:assert/strict";
import { test } from "node:test";
import { executeWorkflow } from "@hermes/core";
import { registerBuiltInNodes } from "@hermes/nodes";

registerBuiltInNodes();

test("IF routes items to the selected branch and preserves item data", async () => {
  const result = await executeWorkflow({
    id: "branching-workflow",
    name: "Branching workflow",
    nodes: [
      { id: "trigger", name: "Trigger", type: "hermes.manualTrigger", parameters: {} },
      {
        id: "set",
        name: "Set",
        type: "hermes.set",
        parameters: { fields: { status: "ready" } },
      },
      {
        id: "if",
        name: "Condition",
        type: "hermes.if",
        parameters: { field: "status", operator: "equals", value: "ready" },
      },
      {
        id: "trueSet",
        name: "True branch",
        type: "hermes.set",
        parameters: { fields: { branch: "true" } },
      },
      {
        id: "falseSet",
        name: "False branch",
        type: "hermes.set",
        parameters: { fields: { branch: "false" } },
      },
    ],
    connections: [
      { from: "trigger", to: "set" },
      { from: "set", to: "if" },
      { from: "if", to: "trueSet", fromOutput: 0 },
      { from: "if", to: "falseSet", fromOutput: 1 },
    ],
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.nodeResults.trueSet.outputItems?.[0][0].json, {
    triggeredAt: result.nodeResults.trigger.outputItems?.[0][0].json.triggeredAt,
    status: "ready",
    branch: "true",
  });
  assert.deepEqual(result.nodeResults.falseSet.outputItems?.[0], []);
});

test("Code node copies its result back from the sandbox", async () => {
  const result = await executeWorkflow({
    id: "code-workflow",
    name: "Code workflow",
    nodes: [
      { id: "trigger", name: "Trigger", type: "hermes.manualTrigger", parameters: {} },
      {
        id: "code",
        name: "Transform",
        type: "hermes.code",
        parameters: {
          code: "return items.map(item => ({ json: { ...item.json, transformed: true } }));",
        },
      },
    ],
    connections: [{ from: "trigger", to: "code" }],
  });

  assert.equal(result.status, "success");
  assert.equal(result.nodeResults.code.outputItems?.[0][0].json.transformed, true);
});

test("executor returns a useful error for a cycle instead of hanging", async () => {
  const result = await executeWorkflow({
    id: "cyclic-workflow",
    name: "Cyclic workflow",
    nodes: [
      { id: "one", name: "One", type: "hermes.set", parameters: {} },
      { id: "two", name: "Two", type: "hermes.set", parameters: {} },
    ],
    connections: [
      { from: "one", to: "two" },
      { from: "two", to: "one" },
    ],
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /unresolved dependencies/);
  assert.deepEqual(result.nodeResults, {});
});

test("executor validates unknown connection endpoints before running nodes", async () => {
  const result = await executeWorkflow({
    id: "invalid-workflow",
    name: "Invalid workflow",
    nodes: [{ id: "node", name: "Node", type: "hermes.set", parameters: {} }],
    connections: [{ from: "missing", to: "node" }],
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /unknown node/);
  assert.deepEqual(result.nodeResults, {});
});
