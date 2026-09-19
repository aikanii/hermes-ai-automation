import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";
import { interpolate, itemsOrSeed, isRecord } from "../utils";
import {
  createChatCompletion,
  resolveLlmConfig,
  type ChatMessage,
} from "./llm";

/** Calls an OpenAI-compatible chat-completions endpoint once per input item. */
export const AiChatNode: INodeType = {
  description: {
    name: "hermes.ai.chat",
    displayName: "AI Chat",
    description: "Sends a prompt to an OpenAI-compatible chat model and stores its response on each item.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const config = resolveLlmConfig(ctx, {
      credentialName: ctx.getParameter<unknown>("credentialName", "openai"),
      endpoint: ctx.getParameter<unknown>("endpoint"),
      model: ctx.getParameter<unknown>("model"),
      timeoutMs: ctx.getParameter<unknown>("timeoutMs", 30_000),
      temperature: ctx.getParameter<unknown>("temperature"),
      maxTokens: ctx.getParameter<unknown>("maxTokens"),
    });
    const systemPrompt = ctx.getParameter<unknown>("systemPrompt");
    const prompt = ctx.getParameter<unknown>("prompt");
    const configuredMessages = ctx.getParameter<unknown>("messages");
    const outputFieldValue = ctx.getParameter<unknown>("outputField", "response");
    const outputField = typeof outputFieldValue === "string" && outputFieldValue.trim()
      ? outputFieldValue.trim()
      : "response";
    const items = itemsOrSeed(input, ctx);
    const output: HermesItems = [];

    for (const item of items) {
      const messages = buildMessages(configuredMessages, systemPrompt, prompt, item);
      const completion = await createChatCompletion(config, messages);
      const content = completion.message.content ?? "";
      output.push({
        ...item,
        json: {
          ...item.json,
          [outputField]: content,
          ai: {
            model: completion.model ?? config.model,
            usage: completion.usage,
          },
        },
      });
    }

    return [output];
  },
};

export function buildMessages(
  configuredMessages: unknown,
  systemPrompt: unknown,
  prompt: unknown,
  item: { json: Record<string, unknown> }
): ChatMessage[] {
  if (configuredMessages !== undefined) {
    if (!Array.isArray(configuredMessages)) {
      throw new Error("AI Chat node: 'messages' must be an array when provided.");
    }
    const messages = configuredMessages.map((message) => {
      const resolved = interpolate(message, item);
      if (!isRecord(resolved) || typeof resolved.role !== "string") {
        throw new Error("AI Chat node: each message must contain a role and content.");
      }
      if (!['system', 'user', 'assistant'].includes(resolved.role)) {
        throw new Error(`AI Chat node: unsupported message role "${resolved.role}".`);
      }
      return {
        role: resolved.role as ChatMessage["role"],
        content: resolved.content === undefined ? "" : String(resolved.content),
      };
    });
    if (messages.length > 0) {
      return messages;
    }
  }

  const messages: ChatMessage[] = [];
  if (systemPrompt !== undefined && systemPrompt !== null && String(systemPrompt).trim()) {
    const resolvedSystem = interpolate(systemPrompt, item);
    messages.push({ role: "system", content: String(resolvedSystem ?? "") });
  }

  const resolvedPrompt = interpolate(prompt, item);
  const fallbackPrompt = item.json.prompt ?? item.json.input ?? item.json.text;
  const userPrompt = resolvedPrompt === undefined || resolvedPrompt === null || String(resolvedPrompt).trim() === ""
    ? fallbackPrompt
    : resolvedPrompt;
  if (userPrompt === undefined || userPrompt === null || String(userPrompt).trim() === "") {
    throw new Error("AI Chat node: provide a 'prompt' or an input item with prompt, input, or text.");
  }
  messages.push({ role: "user", content: String(userPrompt) });
  return messages;
}
