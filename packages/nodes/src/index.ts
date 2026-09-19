import { nodeRegistry } from "@hermes/core";
import { ManualTriggerNode } from "./manual-trigger";
import { HttpRequestNode } from "./http-request";
import { SetNode } from "./set";
import { IfNode } from "./if";
import { CodeNode } from "./code";
import { SlackNode } from "./slack";
import { GitHubNode } from "./github";
import { AiChatNode } from "./ai/chat";
import { AiAgentNode } from "./ai/agent";

/** Call this once at process startup to make all built-in nodes available to the engine. */
export function registerBuiltInNodes(): void {
  // Registration is intentionally idempotent so application startup, tests, and
  // hot-reload entry points can safely call this more than once.
  nodeRegistry.registerIfAbsent(ManualTriggerNode);
  nodeRegistry.registerIfAbsent(HttpRequestNode);
  nodeRegistry.registerIfAbsent(SetNode);
  nodeRegistry.registerIfAbsent(IfNode);
  nodeRegistry.registerIfAbsent(CodeNode);
  nodeRegistry.registerIfAbsent(SlackNode);
  nodeRegistry.registerIfAbsent(GitHubNode);
  nodeRegistry.registerIfAbsent(AiChatNode);
  nodeRegistry.registerIfAbsent(AiAgentNode);
}

export {
  ManualTriggerNode,
  HttpRequestNode,
  SetNode,
  IfNode,
  CodeNode,
  SlackNode,
  GitHubNode,
  AiChatNode,
  AiAgentNode,
};
