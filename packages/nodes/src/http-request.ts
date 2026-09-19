import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";

const supportedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * HttpRequest: generic outbound HTTP call, one per input item (n8n does the same -
 * a node typically runs once per incoming item, so batches "just work").
 *
 * Parameters expected on the node:
 *  - url: string (required, absolute HTTP(S) URL)
 *  - method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
 *    (default "GET")
 *  - headers: Record<string, string>
 *  - body: unknown (sent as JSON for methods that support a body)
 *  - timeoutMs: number (default 30 seconds)
 *  - throwOnError: boolean (default false; return non-2xx responses when false)
 *  - responseFormat: "auto" | "json" | "text" (default "auto")
 */
export const HttpRequestNode: INodeType = {
  description: {
    name: "hermes.httpRequest",
    displayName: "HTTP Request",
    description: "Makes an HTTP request to any URL and returns the response as JSON.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const rawUrl = ctx.getParameter<unknown>("url");
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    const rawMethod = ctx.getParameter<unknown>("method", "GET");
    const method = typeof rawMethod === "string" ? rawMethod.toUpperCase() : "";
    const rawHeaders = ctx.getParameter<unknown>("headers", {});
    const body = ctx.getParameter<unknown>("body");
    const rawTimeoutMs = ctx.getParameter<unknown>("timeoutMs", 30_000);
    const timeoutMs = typeof rawTimeoutMs === "number" ? rawTimeoutMs : Number.NaN;
    const rawThrowOnError = ctx.getParameter<unknown>("throwOnError", false);
    const throwOnError = rawThrowOnError;
    const rawResponseFormat = ctx.getParameter<unknown>("responseFormat", "auto");
    const responseFormat = typeof rawResponseFormat === "string" ? rawResponseFormat : "";

    if (!url) {
      throw new Error("HTTP Request node: 'url' parameter is required.");
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("only http and https URLs are supported");
      }
    } catch (err) {
      throw new Error(
        `HTTP Request node: 'url' must be a valid absolute HTTP(S) URL${
          err instanceof Error && err.message !== "only http and https URLs are supported"
            ? ` (${err.message})`
            : ""
        }.`
      );
    }
    if (!supportedMethods.has(method)) {
      throw new Error(`HTTP Request node: unsupported method "${method}".`);
    }
    if (rawHeaders === null || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
      throw new Error("HTTP Request node: 'headers' parameter must be an object.");
    }
    const headers = rawHeaders as Record<string, string>;
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== "string") {
        throw new Error(`HTTP Request node: header "${name}" must be a string.`);
      }
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("HTTP Request node: 'timeoutMs' must be a positive number.");
    }
    if (responseFormat !== "auto" && responseFormat !== "json" && responseFormat !== "text") {
      throw new Error(`HTTP Request node: unsupported response format "${responseFormat}".`);
    }
    if (typeof throwOnError !== "boolean") {
      throw new Error("HTTP Request node: 'throwOnError' must be a boolean.");
    }

    // Run once per input item. A standalone HTTP node gets one seed item, while an
    // empty upstream branch stays empty and does not make an unexpected request.
    const itemsToProcess = input.length > 0 || !ctx.isRoot ? input : [{ json: {} }];
    const outputItems: HermesItems = [];

    for (const _item of itemsToProcess) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body: method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && body !== undefined
            ? JSON.stringify(body)
            : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(`HTTP Request node: request to ${url} timed out after ${timeoutMs}ms.`);
        }
        throw new Error(
          `HTTP Request node: request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        clearTimeout(timer);
      }

      const text = await response.text();
      let parsedBody: unknown;
      if (responseFormat === "text") {
        parsedBody = text;
      } else {
        try {
          parsedBody = text ? JSON.parse(text) : {};
        } catch {
          if (responseFormat === "json") {
            throw new Error(`HTTP Request node: response from ${url} was not valid JSON.`);
          }
          parsedBody = { raw: text };
        }
      }

      if (throwOnError && !response.ok) {
        throw new Error(`HTTP Request node: ${method} ${url} returned status ${response.status}.`);
      }

      outputItems.push({
        json: {
          statusCode: response.status,
          ok: response.ok,
          body: parsedBody,
        },
      });
    }

    return [outputItems];
  },
};
