import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";

/**
 * HttpRequest: generic outbound HTTP call, one per input item (n8n does the same -
 * a node typically runs once per incoming item, so batches "just work").
 *
 * Parameters expected on the node:
 *  - url: string (required)
 *  - method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" (default "GET")
 *  - headers: Record<string, string>
 *  - body: unknown (sent as JSON for non-GET requests)
 */
export const HttpRequestNode: INodeType = {
  description: {
    name: "hermes.httpRequest",
    displayName: "HTTP Request",
    description: "Makes an HTTP request to any URL and returns the response as JSON.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const url = ctx.getParameter<string>("url");
    const method = ctx.getParameter<string>("method", "GET");
    const headers = ctx.getParameter<Record<string, string>>("headers", {});
    const body = ctx.getParameter<unknown>("body");

    if (!url) {
      throw new Error("HTTP Request node: 'url' parameter is required.");
    }

    // Run once per input item, or once if there are no input items (e.g. right after a trigger).
    const itemsToProcess = input.length > 0 ? input : [{ json: {} }];
    const outputItems: HermesItems = [];

    for (const _item of itemsToProcess) {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: method !== "GET" && body !== undefined ? JSON.stringify(body) : undefined,
      });

      let json: unknown;
      const text = await response.text();
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      outputItems.push({
        json: {
          statusCode: response.status,
          ok: response.ok,
          body: json,
        },
      });
    }

    return [outputItems];
  },
};
