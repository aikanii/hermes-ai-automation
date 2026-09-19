import ivm from "isolated-vm";
import type { INodeType, HermesItems, NodeExecuteContext } from "@hermes/core";

/**
 * Code: runs user-supplied JavaScript in an isolated V8 context (via isolated-vm),
 * completely separate memory/heap from the main process. This is what makes it safe
 * to let untrusted users write arbitrary JS in a multi-tenant SaaS.
 *
 * The user's code receives `items` (the input array) and must return an array of items.
 * Example user code:
 *   return items.map(item => ({ json: { ...item.json, doubled: item.json.value * 2 } }));
 *
 * Parameters:
 *  - code: string - the JS snippet to run (implicit function body, receives `items`)
 *  - timeoutMs: number - max execution time (default 5000ms), guards against infinite loops
 */
export const CodeNode: INodeType = {
  description: {
    name: "hermes.code",
    displayName: "Code",
    description: "Runs custom JavaScript against the input items in a secure sandbox.",
    outputs: 1,
  },
  async execute(input: HermesItems, ctx: NodeExecuteContext): Promise<HermesItems[]> {
    const code = ctx.getParameter<unknown>("code", "return items;");
    const rawTimeoutMs = ctx.getParameter<unknown>("timeoutMs", 5000);
    const timeoutMs = typeof rawTimeoutMs === "number" ? rawTimeoutMs : Number.NaN;

    if (typeof code !== "string") {
      throw new Error("Code node: 'code' parameter must be a string.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Code node: 'timeoutMs' must be a positive number.");
    }

    const isolate = new ivm.Isolate({ memoryLimit: 64 }); // 64MB cap per execution
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set("global", jail.derefInto());

      // Inject the input items as a JSON-copyable value (no live references to host objects).
      await jail.set("__items__", new ivm.ExternalCopy(input).copyInto());

      const wrappedCode = `
        (function() {
          const items = __items__;
          ${code}
        })()
      `;

      const script = await isolate.compileScript(wrappedCode);
      // `copy: true` is important: without an explicit transfer mode, isolated-vm
      // cannot move the returned array of plain objects back to the host isolate.
      const result = await script.run(context, { timeout: timeoutMs, copy: true });

      if (!Array.isArray(result)) {
        throw new Error("Code node: script must return an array of items.");
      }

      return [result as HermesItems];
    } finally {
      isolate.dispose();
    }
  },
};
