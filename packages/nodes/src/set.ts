import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";

/**
 * Set: adds/overwrites fields on every item passing through.
 * Parameters:
 *  - fields: Record<string, unknown> - key/value pairs to merge into each item's json.
 */
export const SetNode: INodeType = {
  description: {
    name: "hermes.set",
    displayName: "Set",
    description: "Sets (adds or overwrites) fields on each item.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const fields = ctx.getParameter<Record<string, unknown>>("fields", {});
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error("Set node: 'fields' parameter must be an object.");
    }

    // A standalone Set node is treated as a root and gets one seed item. An empty
    // upstream branch, however, must stay empty instead of creating phantom data.
    const itemsToProcess = input.length > 0 || !ctx.isRoot ? input : [{ json: {} }];

    const output = itemsToProcess.map((item) => ({
      // Keep binary data and any future item metadata while replacing only json.
      ...item,
      json: { ...item.json, ...fields },
    }));

    return [output];
  },
};
