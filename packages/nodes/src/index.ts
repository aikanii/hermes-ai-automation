import { nodeRegistry } from "@hermes/core";
import { ManualTriggerNode } from "./manual-trigger";
import { HttpRequestNode } from "./http-request";
import { SetNode } from "./set";
import { IfNode } from "./if";
import { CodeNode } from "./code";

/** Call this once at process startup to make all built-in nodes available to the engine. */
export function registerBuiltInNodes(): void {
  nodeRegistry.register(ManualTriggerNode);
  nodeRegistry.register(HttpRequestNode);
  nodeRegistry.register(SetNode);
  nodeRegistry.register(IfNode);
  nodeRegistry.register(CodeNode);
}

export { ManualTriggerNode, HttpRequestNode, SetNode, IfNode, CodeNode };
