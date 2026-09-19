import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HermesNode } from "./HermesNode";
import type {
  NodeDescription,
  Workflow,
  WorkflowConnection,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowSummary,
} from "./types";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const nodeTypes = { hermes: HermesNode };
type BuilderNode = Node<WorkflowNodeData, "hermes">;

type ApiWorkflow = Workflow & { createdAt?: string; updatedAt?: string };

const initialWorkflow: Workflow = {
  id: "wf_builder_demo",
  name: "Untitled workflow",
  nodes: [
    {
      id: "trigger",
      name: "Manual Trigger",
      type: "hermes.manualTrigger",
      parameters: {},
      position: [100, 170],
    },
    {
      id: "setNode",
      name: "Set Message",
      type: "hermes.set",
      parameters: { fields: { message: "Hello from Hermes" } },
      position: [380, 170],
    },
    {
      id: "ifNode",
      name: "Check Message",
      type: "hermes.if",
      parameters: { field: "message", operator: "contains", value: "Hermes" },
      position: [680, 170],
    },
    {
      id: "codeNode",
      name: "Transform",
      type: "hermes.code",
      parameters: {
        code: "return items.map(i => ({ json: { ...i.json, shouted: i.json.message.toUpperCase() } }));",
      },
      position: [990, 170],
    },
  ],
  connections: [
    { from: "trigger", to: "setNode" },
    { from: "setNode", to: "ifNode" },
    { from: "ifNode", to: "codeNode", fromOutput: 0 },
  ],
};

const fallbackDescriptions: NodeDescription[] = [
  { name: "hermes.manualTrigger", displayName: "Manual Trigger", description: "Starts a workflow run.", outputs: 1 },
  { name: "hermes.httpRequest", displayName: "HTTP Request", description: "Calls an HTTP endpoint.", outputs: 1 },
  { name: "hermes.set", displayName: "Set", description: "Adds fields to each item.", outputs: 1 },
  { name: "hermes.if", displayName: "IF", description: "Routes items to true or false branches.", outputs: 2 },
  { name: "hermes.code", displayName: "Code", description: "Runs sandboxed JavaScript.", outputs: 1 },
  { name: "hermes.slack", displayName: "Slack", description: "Sends a Slack message.", outputs: 1 },
  { name: "hermes.github", displayName: "GitHub", description: "Calls the GitHub REST API.", outputs: 1 },
  { name: "hermes.ai.chat", displayName: "AI Chat", description: "Calls an AI chat model.", outputs: 1 },
  { name: "hermes.ai.agent", displayName: "AI Agent", description: "Runs a bounded tool-calling agent.", outputs: 1 },
];

function createFlowNodes(workflow: Workflow, descriptions: NodeDescription[]): BuilderNode[] {
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: "hermes",
    position: { x: node.position?.[0] ?? 80, y: node.position?.[1] ?? 100 },
    data: {
      workflowNode: node,
      outputs: descriptions.find((description) => description.name === node.type)?.outputs ?? 1,
    },
  }));
}

function createFlowEdges(workflow: Workflow): Edge[] {
  return workflow.connections.map((connection, index) => ({
    id: `edge-${connection.from}-${connection.to}-${connection.fromOutput ?? 0}-${index}`,
    source: connection.from,
    target: connection.to,
    sourceHandle: `out-${connection.fromOutput ?? 0}`,
    type: "smoothstep",
    animated: connection.fromOutput === 0 && workflow.nodes.find((node) => node.id === connection.from)?.type === "hermes.if",
  }));
}

function toWorkflow(
  id: string,
  name: string,
  active: boolean,
  nodes: BuilderNode[],
  edges: Edge[]
): Workflow {
  const workflowNodes: WorkflowNode[] = nodes.map((node) => ({
    ...node.data.workflowNode,
    position: [Math.round(node.position.x), Math.round(node.position.y)],
  }));
  const connections: WorkflowConnection[] = edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    fromOutput: edge.sourceHandle ? Number(edge.sourceHandle.replace("out-", "")) : 0,
  }));
  return { id, name: name.trim() || "Untitled workflow", active, nodes: workflowNodes, connections };
}

