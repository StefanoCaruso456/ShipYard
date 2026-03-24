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
import type { RunEvent, ValidationResult } from "../validation/types";

type CreatePersistentRuntimeServiceOptions = {
  instructionRuntime: AgentInstructionRuntime;
  store?: AgentRunStore;
  executeRun?: ExecuteRun;
};

const runStatuses: AgentRunStatus[] = ["pending", "running", "completed", "failed"];
const MAX_VALIDATION_RETRIES = 1;

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
      context: normalizeRunContextInput(input.context),
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      validationStatus: "not_run",
      lastValidationResult: null,
      rollingSummary: null,
      events: [],
      error: null,
      result: null
    };

    store.create(run);
    queue.push(run.id);
    scheduleProcessing();

    return cloneRunRecord(run);
  }

  function getRun(id: string): AgentRunRecord | null {
    const run = store.get(id);

    return run ? normalizeRunRecord(run) : null;
  }

  function listRuns(): AgentRunRecord[] {
    return store.list().map(normalizeRunRecord);
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
          ...normalizeRunRecord(run),
          status: "failed",
          completedAt: recoveredAt,
          validationStatus: normalizeRunRecord(run).validationStatus,
          events: appendRunEvents(normalizeRunRecord(run), {
            at: recoveredAt,
            type: "execution_failed",
            message:
              "Runtime restarted before this run completed. Review and resubmit if it should continue.",
            retryCount: normalizeRunRecord(run).retryCount
          }),
          error: {
            code: "execution_failed",
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

    try {
      let currentRun = normalizeRunRecord(run);

      while (true) {
        const runningRun: AgentRunRecord = normalizeRunRecord({
          ...currentRun,
          status: "running",
          startedAt: currentRun.startedAt ?? new Date().toISOString(),
          completedAt: null,
          error: null
        });

        store.update(runningRun);

        try {
          const result = await executeRun(runningRun, {
            instructionRuntime: options.instructionRuntime
          });
          const completedAt = new Date().toISOString();
          const validationResult = extractValidationResult(result);
          const completedRun = normalizeRunRecord({
            ...(store.get(run.id) ?? runningRun),
            status: "completed",
            completedAt,
            validationStatus: validationResult
              ? validationResult.success
                ? "passed"
                : "failed"
              : runningRun.validationStatus,
            lastValidationResult: validationResult ?? runningRun.lastValidationResult,
            events: validationResult
              ? appendRunEvents(runningRun, createValidationSuccessEvent(result, validationResult))
              : runningRun.events,
            rollingSummary: createResultRollingSummary(result, completedAt),
            error: null,
            result: {
              ...result,
              completedAt
            }
          });

          store.update(completedRun);
          return;
        } catch (error) {
          const failure = toRunFailure(error);
          const retrying = shouldRetryRun(runningRun, failure);
          const nextRun = normalizeRunRecord({
            ...(store.get(run.id) ?? runningRun),
            status: retrying ? "pending" : "failed",
            completedAt: retrying ? null : new Date().toISOString(),
            retryCount: retrying ? runningRun.retryCount + 1 : runningRun.retryCount,
            validationStatus: deriveValidationStatus(runningRun, failure),
            lastValidationResult:
              failure.validationResult ?? runningRun.lastValidationResult ?? null,
            events: appendRunEvents(
              runningRun,
              ...createFailureEvents(failure, runningRun.retryCount, retrying)
            ),
            rollingSummary: createFailureRollingSummary(failure, retrying),
            error: retrying ? null : failure,
            result: null
          });

          store.update(nextRun);

          if (!retrying) {
            return;
          }

          currentRun = nextRun;
        }
      }
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

function toRunFailure(error: unknown): NonNullable<AgentRunRecord["error"]> {
  const fallbackMessage = error instanceof Error ? error.message : "Unknown runtime error.";
  const failure: NonNullable<AgentRunRecord["error"]> = {
    message: fallbackMessage
  };

  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      toolName?: unknown;
      path?: unknown;
      validationResult?: unknown;
      rollback?: unknown;
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

    if (candidate.validationResult && typeof candidate.validationResult === "object") {
      failure.validationResult = candidate.validationResult as ValidationResult;
    }

    if (candidate.rollback && typeof candidate.rollback === "object") {
      failure.rollback = candidate.rollback as NonNullable<typeof failure.rollback>;
    }
  }

  if (!failure.code) {
    failure.code = "execution_failed";
  }

  return failure;
}

function normalizeRunRecord(run: AgentRunRecord): AgentRunRecord {
  return {
    ...run,
    toolRequest: run.toolRequest ?? null,
    context: normalizeRunContextInput(run.context),
    retryCount: typeof run.retryCount === "number" ? run.retryCount : 0,
    validationStatus: run.validationStatus ?? "not_run",
    lastValidationResult: run.lastValidationResult ?? null,
    rollingSummary: normalizeRollingSummary(run.rollingSummary),
    events: Array.isArray(run.events) ? run.events : []
  };
}

function normalizeRunContextInput(
  context: AgentRunRecord["context"] | SubmitTaskInput["context"]
): AgentRunRecord["context"] {
  return {
    objective: context?.objective?.trim() ? context.objective.trim() : null,
    constraints: Array.isArray(context?.constraints)
      ? context.constraints.map((constraint) => constraint.trim()).filter(Boolean)
      : [],
    relevantFiles: Array.isArray(context?.relevantFiles)
      ? context.relevantFiles
          .filter((file) => typeof file?.path === "string" && file.path.trim())
          .map((file) => ({
            path: file.path.trim(),
            excerpt: file.excerpt?.trim() ? file.excerpt.trim() : null,
            startLine: typeof file.startLine === "number" ? file.startLine : null,
            endLine: typeof file.endLine === "number" ? file.endLine : null,
            source: file.source?.trim() ? file.source.trim() : null,
            reason: file.reason?.trim() ? file.reason.trim() : null
          }))
      : [],
    validationTargets: Array.isArray(context?.validationTargets)
      ? context.validationTargets.map((target) => target.trim()).filter(Boolean)
      : []
  };
}

function normalizeRollingSummary(rollingSummary: AgentRunRecord["rollingSummary"]) {
  if (!rollingSummary?.text?.trim()) {
    return null;
  }

  return {
    text: rollingSummary.text.trim(),
    updatedAt: rollingSummary.updatedAt,
    source: rollingSummary.source
  };
}

function extractValidationResult(result: AgentRunResult): ValidationResult | null {
  if (result.mode !== "repo-tool" || !result.toolResult?.ok) {
    return null;
  }

  const candidate = result.toolResult.data as {
    validationResult?: ValidationResult;
  };

  return candidate.validationResult ?? null;
}

function shouldRetryRun(
  run: AgentRunRecord,
  failure: NonNullable<AgentRunRecord["error"]>
) {
  return (
    failure.code === "validation_failed" &&
    failure.rollback?.success === true &&
    run.retryCount < MAX_VALIDATION_RETRIES
  );
}

function deriveValidationStatus(
  run: AgentRunRecord,
  failure: NonNullable<AgentRunRecord["error"]>
) {
  if (failure.rollback?.attempted) {
    return failure.rollback.success ? "rolled_back" : "rollback_failed";
  }

  if (failure.validationResult) {
    return failure.validationResult.success ? "passed" : "failed";
  }

  return run.validationStatus;
}

function appendRunEvents(run: AgentRunRecord, ...events: RunEvent[]) {
  return [...run.events, ...events];
}

function createValidationSuccessEvent(
  result: AgentRunResult,
  validationResult: ValidationResult
): RunEvent {
  return {
    at: new Date().toISOString(),
    type: "validation_succeeded",
    message: "Validation passed after the mutation completed.",
    toolName: result.toolResult?.toolName ?? null,
    path: validationResult.path ?? null,
    retryCount: 0,
    validationResult
  };
}

function createFailureEvents(
  failure: NonNullable<AgentRunRecord["error"]>,
  retryCount: number,
  retrying: boolean
): RunEvent[] {
  const events: RunEvent[] = [];
  const at = new Date().toISOString();

  if (failure.validationResult) {
    events.push({
      at,
      type: "validation_failed",
      message: failure.message,
      toolName: failure.toolName ?? null,
      path: failure.path ?? failure.validationResult.path ?? null,
      retryCount,
      validationResult: failure.validationResult,
      rollback: failure.rollback ?? null
    });
  } else {
    events.push({
      at,
      type: "execution_failed",
      message: failure.message,
      toolName: failure.toolName ?? null,
      path: failure.path ?? null,
      retryCount,
      rollback: failure.rollback ?? null
    });
  }

  if (failure.rollback?.attempted) {
    events.push({
      at,
      type: failure.rollback.success ? "rollback_succeeded" : "rollback_failed",
      message: failure.rollback.message,
      toolName: failure.toolName ?? null,
      path: failure.rollback.path ?? failure.path ?? null,
      retryCount,
      validationResult: failure.validationResult ?? null,
      rollback: failure.rollback
    });
  }

  if (retrying) {
    events.push({
      at,
      type: "retry_scheduled",
      message: `Retrying after validation failure (attempt ${retryCount + 1} of ${MAX_VALIDATION_RETRIES}).`,
      toolName: failure.toolName ?? null,
      path: failure.path ?? failure.validationResult?.path ?? null,
      retryCount: retryCount + 1,
      validationResult: failure.validationResult ?? null,
      rollback: failure.rollback ?? null
    });
  }

  return events;
}

function createResultRollingSummary(
  result: AgentRunResult,
  completedAt: string
): NonNullable<AgentRunRecord["rollingSummary"]> {
  return {
    text: result.summary.trim() || "Run completed successfully.",
    updatedAt: completedAt,
    source: "result"
  };
}

function createFailureRollingSummary(
  failure: NonNullable<AgentRunRecord["error"]>,
  retrying: boolean
): NonNullable<AgentRunRecord["rollingSummary"]> {
  return {
    text: retrying
      ? `Retry scheduled after failure: ${failure.message}`
      : `Run failed: ${failure.message}`,
    updatedAt: new Date().toISOString(),
    source: retrying ? "retry" : "failure"
  };
}
