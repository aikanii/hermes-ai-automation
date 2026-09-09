import type { INodeType } from "./types";

/**
 * Simple in-memory registry mapping node type identifiers (e.g. "hermes.httpRequest")
 * to their implementation. In later phases this could be backed by a plugin loader
 * that scans a directory, but a plain map is all Phase 0 needs.
 */
class NodeRegistry {
  private nodeTypes = new Map<string, INodeType>();

  register(nodeType: INodeType): void {
    const key = nodeType.description.name;
    if (this.nodeTypes.has(key)) {
      throw new Error(`Node type "${key}" is already registered.`);
    }
    this.nodeTypes.set(key, nodeType);
  }

  get(name: string): INodeType {
    const found = this.nodeTypes.get(name);
    if (!found) {
      throw new Error(`Unknown node type: "${name}". Did you forget to register it?`);
    }
    return found;
  }

  has(name: string): boolean {
    return this.nodeTypes.has(name);
  }

  list(): string[] {
    return Array.from(this.nodeTypes.keys());
  }
}

/** Singleton registry shared across the process. */
export const nodeRegistry = new NodeRegistry();
