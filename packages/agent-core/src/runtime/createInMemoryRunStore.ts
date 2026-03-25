import { cloneRunRecord, type AgentRunRecord, type AgentRunStore } from "./types";

export function createInMemoryRunStore(): AgentRunStore {
  const runs = new Map<string, AgentRunRecord>();

  return {
    async load() {
      return Array.from(runs.values()).reverse().map(cloneRunRecord);
    },
    async create(run) {
      runs.set(run.id, cloneRunRecord(run));
    },
    async update(run) {
      if (!runs.has(run.id)) {
        throw new Error(`Cannot update unknown run: ${run.id}`);
      }

      runs.set(run.id, cloneRunRecord(run));
    },
    async get(id) {
      const run = runs.get(id);

      return run ? cloneRunRecord(run) : null;
    },
    async list() {
      return Array.from(runs.values()).reverse().map(cloneRunRecord);
    }
  };
}
