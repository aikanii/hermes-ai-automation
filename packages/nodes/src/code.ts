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
    const code = ctx.getParameter<string>("code", "return items;");
    const timeoutMs = ctx.getParameter<number>("timeoutMs", 5000);

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
      const resultRef = await script.run(context, { timeout: timeoutMs, promise: true });

      // resultRef may be a primitive or a Reference depending on isolated-vm version/return type.
      const result = resultRef instanceof ivm.Reference ? await resultRef.copy() : resultRef;

      if (!Array.isArray(result)) {
        throw new Error("Code node: script must return an array of items.");
      }

      return [result as HermesItems];
    } finally {
      isolate.dispose();
    }
  },
};
