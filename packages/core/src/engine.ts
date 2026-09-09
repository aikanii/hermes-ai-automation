import { nodeRegistry } from "./node-registry";
import type {
  Workflow,
  WorkflowNode,
  HermesItems,
  NodeExecutionResult,
  ExecutionResult,
  NodeExecuteContext,
} from "./types";

/**
 * Builds a quick lookup of "which nodes feed into this node, and from which output branch".
 */
function buildIncomingMap(workflow: Workflow) {
  const incoming = new Map<string, { from: string; fromOutput: number }[]>();
  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
  }
  for (const conn of workflow.connections) {
    const list = incoming.get(conn.to);
    if (!list) {
      throw new Error(`Connection references unknown target node "${conn.to}"`);
    }
    list.push({ from: conn.from, fromOutput: conn.fromOutput ?? 0 });
  }
  return incoming;
}

/**
 * Executes a workflow start-to-finish.
 *
 * Strategy: simple repeated pass ("ready queue") topological execution.
 * - A node is "ready" once all of its incoming nodes have already produced output.
 * - Trigger nodes (no incoming connections) are ready immediately and seed with `[]` input.
 * - When a node executes, it may emit multiple output branches (e.g. IF -> [trueItems, falseItems]).
 *   Downstream nodes pick up items from the specific branch they're connected to.
 *
 * This is intentionally simple (no cycle support, no parallel branching optimization) —
 * enough for Phase 0. Later phases can swap this for a queue-based (BullMQ) executor
 * without changing the node interface at all.
 */
export async function executeWorkflow(workflow: Workflow): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const nodeResults: Record<string, NodeExecutionResult> = {};
  const nodeById = new Map<string, WorkflowNode>(workflow.nodes.map((n) => [n.id, n]));
  const incomingMap = buildIncomingMap(workflow);

  // Stores each node's produced output branches once it has run.
  const outputsByNode = new Map<string, HermesItems[]>();
  const pending = new Set(workflow.nodes.map((n) => n.id));

  try {
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
        const node = nodeById.get(nodeId)!;
        const incomers = incomingMap.get(nodeId) ?? [];

        // Gather input items from all upstream connections (merge multiple inputs, n8n-style).
        let inputItems: HermesItems = [];
        if (incomers.length === 0) {
          inputItems = []; // trigger node - starts with empty input
        } else {
          for (const inc of incomers) {
            const branches = outputsByNode.get(inc.from)!;
            const branchItems = branches[inc.fromOutput] ?? [];
            inputItems = inputItems.concat(branchItems);
          }
        }

        const result: NodeExecutionResult = {
          nodeId,
          status: "running",
          startedAt: Date.now(),
        };
        nodeResults[nodeId] = result;

        try {
          const nodeType = nodeRegistry.get(node.type);
          const ctx: NodeExecuteContext = {
            node,
            getParameter: (name, fallback) =>
              (node.parameters[name] as any) ?? (fallback as any),
            getCredential: (name) => node.parameters[`credential:${name}`] as any,
          };

          const outputBranches = await nodeType.execute(inputItems, ctx);

          outputsByNode.set(nodeId, outputBranches);
          result.status = "success";
          result.outputItems = outputBranches;
          result.finishedAt = Date.now();
        } catch (err) {
          result.status = "error";
          result.error = err instanceof Error ? err.message : String(err);
          result.finishedAt = Date.now();
          throw err; // Phase 0: fail the whole execution on first error.
                     // Phase 2 will add per-node error branches / "continue on fail".
        }

        pending.delete(nodeId);
      }
    }

    return {
      workflowId: workflow.id,
      startedAt,
      finishedAt: Date.now(),
      status: "success",
      nodeResults,
    };
  } catch (err) {
    return {
      workflowId: workflow.id,
      startedAt,
      finishedAt: Date.now(),
      status: "error",
      nodeResults,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
