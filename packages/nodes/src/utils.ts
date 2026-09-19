import type { HermesItem, HermesItems, NodeExecuteContext } from "@hermes/core";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function itemsOrSeed(input: HermesItems, ctx: NodeExecuteContext): HermesItems {
  return input.length > 0 || !ctx.isRoot ? input : [{ json: {} }];
}

export function getByPath(value: unknown, path: string): unknown {
  if (!path) {
    return value;
  }
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(key);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return isRecord(current) ? current[key] : undefined;
  }, value);
}

/**
 * Resolve small, deliberately non-Turing-complete expressions used by integration
 * parameters. Examples: {{$json.email}}, {{$json.user.id}}, and {{$json}}.
 */
export function interpolate(value: unknown, item: HermesItem): unknown {
  if (typeof value === "string") {
    const wholeExpression = value.match(/^\{\{\s*\$json(?:\.([^}\s]+))?\s*\}\}$/);
    if (wholeExpression) {
      return wholeExpression[1] ? getByPath(item.json, wholeExpression[1]) : item.json;
    }
    return value.replace(/\{\{\s*\$json(?:\.([^}\s]+))?\s*\}\}/g, (_match, path?: string) => {
      const resolved = path ? getByPath(item.json, path) : item.json;
      return resolved === undefined || resolved === null ? "" : String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolate(entry, item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolate(entry, item)]));
  }
  return value;
}

export interface HttpJsonResult {
  statusCode: number;
  ok: boolean;
  body: unknown;
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<HttpJsonResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label}: timeoutMs must be a positive number.`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label}: request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`${label}: request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return { statusCode: response.status, ok: response.ok, body };
}

export function requireHttpUrl(url: string, label: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("only http and https URLs are supported");
    }
  } catch (error) {
    throw new Error(
      `${label}: URL must be an absolute HTTP(S) URL${error instanceof Error ? ` (${error.message})` : ""}.`
    );
  }
}
