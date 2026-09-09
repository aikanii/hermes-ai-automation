/**
 * Hermes Core Types
 * ------------------
 * Mirrors the mental model n8n uses:
 * - A Workflow is a graph of Nodes connected by Connections.
 * - Data flows between nodes as arrays of "Items" (each item is a plain object).
 * - Every node type implements INodeType, exposing metadata + an execute() function.
 */

/** A single unit of data flowing through the workflow. Keeps it generic on purpose. */
export interface HermesItem {
  json: Record<string, unknown>;
  binary?: Record<string, unknown>;
}

/** The full data payload passed between nodes (n8n calls this "INodeExecutionData[]"). */
export type HermesItems = HermesItem[];

/** A node instance as it exists inside a saved Workflow (position, params, etc). */
export interface WorkflowNode {
  id: string;               // unique id within the workflow, e.g. "node_1"
  name: string;             // display name, e.g. "Send Slack Message"
  type: string;             // node type identifier, e.g. "hermes.httpRequest"
  parameters: Record<string, unknown>; // user-configured params for this node
  position?: [number, number];         // for the visual canvas (x, y)
}

/** A directed edge between two nodes. */
export interface WorkflowConnection {
  from: string; // source node id
  to: string;   // target node id
  fromOutput?: number; // which output branch of the source node (default 0, used by IF/Switch)
}

/** The full serializable Workflow definition — this is what gets saved as JSON. */
export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  active?: boolean;
}

/** Context passed into every node's execute() call. */
export interface NodeExecuteContext {
  node: WorkflowNode;
  getParameter: <T = unknown>(name: string, fallback?: T) => T;
  /** Credentials resolver (Phase 4 will back this with encrypted storage). For now, reads from parameters. */
  getCredential: (name: string) => Record<string, unknown> | undefined;
}

/**
 * The interface every node type must implement.
 * This is the same shape n8n uses, which is what makes adding new integrations mechanical.
 */
export interface INodeType {
  description: {
    name: string;          // e.g. "hermes.httpRequest"
    displayName: string;   // e.g. "HTTP Request"
    description: string;
    /** How many output branches this node produces. Most nodes have 1; IF/Switch have more. */
    outputs: number;
  };
  execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]>;
  // returns an array of "output branches", each an array of items.
  // e.g. a normal node returns [items]; an IF node returns [trueItems, falseItems].
}

/** Status of a single node's execution, tracked for the UI / logs. */
export type NodeExecutionStatus = "waiting" | "running" | "success" | "error";

export interface NodeExecutionResult {
  nodeId: string;
  status: NodeExecutionStatus;
  startedAt?: number;
  finishedAt?: number;
  outputItems?: HermesItems[];
  error?: string;
}

/** Result of running an entire workflow once. */
export interface ExecutionResult {
  workflowId: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "error";
  nodeResults: Record<string, NodeExecutionResult>;
  error?: string;
}
