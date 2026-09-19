import type { NodeExecuteContext } from "@hermes/core";
import { fetchJson, isRecord, requireHttpUrl } from "../utils";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  message: ChatMessage;
  model?: string;
  usage?: unknown;
}

export function resolveLlmConfig(
  ctx: NodeExecuteContext,
  parameters: { credentialName?: unknown; model?: unknown; endpoint?: unknown; timeoutMs?: unknown; temperature?: unknown; maxTokens?: unknown } = {}
): LlmConfig {
  const credentialNameValue = parameters.credentialName ?? ctx.getParameter<unknown>("credentialName", "openai");
  const credentialName = typeof credentialNameValue === "string" && credentialNameValue.trim()
    ? credentialNameValue.trim()
    : "openai";
  const credentials = ctx.getCredential(credentialName) ?? {};
  const endpointValue = parameters.endpoint ?? credentials.baseUrl ?? credentials.endpoint ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const endpoint = normalizeEndpoint(String(endpointValue));
  requireHttpUrl(endpoint, "AI node");

  const modelValue = parameters.model ?? credentials.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const timeoutValue = parameters.timeoutMs ?? 30_000;
  const timeoutMs = typeof timeoutValue === "number" ? timeoutValue : Number.NaN;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("AI node: timeoutMs must be a positive number.");
  }

  const temperatureValue = parameters.temperature;
  const temperature = temperatureValue === undefined ? undefined : Number(temperatureValue);
  if (temperature !== undefined && !Number.isFinite(temperature)) {
    throw new Error("AI node: temperature must be a number.");
  }
  const maxTokensValue = parameters.maxTokens;
  const maxTokens = maxTokensValue === undefined ? undefined : Number(maxTokensValue);
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error("AI node: maxTokens must be a positive integer.");
  }

  return {
    endpoint,
    apiKey: String(credentials.apiKey ?? credentials.token ?? process.env.OPENAI_API_KEY ?? "").trim(),
    model: String(modelValue),
    timeoutMs,
    temperature,
    maxTokens,
  };
}

export async function createChatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  tools?: ChatTool[]
): Promise<ChatCompletionResult> {
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
  };
  if (config.temperature !== undefined) payload.temperature = config.temperature;
  if (config.maxTokens !== undefined) payload.max_tokens = config.maxTokens;
  if (tools && tools.length > 0) payload.tools = tools;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  const result = await fetchJson(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, config.timeoutMs, "AI node");

  if (!result.ok) {
    const detail = isRecord(result.body) && typeof result.body.error === "string" ? `: ${result.body.error}` : "";
    throw new Error(`AI node: model request returned status ${result.statusCode}${detail}.`);
  }
  if (!isRecord(result.body) || !Array.isArray(result.body.choices) || !isRecord(result.body.choices[0])) {
    throw new Error("AI node: provider returned an invalid chat completion response.");
  }

  const rawMessage = result.body.choices[0].message;
  if (!isRecord(rawMessage) || (rawMessage.role !== "assistant" && rawMessage.role !== "tool")) {
    throw new Error("AI node: provider response did not include an assistant message.");
  }
  const rawToolCalls = rawMessage.tool_calls;
  const toolCalls: ChatToolCall[] | undefined = Array.isArray(rawToolCalls)
    ? rawToolCalls.flatMap((call) => {
        if (!isRecord(call) || call.type !== "function" || typeof call.id !== "string" || !isRecord(call.function)) {
          return [];
        }
        if (typeof call.function.name !== "string" || typeof call.function.arguments !== "string") {
          return [];
        }
        return [{
          id: call.id,
          type: "function" as const,
          function: { name: call.function.name, arguments: call.function.arguments },
        }];
      })
    : undefined;

  return {
    message: {
      role: "assistant",
      content: typeof rawMessage.content === "string" ? rawMessage.content : null,
      tool_calls: toolCalls,
    },
    model: typeof result.body.model === "string" ? result.body.model : undefined,
    usage: result.body.usage,
  };
}

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`}/chat/completions`;
}
