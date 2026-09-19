import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";
import { fetchJson, interpolate, isRecord, itemsOrSeed, requireHttpUrl } from "../utils";
import {
  createChatCompletion,
  resolveLlmConfig,
  type ChatTool,
  type ChatToolCall,
} from "./llm";
import { buildMessages } from "./chat";

interface ConfiguredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  method: string;
  url: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}

/**
 * A small, provider-neutral tool-calling agent. Tools are explicit HTTP actions
 * defined on the node, and every call is bounded by maxIterations and timeoutMs.
 */
export const AiAgentNode: INodeType = {
  description: {
    name: "hermes.ai.agent",
    displayName: "AI Agent",
    description: "Runs an OpenAI-compatible tool-calling agent with bounded HTTP tools.",
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
    const configuredTools = parseTools(ctx.getParameter<unknown>("tools", []));
    const tools = toToolDefinitions(configuredTools);
    const maxIterationsValue = ctx.getParameter<unknown>("maxIterations", 5);
    const maxIterations = typeof maxIterationsValue === "number" ? maxIterationsValue : Number.NaN;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) {
      throw new Error("AI Agent node: maxIterations must be an integer between 1 and 10.");
    }
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
      let finalContent = "";
      let totalToolCalls = 0;
      let iterations = 0;

      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        iterations = iteration;
        const completion = await createChatCompletion(config, messages, tools);
        const assistantMessage = completion.message;
        messages.push(assistantMessage);
        const calls = assistantMessage.tool_calls ?? [];
        if (calls.length === 0) {
          finalContent = assistantMessage.content ?? "";
          break;
        }

        totalToolCalls += calls.length;
        for (const call of calls) {
          const tool = configuredTools.find((candidate) => candidate.name === call.function.name);
          if (!tool) {
            throw new Error(`AI Agent node: model requested unconfigured tool "${call.function.name}".`);
          }
          const toolResult = await runTool(tool, call, item, config.timeoutMs);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        }

        if (iteration === maxIterations) {
          throw new Error(`AI Agent node: reached maxIterations (${maxIterations}) before a final response.`);
        }
      }

      output.push({
        ...item,
        json: {
          ...item.json,
          [outputField]: finalContent,
          ai: {
            model: config.model,
            iterations,
            toolCalls: totalToolCalls,
          },
        },
      });
    }

    return [output];
  },
};

function parseTools(value: unknown): ConfiguredTool[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("AI Agent node: 'tools' must be an array.");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(`AI Agent node: tools[${index}] needs a non-empty name.`);
    }
    if (typeof entry.description !== "string" || !entry.description.trim()) {
      throw new Error(`AI Agent node: tools[${index}] needs a description.`);
    }
    if (typeof entry.url !== "string" || !entry.url.trim()) {
      throw new Error(`AI Agent node: tools[${index}] needs an HTTP url.`);
    }
    const parameters = isRecord(entry.parameters)
      ? entry.parameters
      : { type: "object", properties: {} };
    const headers = entry.headers === undefined
      ? undefined
      : isRecord(entry.headers)
        ? entry.headers
        : undefined;
    if (entry.headers !== undefined && !headers) {
      throw new Error(`AI Agent node: tools[${index}].headers must be an object.`);
    }
    const method = typeof entry.method === "string" ? entry.method.toUpperCase() : "POST";
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error(`AI Agent node: tools[${index}] has unsupported method "${method}".`);
    }
    return {
      name: entry.name.trim(),
      description: entry.description,
      parameters,
      method,
      url: entry.url,
      headers,
      body: entry.body,
    };
  });
}

function toToolDefinitions(tools: ConfiguredTool[]): ChatTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function runTool(
  tool: ConfiguredTool,
  call: ChatToolCall,
  item: { json: Record<string, unknown> },
  timeoutMs: number
) {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (!isRecord(parsed)) {
      throw new Error("tool arguments must be an object");
    }
    args = parsed;
  } catch (error) {
    return { error: `Invalid tool arguments: ${error instanceof Error ? error.message : String(error)}` };
  }

  const resolvedUrl = String(interpolateArgs(tool.url, args, item));
  requireHttpUrl(resolvedUrl, `AI Agent tool "${tool.name}"`);
  const resolvedHeaders = interpolateArgs(tool.headers ?? {}, args, item) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(resolvedHeaders)) {
    if (typeof value === "string") headers[name] = value;
  }
  headers.Accept ??= "application/json";
  headers["Content-Type"] ??= "application/json";

  const rawBody = tool.body === undefined && tool.method !== "GET" && tool.method !== "DELETE"
    ? args
    : interpolateArgs(tool.body, args, item);
  const result = await fetchJson(resolvedUrl, {
    method: tool.method,
    headers,
    body: tool.method === "GET" || tool.method === "DELETE" || rawBody === undefined
      ? undefined
      : JSON.stringify(rawBody),
  }, timeoutMs, `AI Agent tool "${tool.name}"`);
  return {
    statusCode: result.statusCode,
    ok: result.ok,
    body: result.body,
  };
}

function interpolateArgs(value: unknown, args: Record<string, unknown>, item: { json: Record<string, unknown> }): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*\$args(?:\.([^}\s]+))?\s*\}\}$/);
    if (whole) {
      return whole[1] ? getArg(args, whole[1]) : args;
    }
    const withArgs = value.replace(/\{\{\s*\$args(?:\.([^}\s]+))?\s*\}\}/g, (_match, path?: string) => {
      const resolved = path ? getArg(args, path) : args;
      return resolved === undefined || resolved === null ? "" : String(resolved);
    });
    return interpolate(withArgs, item);
  }
  if (Array.isArray(value)) return value.map((entry) => interpolateArgs(entry, args, item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolateArgs(entry, args, item)]));
  }
  return value;
}

function getArg(args: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, args);
}
