import type { INodeType, HermesItems, NodeExecuteContext, HermesItem } from "@hermes/core";

/**
 * If: splits items into two output branches (index 0 = true, index 1 = false)
 * based on a field comparison. This mirrors n8n's IF node behavior.
 *
 * Parameters:
 *  - field: string  -> dot-path into item.json, e.g. "user.status"
 *  - operator: "equals" | "notEquals" | "greaterThan" | "lessThan" |
 *    "greaterThanOrEqual" | "lessThanOrEqual" | "contains" | "startsWith" |
 *    "endsWith" | "exists" | "notExists" | "isEmpty" | "isNotEmpty" |
 *    "isTrue" | "isFalse" | "in" | "notIn"
 *  - value: unknown -> value to compare against (when the operator needs one)
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    return isRecord(acc) ? acc[key] : undefined;
  }, obj);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
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

    if (typeof field !== "string" || !field.trim()) {
      throw new Error("IF node: 'field' parameter is required and must be a string.");
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
        case "greaterThanOrEqual":
          matches = typeof actual === "number" && typeof compareValue === "number" && actual >= compareValue;
          break;
        case "lessThanOrEqual":
          matches = typeof actual === "number" && typeof compareValue === "number" && actual <= compareValue;
          break;
        case "contains":
          matches =
            (typeof actual === "string" && typeof compareValue === "string" && actual.includes(compareValue)) ||
            (Array.isArray(actual) && actual.some((value) => value === compareValue));
          break;
        case "startsWith":
          matches = typeof actual === "string" && typeof compareValue === "string" && actual.startsWith(compareValue);
          break;
        case "endsWith":
          matches = typeof actual === "string" && typeof compareValue === "string" && actual.endsWith(compareValue);
          break;
        case "exists":
          matches = actual !== undefined;
          break;
        case "notExists":
          matches = actual === undefined;
          break;
        case "isEmpty":
          matches = isEmpty(actual);
          break;
        case "isNotEmpty":
          matches = !isEmpty(actual);
          break;
        case "isTrue":
          matches = actual === true;
          break;
        case "isFalse":
          matches = actual === false;
          break;
        case "in":
          matches = Array.isArray(compareValue) && compareValue.some((value) => value === actual);
          break;
        case "notIn":
          matches = Array.isArray(compareValue) && !compareValue.some((value) => value === actual);
          break;
        default:
          throw new Error(`IF node: unknown operator "${operator}"`);
      }

      (matches ? trueItems : falseItems).push(item);
    }

    return [trueItems, falseItems];
  },
};
