import type { INodeType, HermesItems } from "@hermes/core";

/**
 * ManualTrigger: the equivalent of n8n's "Manual Trigger" node.
 * Has no inputs, and simply emits a single empty item to kick off the workflow.
 */
export const ManualTriggerNode: INodeType = {
  description: {
    name: "hermes.manualTrigger",
    displayName: "Manual Trigger",
    description: "Starts the workflow when run manually (e.g. clicking 'Execute').",
    outputs: 1,
  },
  async execute(_input: HermesItems): Promise<HermesItems[]> {
    return [[{ json: { triggeredAt: new Date().toISOString() } }]];
  },
};
