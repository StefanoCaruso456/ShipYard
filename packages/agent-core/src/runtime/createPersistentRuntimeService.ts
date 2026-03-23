import { randomUUID } from "node:crypto";

import { createInMemoryRunStore } from "./createInMemoryRunStore";
import type { AgentInstructionRuntime } from "../instructions/types";
import {
  cloneRunRecord,
  type AgentRunRecord,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunStore,
  type AgentRuntimeStatus,
  type ExecuteRun,
  type PersistentAgentRuntimeService,
  type SubmitTaskInput
} from "./types";

type CreatePersistentRuntimeServiceOptions = {
  instructionRuntime: AgentInstructionRuntime;
  store?: AgentRunStore;
  executeRun?: ExecuteRun;
};

const runStatuses: AgentRunStatus[] = ["pending", "running", "completed", "failed"];

export function createPersistentRuntimeService(
  options: CreatePersistentRuntimeServiceOptions
): PersistentAgentRuntimeService {
  const store = options.store ?? createInMemoryRunStore();
  const executeRun = options.executeRun ?? defaultExecuteRun;
  const queue: string[] = [];
  const startedAt = new Date().toISOString();

  let activeRunId: string | null = null;
  let processing = false;
  let loopScheduled = false;

  function submitTask(input: SubmitTaskInput): AgentRunRecord {
    const instruction = input.instruction.trim();

    if (!instruction) {
      throw new Error("Task instruction is required.");
    }

    const run: AgentRunRecord = {
      id: randomUUID(),
      title: input.title?.trim() ? input.title.trim() : null,
      instruction,
      simulateFailure: input.simulateFailure ?? false,
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null
    };

    store.create(run);
    queue.push(run.id);
    scheduleProcessing();

    return cloneRunRecord(run);
  }

  function getRun(id: string): AgentRunRecord | null {
    return store.get(id);
  }

  function listRuns(): AgentRunRecord[] {
    return store.list();
  }

  function getStatus(): AgentRuntimeStatus {
    const runs = store.list();
    const runsByStatus = createRunCounts();

    for (const run of runs) {
      runsByStatus[run.status] += 1;
    }

    return {
      startedAt,
      workerState: processing ? "running" : "idle",
      activeRunId,
      queuedRuns: queue.length,
      totalRuns: runs.length,
      runsByStatus,
      instructions: {
        skillId: options.instructionRuntime.skill.meta.id,
        loadedAt: options.instructionRuntime.loadedAt
      }
    };
  }

  function scheduleProcessing() {
    if (loopScheduled) {
      return;
    }

    loopScheduled = true;

    queueMicrotask(() => {
      loopScheduled = false;

      if (!processing) {
        void processQueue();
      }
    });
  }

  async function processQueue() {
    if (processing) {
      return;
    }

    processing = true;

    try {
      while (queue.length > 0) {
        const runId = queue.shift();

        if (!runId) {
          continue;
        }

        const queuedRun = store.get(runId);

        if (!queuedRun) {
          continue;
        }

        await processRun(queuedRun);
      }
    } finally {
      processing = false;

      if (queue.length > 0) {
        scheduleProcessing();
      }
    }
  }

  async function processRun(run: AgentRunRecord) {
    activeRunId = run.id;

    const runningRun: AgentRunRecord = {
      ...run,
      status: "running",
      startedAt: new Date().toISOString(),
      error: null
    };

    store.update(runningRun);

    try {
      const result = await executeRun(runningRun, {
        instructionRuntime: options.instructionRuntime
      });
      const completedAt = new Date().toISOString();

      store.update({
        ...(store.get(run.id) ?? runningRun),
        status: "completed",
        completedAt,
        error: null,
        result: {
          ...result,
          completedAt
        }
      });
    } catch (error) {
      store.update({
        ...(store.get(run.id) ?? runningRun),
        status: "failed",
        completedAt: new Date().toISOString(),
        error: {
          message: error instanceof Error ? error.message : "Unknown runtime error."
        },
        result: null
      });
    } finally {
      activeRunId = null;
    }
  }

  return {
    instructionRuntime: options.instructionRuntime,
    submitTask,
    getRun,
    listRuns,
    getStatus
  };
}

async function defaultExecuteRun(
  run: AgentRunRecord,
  context: {
    instructionRuntime: AgentInstructionRuntime;
  }
): Promise<AgentRunResult> {
  await Promise.resolve();

  if (run.simulateFailure) {
    throw new Error("Simulated runtime failure.");
  }

  return {
    mode: "placeholder-execution",
    summary: `Persistent runtime skeleton processed the task using skill ${context.instructionRuntime.skill.meta.id}.`,
    instructionEcho: run.instruction,
    skillId: context.instructionRuntime.skill.meta.id,
    completedAt: new Date().toISOString()
  };
}

function createRunCounts(): Record<AgentRunStatus, number> {
  return Object.fromEntries(runStatuses.map((status) => [status, 0])) as Record<
    AgentRunStatus,
    number
  >;
}
