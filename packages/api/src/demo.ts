import { registerBuiltInNodes } from "@hermes/nodes";
import { executeWorkflow, type Workflow } from "@hermes/core";

registerBuiltInNodes();

/**
 * A tiny sample workflow:
 * Manual Trigger -> Set (adds a "message" field) -> IF (branch on message length) -> Code (transform)
 */
const sampleWorkflow: Workflow = {
  id: "wf_demo",
  name: "Demo Workflow",
  nodes: [
    { id: "trigger", name: "Manual Trigger", type: "hermes.manualTrigger", parameters: {} },
    {
      id: "setNode",
      name: "Set Message",
      type: "hermes.set",
      parameters: { fields: { message: "Hello from Hermes" } },
    },
    {
      id: "ifNode",
      name: "Check Length",
      type: "hermes.if",
      parameters: { field: "message", operator: "contains", value: "Hermes" },
    },
    {
      id: "codeNode",
      name: "Shout It",
      type: "hermes.code",
      parameters: {
        code: "return items.map(i => ({ json: { ...i.json, shouted: i.json.message.toUpperCase() } }));",
      },
    },
  ],
  connections: [
    { from: "trigger", to: "setNode" },
    { from: "setNode", to: "ifNode" },
    { from: "ifNode", to: "codeNode", fromOutput: 0 }, // true branch only
  ],
};

executeWorkflow(sampleWorkflow).then((result) => {
  console.log(JSON.stringify(result, null, 2));
});
