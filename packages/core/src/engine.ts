import { nodeRegistry } from "./node-registry";
import { assertValidWorkflow } from "./validation";
import type {
  Workflow,
  WorkflowNode,
  HermesItems,
  HermesItem,
  NodeExecutionResult,
  ExecutionResult,
  NodeExecuteContext,
  INodeType,
} from "./types";

/** Options for a workflow run. Root nodes receive `inputItems` as their input. */
export interface ExecuteWorkflowOptions {
  inputItems?: HermesItems;
}

type IncomingConnection = { from: string; fromOutput: number };

/**
 * Builds a quick lookup of "which nodes feed into this node, and from which output branch".
 * Structural validation is performed before this helper is called, but keeping the
 * endpoint checks here as well makes the helper safe to use if it is changed later.
 */
function buildIncomingMap(workflow: Workflow) {
  const incoming = new Map<string, IncomingConnection[]>();
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));

  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
  }
  for (const conn of workflow.connections) {
    if (!nodeIds.has(conn.from)) {
      throw new Error(`Connection references unknown source node "${conn.from}"`);
    }
    const list = incoming.get(conn.to);
    if (!list) {
      throw new Error(`Connection references unknown target node "${conn.to}"`);
    }
    list.push({ from: conn.from, fromOutput: conn.fromOutput ?? 0 });
  }
  return incoming;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHermesItem(value: unknown): value is HermesItem {
  return isRecord(value) && isRecord(value.json);
}

/**
 * Validate and normalize the result from a node implementation. A node may omit
 * trailing empty branches, so missing declared outputs are filled with empty arrays.
 */
function normalizeOutputBranches(nodeType: INodeType, output: unknown): HermesItems[] {
  const declaredOutputs = nodeType.description.outputs;
  if (!Number.isInteger(declaredOutputs) || declaredOutputs < 1) {
    throw new Error(
      `Node type "${nodeType.description.name}" declares an invalid output count (${String(declaredOutputs)}).`
    );
  }
  if (!Array.isArray(output)) {
    throw new Error(`Node type "${nodeType.description.name}" must return an array of output branches.`);
  }
  if (output.length > declaredOutputs) {
    throw new Error(
      `Node type "${nodeType.description.name}" returned ${output.length} output branches, ` +
        `but declares ${declaredOutputs}.`
    );
  }

  return Array.from({ length: declaredOutputs }, (_, branchIndex) => {
    const branch = branchIndex < output.length ? output[branchIndex] : [];
    if (!Array.isArray(branch)) {
      throw new Error(
        `Node type "${nodeType.description.name}" output branch ${branchIndex} must be an array of items.`
      );
    }
    for (const [itemIndex, item] of branch.entries()) {
      if (!isHermesItem(item)) {
        throw new Error(
          `Node type "${nodeType.description.name}" returned an invalid item at ` +
            `output branch ${branchIndex}, index ${itemIndex}.`
        );
      }
    }
    return branch as HermesItems;
  });
}

/**
 * Executes a workflow start-to-finish.
 *
 * Strategy: simple repeated pass ("ready queue") topological execution.
 * - A node is "ready" once all of its incoming nodes have already produced output.
 * - Trigger nodes (no incoming connections) are ready immediately and receive the
 *   optional root input (or an empty array).
 * - When a node executes, it may emit multiple output branches (e.g. IF ->
 *   [trueItems, falseItems]). Downstream nodes pick up items from the branch they
 *   are connected to.
 *
 * This is intentionally simple (no cycle support, no parallel branching
 * optimization) — enough for Phase 0. Later phases can swap this for a queue-based
 * executor without changing the node interface.
 */
