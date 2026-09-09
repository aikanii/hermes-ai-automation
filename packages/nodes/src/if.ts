import type { INodeType, HermesItems, NodeExecuteContext, HermesItem } from "@hermes/core";

/**
 * If: splits items into two output branches (index 0 = true, index 1 = false)
 * based on a simple field comparison. This mirrors n8n's IF node behavior.
 *
 * Parameters:
 *  - field: string  -> dot-path into item.json, e.g. "statusCode"
 *  - operator: "equals" | "notEquals" | "greaterThan" | "lessThan" | "contains"
 *  - value: unknown -> value to compare against
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export const IfNode: INodeType = {
  description: {
    name: "hermes.if",
    displayName: "IF",
    description: "Routes each item to a 'true' or 'false' branch based on a condition.",
    outputs: 2,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const field = ctx.getParameter<string>("field");
    const operator = ctx.getParameter<string>("operator", "equals");
    const compareValue = ctx.getParameter<unknown>("value");

    if (!field) {
      throw new Error("IF node: 'field' parameter is required.");
    }

    const trueItems: HermesItem[] = [];
    const falseItems: HermesItem[] = [];

    for (const item of input) {
      const actual = getByPath(item.json, field);
      let matches = false;

      switch (operator) {
        case "equals":
          matches = actual === compareValue;
          break;
        case "notEquals":
          matches = actual !== compareValue;
          break;
        case "greaterThan":
          matches = typeof actual === "number" && typeof compareValue === "number" && actual > compareValue;
          break;
        case "lessThan":
          matches = typeof actual === "number" && typeof compareValue === "number" && actual < compareValue;
          break;
        case "contains":
          matches = typeof actual === "string" && typeof compareValue === "string" && actual.includes(compareValue);
          break;
        default:
          throw new Error(`IF node: unknown operator "${operator}"`);
      }

      (matches ? trueItems : falseItems).push(item);
    }

    return [trueItems, falseItems];
  },
};
