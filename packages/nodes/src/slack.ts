import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";
import { fetchJson, interpolate, isRecord, itemsOrSeed, requireHttpUrl } from "./utils";

/**
 * Slack integration supporting incoming webhooks and the chat.postMessage API.
 *
 * Credentials are supplied per execution as `slack.webhookUrl`, `slack.token`,
 * and optionally `slack.channel`; environment variables are useful for local runs.
 */
export const SlackNode: INodeType = {
  description: {
    name: "hermes.slack",
    displayName: "Slack",
    description: "Sends a message through a Slack incoming webhook or chat.postMessage.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const credentials = ctx.getCredential("slack") ?? {};
    const webhookUrl = String(
      ctx.getParameter<unknown>("webhookUrl") ?? credentials.webhookUrl ?? process.env.SLACK_WEBHOOK_URL ?? ""
    ).trim();
    const token = String(credentials.token ?? process.env.SLACK_BOT_TOKEN ?? "").trim();
    const channel = String(
      ctx.getParameter<unknown>("channel") ?? credentials.channel ?? process.env.SLACK_CHANNEL ?? ""
    ).trim();
    const timeoutValue = ctx.getParameter<unknown>("timeoutMs", 15_000);
    const timeoutMs = typeof timeoutValue === "number" ? timeoutValue : Number.NaN;
    const throwOnError = ctx.getParameter<boolean>("throwOnError", true);
    const items = itemsOrSeed(input, ctx);

    if (!webhookUrl && !token) {
      throw new Error("Slack node: configure a webhookUrl or a slack token credential.");
    }
    if (!webhookUrl && !channel) {
      throw new Error("Slack node: 'channel' is required when using a Slack token.");
    }
    if (webhookUrl) {
      requireHttpUrl(webhookUrl, "Slack node");
    }
    if (typeof throwOnError !== "boolean") {
      throw new Error("Slack node: 'throwOnError' must be a boolean.");
    }

    const output: HermesItems = [];
    for (const item of items) {
      const configuredText = ctx.getParameter<unknown>("text");
      const interpolatedText = interpolate(configuredText, item);
      const text = typeof interpolatedText === "string" && interpolatedText.length > 0
        ? interpolatedText
        : String(item.json.text ?? item.json.message ?? JSON.stringify(item.json));
      const blocks = interpolate(ctx.getParameter<unknown>("blocks"), item);
      const username = interpolate(ctx.getParameter<unknown>("username"), item);
      const iconEmoji = interpolate(ctx.getParameter<unknown>("iconEmoji"), item);

      const payload: Record<string, unknown> = { text };
      if (blocks !== undefined) payload.blocks = blocks;
      if (username !== undefined) payload.username = username;
      if (iconEmoji !== undefined) payload.icon_emoji = iconEmoji;
      if (channel && !webhookUrl) payload.channel = channel;

      const url = webhookUrl || "https://slack.com/api/chat.postMessage";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!webhookUrl) {
        headers.Authorization = `Bearer ${token}`;
      }
      const result = await fetchJson(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }, timeoutMs, "Slack node");

      const slackFailed = isRecord(result.body) && result.body.ok === false;
      if (throwOnError && (!result.ok || slackFailed)) {
        const reason = isRecord(result.body) && typeof result.body.error === "string" ? `: ${result.body.error}` : "";
        throw new Error(`Slack node: request failed with status ${result.statusCode}${reason}.`);
      }

      output.push({
        ...item,
        json: {
          ...item.json,
          slack: result.body,
          statusCode: result.statusCode,
          ok: result.ok && !slackFailed,
        },
      });
    }

    return [output];
  },
};
