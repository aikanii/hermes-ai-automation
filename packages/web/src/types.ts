export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  position?: [number, number];
}

export interface WorkflowConnection {
  from: string;
  to: string;
  fromOutput?: number;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  active?: boolean;
}

export interface NodeDescription {
  name: string;
  displayName: string;
  description: string;
  outputs: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  workflowNode: WorkflowNode;
  outputs: number;
}