export async function executeWorkflow(
  workflow: Workflow,
  options: ExecuteWorkflowOptions = {}
): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const workflowId = isRecord(workflow) && typeof workflow.id === "string" ? workflow.id : "unknown";
  const nodeResults: Record<string, NodeExecutionResult> = {};

  try {
    assertValidWorkflow(workflow);

    if (options.inputItems !== undefined && !Array.isArray(options.inputItems)) {
      throw new Error("Workflow execution input must be an array of items.");
    }
    if (options.inputItems?.some((item) => !isHermesItem(item))) {
      throw new Error("Workflow execution input contains an invalid item.");
    }

    const nodeById = new Map<string, WorkflowNode>(workflow.nodes.map((node) => [node.id, node]));
    const incomingMap = buildIncomingMap(workflow);

    // Stores each node's produced output branches once it has run.
    const outputsByNode = new Map<string, HermesItems[]>();
    const pending = new Set(workflow.nodes.map((node) => node.id));

    // Keep looping until every node has run, or we can't make progress (cycle/dead node).
    while (pending.size > 0) {
      const ready = [...pending].filter((nodeId) => {
        const incomers = incomingMap.get(nodeId) ?? [];
        return incomers.every((inc) => outputsByNode.has(inc.from));
      });

      if (ready.length === 0) {
        throw new Error(
          `Workflow cannot proceed - remaining nodes have unresolved dependencies: ${[...pending].join(", ")}`
        );
      }

      for (const nodeId of ready) {
        const node = nodeById.get(nodeId);
        if (!node) {
          throw new Error(`Workflow references unknown node "${nodeId}".`);
        }

        const incomers = incomingMap.get(nodeId) ?? [];

        // Gather input items from all upstream connections (merge multiple inputs, n8n-style).
        let inputItems: HermesItems = [];
        if (incomers.length === 0) {
          inputItems = options.inputItems ?? [];
        } else {
          for (const inc of incomers) {
            const branches = outputsByNode.get(inc.from);
            if (!branches) {
              throw new Error(`Node "${inc.from}" has not produced output yet.`);
            }
            if (inc.fromOutput >= branches.length) {
              throw new Error(
                `Connection from node "${inc.from}" references output branch ${inc.fromOutput}, ` +
                  `but that node only has ${branches.length} output branch${branches.length === 1 ? "" : "es"}.`
              );
            }
            inputItems = inputItems.concat(branches[inc.fromOutput]);
          }
        }

        const result: NodeExecutionResult = {
          nodeId,
          status: "running",
          startedAt: Date.now(),
        };
        // Define the property explicitly so ids such as "__proto__" remain ordinary
        // serializable node-result keys instead of changing the result object's prototype.
        Object.defineProperty(nodeResults, nodeId, {
          configurable: true,
          enumerable: true,
          value: result,
          writable: true,
        });

        try {
          const nodeType = nodeRegistry.get(node.type);
          const ctx: NodeExecuteContext = {
            node,
            isRoot: incomers.length === 0,
            getParameter: <T = unknown>(name: string, fallback?: T): T => {
              const value = node.parameters[name];
              return (value === undefined ? fallback : value) as T;
            },
            getCredential: (name: string) => {
              const credential = node.parameters[`credential:${name}`];
              return isRecord(credential) ? credential : undefined;
            },
          };

          const rawOutput = await nodeType.execute(inputItems, ctx);
          const outputBranches = normalizeOutputBranches(nodeType, rawOutput);

          outputsByNode.set(nodeId, outputBranches);
          result.status = "success";
          result.outputItems = outputBranches;
          result.finishedAt = Date.now();
        } catch (err) {
          result.status = "error";
          result.error = err instanceof Error ? err.message : String(err);
          result.finishedAt = Date.now();
          throw err; // Phase 0: fail the whole execution on first error.
        }

        pending.delete(nodeId);
      }
    }

    return {
      workflowId,
      startedAt,
      finishedAt: Date.now(),
      status: "success",
      nodeResults,
    };
  } catch (err) {
    return {
      workflowId,
      startedAt,
      finishedAt: Date.now(),
      status: "error",
      nodeResults,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
