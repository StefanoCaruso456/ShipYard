import { cloneRunRecord, type AgentRunRecord, type AgentRunStore } from "./types";

export function createInMemoryRunStore(): AgentRunStore {
  const runs = new Map<string, AgentRunRecord>();

  return {
    create(run) {
      runs.set(run.id, cloneRunRecord(run));
    },
    update(run) {
      if (!runs.has(run.id)) {
        throw new Error(`Cannot update unknown run: ${run.id}`);
      }

      runs.set(run.id, cloneRunRecord(run));
    },
    get(id) {
      const run = runs.get(id);

      return run ? cloneRunRecord(run) : null;
    },
    list() {
      return Array.from(runs.values()).reverse().map(cloneRunRecord);
    }
  };
}
