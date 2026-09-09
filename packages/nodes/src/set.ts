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
    const itemsToProcess = input.length > 0 ? input : [{ json: {} }];

    const output = itemsToProcess.map((item) => ({
      json: { ...item.json, ...fields },
    }));

    return [output];
  },
};
