import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";
import { fetchJson, interpolate, itemsOrSeed, requireHttpUrl } from "./utils";

/**
 * GitHub's REST API as a credential-aware integration node. The path can be a
 * literal such as `repos/acme/project/issues` or a template such as
 * `repos/{{$json.owner}}/{{$json.repo}}/issues`.
 */
export const GitHubNode: INodeType = {
  description: {
    name: "hermes.github",
    displayName: "GitHub",
    description: "Calls the GitHub REST API with an optional token credential.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const credentials = ctx.getCredential("github") ?? {};
    const baseUrl = String(
      ctx.getParameter<unknown>("baseUrl") ?? credentials.baseUrl ?? "https://api.github.com"
    ).replace(/\/$/, "");
    const methodValue = ctx.getParameter<unknown>("method", "GET");
    const method = typeof methodValue === "string" ? methodValue.toUpperCase() : "";
    const pathValue = ctx.getParameter<unknown>("path");
    const path = typeof pathValue === "string" ? pathValue : "";
    const token = String(credentials.token ?? process.env.GITHUB_TOKEN ?? "").trim();
    const timeoutValue = ctx.getParameter<unknown>("timeoutMs", 20_000);
    const timeoutMs = typeof timeoutValue === "number" ? timeoutValue : Number.NaN;
    const throwOnError = ctx.getParameter<boolean>("throwOnError", true);
    const items = itemsOrSeed(input, ctx);

    if (!path.trim()) {
      throw new Error("GitHub node: 'path' parameter is required.");
    }
    if (!method || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error(`GitHub node: unsupported method "${method}".`);
    }
    if (typeof throwOnError !== "boolean") {
      throw new Error("GitHub node: 'throwOnError' must be a boolean.");
    }

    const output: HermesItems = [];
    for (const item of items) {
      const resolvedPath = String(interpolate(path, item));
      const url = /^https?:\/\//i.test(resolvedPath)
        ? resolvedPath
        : `${baseUrl}/${resolvedPath.replace(/^\//, "")}`;
      requireHttpUrl(url, "GitHub node");

      const rawBody = interpolate(ctx.getParameter<unknown>("body"), item);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Hermes-Automation",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const result = await fetchJson(url, {
        method,
        headers,
        body: method === "GET" || method === "DELETE" || rawBody === undefined
          ? undefined
          : JSON.stringify(rawBody),
      }, timeoutMs, "GitHub node");

      if (throwOnError && !result.ok) {
        throw new Error(`GitHub node: ${method} ${resolvedPath} returned status ${result.statusCode}.`);
      }

      output.push({
        ...item,
        json: {
          ...item.json,
          github: result.body,
          statusCode: result.statusCode,
          ok: result.ok,
        },
      });
    }

    return [output];
  },
};
