import type { Workflow } from "./types";

/** A single, human-readable problem found in a workflow definition. */
export interface WorkflowValidationIssue {
  /** JSON-like location of the invalid value, for example `nodes[0].id`. */
  path: string;
  message: string;
}

/** Error thrown when a workflow cannot be executed because its shape is invalid. */
export class WorkflowValidationError extends Error {
  readonly issues: WorkflowValidationIssue[];

  constructor(issues: WorkflowValidationIssue[]) {
    const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    super(`Invalid workflow${summary ? ` - ${summary}` : ""}`);
    this.name = "WorkflowValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the serializable part of a workflow before trying to execute it.
 *
 * Keeping this check in core means the HTTP API, CLI, and future UI all get the
 * same validation behavior. Runtime-specific checks (such as whether a node
 * type is registered) are intentionally left to the executor.
 */
export function validateWorkflow(value: unknown): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];

  if (!isRecord(value)) {
    return [{ path: "workflow", message: "must be an object" }];
  }

  if (!isNonEmptyString(value.id)) {
    issues.push({ path: "id", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(value.name)) {
    issues.push({ path: "name", message: "must be a non-empty string" });
  }
  if (value.active !== undefined && typeof value.active !== "boolean") {
    issues.push({ path: "active", message: "must be a boolean when provided" });
  }

  const nodeIds = new Set<string>();
  const nodes = value.nodes;
  if (!Array.isArray(nodes)) {
    issues.push({ path: "nodes", message: "must be an array" });
  } else {
    nodes.forEach((node, index) => {
      const path = `nodes[${index}]`;
      if (!isRecord(node)) {
        issues.push({ path, message: "must be an object" });
        return;
      }

      if (!isNonEmptyString(node.id)) {
        issues.push({ path: `${path}.id`, message: "must be a non-empty string" });
      } else if (nodeIds.has(node.id)) {
        issues.push({ path: `${path}.id`, message: `duplicates node id "${node.id}"` });
      } else {
        nodeIds.add(node.id);
      }

      if (!isNonEmptyString(node.name)) {
        issues.push({ path: `${path}.name`, message: "must be a non-empty string" });
      }
      if (!isNonEmptyString(node.type)) {
        issues.push({ path: `${path}.type`, message: "must be a non-empty string" });
      }
      if (!isRecord(node.parameters)) {
        issues.push({ path: `${path}.parameters`, message: "must be an object" });
      }

      if (node.position !== undefined) {
        if (
          !Array.isArray(node.position) ||
          node.position.length !== 2 ||
          node.position.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
        ) {
          issues.push({ path: `${path}.position`, message: "must be a pair of finite numbers" });
        }
      }
    });
  }

  const connections = value.connections;
  if (!Array.isArray(connections)) {
    issues.push({ path: "connections", message: "must be an array" });
  } else {
    connections.forEach((connection, index) => {
      const path = `connections[${index}]`;
      if (!isRecord(connection)) {
        issues.push({ path, message: "must be an object" });
        return;
      }

      const from = connection.from;
      const to = connection.to;
      if (!isNonEmptyString(from)) {
        issues.push({ path: `${path}.from`, message: "must be a non-empty string" });
      } else if (!nodeIds.has(from)) {
        issues.push({ path: `${path}.from`, message: `references unknown node "${from}"` });
      }
      if (!isNonEmptyString(to)) {
        issues.push({ path: `${path}.to`, message: "must be a non-empty string" });
      } else if (!nodeIds.has(to)) {
        issues.push({ path: `${path}.to`, message: `references unknown node "${to}"` });
      }

      if (
        connection.fromOutput !== undefined &&
        (typeof connection.fromOutput !== "number" ||
          !Number.isInteger(connection.fromOutput) ||
          connection.fromOutput < 0)
      ) {
        issues.push({ path: `${path}.fromOutput`, message: "must be a non-negative integer" });
      }
    });
  }

  return issues;
}

/** Throw a structured error unless `value` is a valid workflow definition. */
export function assertValidWorkflow(value: unknown): asserts value is Workflow {
  const issues = validateWorkflow(value);
  if (issues.length > 0) {
    throw new WorkflowValidationError(issues);
  }
}
