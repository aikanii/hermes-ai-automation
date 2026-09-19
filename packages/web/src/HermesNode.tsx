import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { WorkflowNodeData } from "./types";

type HermesFlowNode = Node<WorkflowNodeData, "hermes">;

export function HermesNode({ data, selected }: NodeProps<HermesFlowNode>) {
  const outputCount = Math.max(1, data.outputs);

  return (
    <div className={`hermes-node${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="node-handle target-handle" />
      <div className="node-kicker">{data.workflowNode.type.replace("hermes.", "")}</div>
      <div className="node-title">{data.workflowNode.name}</div>
      <div className="node-id">{data.workflowNode.id}</div>
      <div className="node-outputs" aria-label={`${outputCount} output${outputCount === 1 ? "" : "s"}`}>
        {Array.from({ length: outputCount }, (_, index) => (
          <span className="output-label" key={index}>
            {outputCount > 1 ? (index === 0 ? "true" : index === 1 ? "false" : `out ${index}`) : "out"}
            <Handle
              type="source"
              position={Position.Bottom}
              id={`out-${index}`}
              style={{ left: `${((index + 1) / (outputCount + 1)) * 100}%` }}
              className="node-handle source-handle"
            />
          </span>
        ))}
      </div>
    </div>
  );
}