function defaultParameters(type: string): Record<string, unknown> {
  switch (type) {
    case "hermes.set": return { fields: {} };
    case "hermes.if": return { field: "", operator: "equals", value: "" };
    case "hermes.httpRequest": return { method: "GET", url: "" };
    case "hermes.code": return { code: "return items;", timeoutMs: 5000 };
    case "hermes.slack": return { text: "" };
    case "hermes.github": return { method: "GET", path: "" };
    case "hermes.ai.chat": return { prompt: "", outputField: "response" };
    case "hermes.ai.agent": return { prompt: "", tools: [], maxIterations: 5, outputField: "response" };
    default: return {};
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function App() {
  const [descriptions, setDescriptions] = useState<NodeDescription[]>(fallbackDescriptions);
  const [workflowId, setWorkflowId] = useState(initialWorkflow.id);
  const [workflowName, setWorkflowName] = useState(initialWorkflow.name);
  const [active, setActive] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(createFlowNodes(initialWorkflow, fallbackDescriptions));
  const [edges, setEdges, onEdgesChange] = useEdgesState(createFlowEdges(initialWorkflow));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [status, setStatus] = useState("Ready to build");
  const [statusKind, setStatusKind] = useState<"idle" | "success" | "error">("idle");
  const [parameterText, setParameterText] = useState("{}");
  const [parameterError, setParameterError] = useState("");
  const [inputText, setInputText] = useState("[]");
  const [runResult, setRunResult] = useState<unknown>(null);

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedDescription = descriptions.find((description) => description.name === selectedNode?.data.workflowNode.type);

  useEffect(() => {
    if (!selectedNode) {
      setParameterText("{}");
      return;
    }
    setParameterText(JSON.stringify(selectedNode.data.workflowNode.parameters, null, 2));
    setParameterError("");
  }, [selectedId, selectedNode?.data.workflowNode.parameters]);

  useEffect(() => {
    void (async () => {
      try {
        const [catalog, saved] = await Promise.all([
          api<NodeDescription[]>("/nodes"),
          api<WorkflowSummary[]>("/workflows"),
        ]);
        if (catalog.length > 0) {
          setDescriptions(catalog);
          setNodes((current) => current.map((node) => ({
            ...node,
            data: {
              ...node.data,
              outputs: catalog.find((item) => item.name === node.data.workflowNode.type)?.outputs ?? node.data.outputs,
            },
          })));
        }
        setWorkflows(saved);
        if (saved.length > 0) {
          await loadWorkflow(saved[0].id, catalog.length > 0 ? catalog : fallbackDescriptions);
        }
      } catch (error) {
        setStatus(`API unavailable: ${error instanceof Error ? error.message : String(error)}`);
        setStatusKind("error");
      }
    })();
    // Initial discovery intentionally runs once; loadWorkflow owns the selected graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadWorkflow(id: string, catalog = descriptions) {
    try {
      const workflow = await api<ApiWorkflow>(`/workflows/${encodeURIComponent(id)}`);
      setWorkflowId(workflow.id);
      setWorkflowName(workflow.name);
      setActive(Boolean(workflow.active));
      setNodes(createFlowNodes(workflow, catalog));
      setEdges(createFlowEdges(workflow));
      setSelectedId(null);
      setRunResult(null);
      setStatus(`Loaded ${workflow.name}`);
      setStatusKind("success");
    } catch (error) {
      setStatus(`Could not load workflow: ${error instanceof Error ? error.message : String(error)}`);
      setStatusKind("error");
    }
  }

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: "smoothstep" }, current));
  }, [setEdges]);

  function updateSelectedNode(patch: Partial<WorkflowNode>) {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId
      ? { ...node, data: { ...node.data, workflowNode: { ...node.data.workflowNode, ...patch } } }
      : node));
  }

  function commitParameters() {
    if (!selectedId) return;
    try {
      const parsed: unknown = JSON.parse(parameterText);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parameters must be a JSON object.");
      }
      updateSelectedNode({ parameters: parsed as Record<string, unknown> });
      setParameterError("");
    } catch (error) {
      setParameterError(error instanceof Error ? error.message : String(error));
    }
  }

  function addNode(description: NodeDescription) {
    const base = description.name.replace("hermes.", "").replace(/[^a-zA-Z0-9]+/g, "_");
    let id = `${base}_${Date.now()}`;
    let suffix = 1;
    while (nodes.some((node) => node.id === id)) id = `${base}_${Date.now()}_${suffix++}`;
    const node: BuilderNode = {
      id,
      type: "hermes",
      position: { x: 180 + (nodes.length % 3) * 260, y: 130 + Math.floor(nodes.length / 3) * 180 },
      data: {
        outputs: description.outputs,
        workflowNode: {
          id,
          name: description.displayName,
          type: description.name,
          parameters: defaultParameters(description.name),
          position: [180, 130],
        },
      },
    };
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setStatus(`Added ${description.displayName}`);
    setStatusKind("idle");
  }

  function newWorkflow() {
    const id = `wf_${Date.now()}`;
    const workflow = { ...initialWorkflow, id, name: "Untitled workflow", nodes: [initialWorkflow.nodes[0]], connections: [] };
    setWorkflowId(id);
    setWorkflowName(workflow.name);
    setActive(false);
    setNodes(createFlowNodes(workflow, descriptions));
    setEdges([]);
    setSelectedId(null);
    setRunResult(null);
    setStatus("New workflow");
    setStatusKind("idle");
  }

  async function saveWorkflow() {
    const definition = toWorkflow(workflowId, workflowName, active, nodes, edges);
    try {
      let saved: ApiWorkflow;
      try {
        saved = await api<ApiWorkflow>(`/workflows/${encodeURIComponent(workflowId)}`, {
          method: "PUT",
          body: JSON.stringify(definition),
        });
      } catch {
        saved = await api<ApiWorkflow>("/workflows", {
          method: "POST",
          body: JSON.stringify(definition),
        });
      }
      setWorkflowId(saved.id);
      setWorkflowName(saved.name);
      const list = await api<WorkflowSummary[]>("/workflows");
      setWorkflows(list);
      setStatus("Workflow saved");
      setStatusKind("success");
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      setStatusKind("error");
    }
  }

  async function runWorkflow() {
    let inputItems: unknown;
    try {
      inputItems = JSON.parse(inputText);
      if (!Array.isArray(inputItems)) throw new Error("Input items must be a JSON array.");
    } catch (error) {
      setStatus(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
      setStatusKind("error");
      return;
    }
    try {
      const result = await api<unknown>("/workflows/execute", {
        method: "POST",
        body: JSON.stringify({ workflow: toWorkflow(workflowId, workflowName, active, nodes, edges), inputItems }),
      });
      setRunResult(result);
      setStatus("Workflow executed");
      setStatusKind("success");
    } catch (error) {
      setStatus(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
      setStatusKind("error");
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
    setStatus("Node deleted");
    setStatusKind("idle");
  }

  const palette = useMemo(() => descriptions, [descriptions]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">Hermes</div>
            <div className="brand-caption">workflow studio</div>
          </div>
        </div>
        <input
          className="workflow-name"
          value={workflowName}
          onChange={(event) => setWorkflowName(event.target.value)}
          aria-label="Workflow name"
        />
        <div className="top-actions">
          <label className="active-toggle">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
            Active
          </label>
          <button className="button subtle" onClick={newWorkflow}>New</button>
          <button className="button secondary" onClick={() => void saveWorkflow()}>Save</button>
          <button className="button primary" onClick={() => void runWorkflow()}>▶ Run</button>
        </div>
      </header>

      <div className="studio-grid">
        <aside className="sidebar left-sidebar">
          <section className="sidebar-section">
            <div className="section-heading"><span>Node palette</span><span className="count-pill">{palette.length}</span></div>
            <p className="muted-copy">Drag the building blocks of your automation onto the canvas.</p>
            <div className="palette-list">
              {palette.map((description) => (
                <button className="palette-item" key={description.name} onClick={() => addNode(description)} title={description.description}>
                  <span className="palette-icon">{description.name.startsWith("hermes.ai") ? "✦" : description.name === "hermes.if" ? "◇" : "+"}</span>
                  <span>
                    <strong>{description.displayName}</strong>
                    <small>{description.name.replace("hermes.", "")}</small>
                  </span>
                  <span className="add-glyph">+</span>
                </button>
              ))}
            </div>
          </section>
          <section className="sidebar-section saved-section">
            <div className="section-heading"><span>Saved workflows</span><span className="count-pill">{workflows.length}</span></div>
            {workflows.length === 0 ? <p className="empty-copy">Save a workflow to see it here.</p> : (
              <div className="saved-list">
                {workflows.map((workflow) => (
                  <button className={`saved-item${workflow.id === workflowId ? " selected" : ""}`} key={workflow.id} onClick={() => void loadWorkflow(workflow.id)}>
                    <span className="saved-dot" />
                    <span><strong>{workflow.name}</strong><small>{workflow.id}</small></span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#dbe4f0" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="#8b5cf6" maskColor="rgba(243, 246, 251, 0.75)" />
            <div className="canvas-hint">Connect output handles to input handles · click a node to configure it</div>
          </ReactFlow>
        </main>

        <aside className="sidebar right-sidebar">
          <section className="sidebar-section inspector-section">
            <div className="section-heading"><span>Inspector</span>{selectedNode && <button className="delete-button" onClick={deleteSelected}>Delete</button>}</div>
            {!selectedNode ? <div className="inspector-empty"><div className="empty-icon">⌁</div><p>Select a node to edit its name and parameters.</p></div> : (
              <div className="inspector-form">
                <label>Node name<input value={selectedNode.data.workflowNode.name} onChange={(event) => updateSelectedNode({ name: event.target.value })} /></label>
                <label>Node type<input value={selectedNode.data.workflowNode.type} readOnly className="readonly" /></label>
                <div className="field-label-row"><label className="field-label" htmlFor="parameters">Parameters</label><span className="json-hint">JSON</span></div>
                <textarea id="parameters" className={`parameters-editor${parameterError ? " has-error" : ""}`} value={parameterText} onChange={(event) => setParameterText(event.target.value)} onBlur={commitParameters} spellCheck={false} />
                {parameterError && <div className="field-error">{parameterError}</div>}
                <p className="inspector-help">Use <code>{"{{$json.field}}"}</code> for item templates in integration and AI parameters.</p>
              </div>
            )}
          </section>
          <section className="sidebar-section run-section">
            <div className="section-heading"><span>Run input</span><span className="json-hint">JSON array</span></div>
            <textarea className="input-editor" value={inputText} onChange={(event) => setInputText(event.target.value)} spellCheck={false} />
            <p className="inspector-help">Root nodes receive these items. Leave it as <code>[]</code> for trigger-driven workflows.</p>
          </section>
          {runResult !== null && (
            <section className="sidebar-section result-section">
              <div className="section-heading"><span>Latest run</span><button className="clear-button" onClick={() => setRunResult(null)}>Clear</button></div>
              <pre className="result-viewer">{JSON.stringify(runResult, null, 2)}</pre>
            </section>
          )}
        </aside>
      </div>

      <footer className={`statusbar ${statusKind}`}>
        <span className="status-dot" />
        <span>{status}</span>
        <span className="footer-spacer" />
        <span className="workflow-id">{workflowId}</span>
      </footer>
    </div>
  );
}
