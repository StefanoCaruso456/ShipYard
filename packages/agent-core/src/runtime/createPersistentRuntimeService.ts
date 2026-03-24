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

  recoverStoredRuns();

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
      toolRequest: input.toolRequest ?? null,
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

  function recoverStoredRuns() {
    const recoveredAt = new Date().toISOString();
    const existingRuns = store
      .list()
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const run of existingRuns) {
      if (run.status === "pending") {
        queue.push(run.id);
        continue;
      }

      if (run.status === "running") {
        store.update({
          ...run,
          status: "failed",
          completedAt: recoveredAt,
          error: {
            message:
              "Runtime restarted before this run completed. Review and resubmit if it should continue."
          },
          result: null
        });
      }
    }

    if (queue.length > 0) {
      scheduleProcessing();
    }
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
      const failure = toRunFailure(error);

      store.update({
        ...(store.get(run.id) ?? runningRun),
        status: "failed",
        completedAt: new Date().toISOString(),
        error: failure,
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

function toRunFailure(error: unknown): AgentRunRecord["error"] {
  const fallbackMessage = error instanceof Error ? error.message : "Unknown runtime error.";
  const failure: NonNullable<AgentRunRecord["error"]> = {
    message: fallbackMessage
  };

  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      toolName?: unknown;
      path?: unknown;
    };

    if (typeof candidate.code === "string") {
      failure.code = candidate.code as NonNullable<typeof failure.code>;
    }

    if (typeof candidate.toolName === "string") {
      failure.toolName = candidate.toolName as NonNullable<typeof failure.toolName>;
    }

    if (typeof candidate.path === "string") {
      failure.path = candidate.path;
    }
  }

  if (!failure.code) {
    failure.code = "runtime_error";
  }

  return failure;
}
