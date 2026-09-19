import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateWorkflow, type Workflow } from "@hermes/core";

export interface StoredWorkflow {
  workflow: Workflow;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStore {
  list(): Promise<WorkflowSummary[]>;
  get(id: string): Promise<StoredWorkflow | undefined>;
  upsert(workflow: Workflow): Promise<StoredWorkflow>;
  delete(id: string): Promise<boolean>;
}

type StoreFile = {
  version: 1;
  workflows: StoredWorkflow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredWorkflow(value: unknown): value is StoredWorkflow {
  if (!isRecord(value) || !isRecord(value.workflow)) {
    return false;
  }
  return (
    typeof value.workflow.id === "string" &&
    typeof value.workflow.name === "string" &&
    Array.isArray(value.workflow.nodes) &&
    Array.isArray(value.workflow.connections) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

/**
 * Small JSON-backed repository for the Phase 2 persistence milestone.
 *
 * Writes are serialized and performed through a temporary file before rename, so a
 * process interrupted during a write does not leave a partially-written store.
 * `:memory:` is useful for tests and ephemeral deployments.
 */
export class FileWorkflowStore implements WorkflowStore {
  private readonly filePath: string | undefined;
  private readonly workflows = new Map<string, StoredWorkflow>();
  private readonly ready: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.HERMES_WORKFLOW_STORE ?? resolve(process.cwd(), ".data/workflows.json")) {
    this.filePath = filePath === ":memory:" ? undefined : resolve(filePath);
    this.ready = this.load();
  }

  async list(): Promise<WorkflowSummary[]> {
    await this.ready;
    return [...this.workflows.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ workflow, createdAt, updatedAt }) => ({
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        createdAt,
        updatedAt,
      }));
  }

  async get(id: string): Promise<StoredWorkflow | undefined> {
    await this.ready;
    const stored = this.workflows.get(id);
    return stored ? cloneStoredWorkflow(stored) : undefined;
  }

  async upsert(workflow: Workflow): Promise<StoredWorkflow> {
    await this.ready;
    const now = new Date().toISOString();
    const existing = this.workflows.get(workflow.id);
    const stored: StoredWorkflow = {
      workflow: structuredClone(workflow),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.workflows.set(workflow.id, stored);
    await this.persist();
    return cloneStoredWorkflow(stored);
  }

  async delete(id: string): Promise<boolean> {
    await this.ready;
    const deleted = this.workflows.delete(id);
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  private async load(): Promise<void> {
    if (!this.filePath) {
      return;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.workflows)) {
        throw new Error("workflow store must contain version 1 and a workflows array");
      }
      for (const value of parsed.workflows) {
        if (isStoredWorkflow(value) && validateWorkflow(value.workflow).length === 0) {
          this.workflows.set(value.workflow.id, cloneStoredWorkflow(value));
        }
      }
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }
      throw new Error(
        `Unable to load workflow store at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) {
      return;
    }

    const snapshot: StoreFile = {
      version: 1,
      workflows: [...this.workflows.values()].map(cloneStoredWorkflow),
    };
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath!), { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath!);
    });
    await this.writeQueue;
  }
}

function cloneStoredWorkflow(stored: StoredWorkflow): StoredWorkflow {
  return {
    workflow: structuredClone(stored.workflow),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === "ENOENT";
}
