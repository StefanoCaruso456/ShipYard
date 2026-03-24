import { randomUUID } from "node:crypto";

import type { ContextAssembler } from "../context/types";
import { getActiveTraceScope, runWithTraceScope } from "../observability/traceScope";
import type { TraceService } from "../observability/types";
import { executeOrchestrationLoop } from "./orchestration";
import { createInMemoryRunStore } from "./createInMemoryRunStore";
import {
  executePhaseExecutionRun,
  normalizePhaseExecutionInput,
  normalizePhaseExecutionState
} from "./phaseExecution";
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
  contextAssembler?: ContextAssembler;
  store?: AgentRunStore;
  executeRun?: ExecuteRun;
  traceService?: TraceService;
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
      attachments: normalizeRunAttachments(input.attachments),
      context: normalizeRunContextInput(input.context),
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      validationStatus: "not_run",
      lastValidationResult: null,
      orchestration: null,
      phaseExecution: normalizePhaseExecutionInput(input.phaseExecution),
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
    const rootTrace = options.traceService
      ? await options.traceService.startRun({
          runId: run.id,
          taskId: run.phaseExecution?.current.taskId ?? run.id,
          name: run.title?.trim() || summarizeText(run.instruction, 80),
          inputSummary: run.instruction,
          metadata: {
            runtimeVersion: "0.0.0",
            roleFlow: run.phaseExecution ? "phase-execution" : "orchestration",
            repoRoot: process.cwd(),
            workspaceIdentifier: options.instructionRuntime.skill.meta.id,
            attachmentCount: run.attachments.length,
            queuedAt: run.createdAt
          },
          tags: ["shipyard", "runtime"]
        })
      : null;

    try {
      const executeTrackedRun = async () => {
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
            const result = runningRun.phaseExecution
              ? await executePhaseExecutionRun({
                  run: runningRun,
                  instructionRuntime: options.instructionRuntime,
                  contextAssembler: options.contextAssembler,
                  executeRun,
                  persistRun: (updatedRun) => {
                    store.update(normalizeRunRecord(updatedRun));
                  },
                  getRuntimeStatus: () => getStatus()
                })
              : await executeOrchestrationLoop({
                  run: runningRun,
                  instructionRuntime: options.instructionRuntime,
                  contextAssembler: options.contextAssembler,
                  executeRun,
                  persistRun: (updatedRun) => {
                    store.update(normalizeRunRecord(updatedRun));
                  },
                  getRuntimeStatus: () => getStatus()
                });
            const completedAt = new Date().toISOString();
            const validationResult = extractValidationResult(result);
            const latestStoredRun = normalizeRunRecord(store.get(run.id) ?? runningRun);
            const completedRun = normalizeRunRecord({
              ...latestStoredRun,
              status: "completed",
              completedAt,
              validationStatus: validationResult
                ? validationResult.success
                  ? "passed"
                  : "failed"
                : latestStoredRun.validationStatus,
              lastValidationResult: validationResult ?? latestStoredRun.lastValidationResult,
              events: validationResult
                ? appendRunEvents(latestStoredRun, createValidationSuccessEvent(result, validationResult))
                : latestStoredRun.events,
              rollingSummary: createResultRollingSummary(result, completedAt),
              error: null,
              result: {
                ...result,
                completedAt
              }
            });

            store.update(completedRun);
            rootTrace?.annotate({
              finalStatus: completedRun.status,
              retryCount: completedRun.retryCount,
              validationStatus: completedRun.validationStatus,
              inputTokens: completedRun.result?.usage?.inputTokens ?? null,
              outputTokens: completedRun.result?.usage?.outputTokens ?? null,
              totalTokens: completedRun.result?.usage?.totalTokens ?? null,
              providerLatencyMs: completedRun.result?.usage?.providerLatencyMs ?? null,
              estimatedCostUsd: completedRun.result?.usage?.estimatedCostUsd ?? null
            });
            await rootTrace?.end({
              status: "completed",
              outputSummary: completedRun.result?.summary ?? "Run completed successfully.",
              metadata: {
                completedAt,
                totalDurationMs:
                  completedRun.startedAt && completedRun.completedAt
                    ? new Date(completedRun.completedAt).getTime() -
                      new Date(completedRun.startedAt).getTime()
                    : null
              }
            });
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
            rootTrace?.annotate({
              retryCount: nextRun.retryCount,
              validationStatus: nextRun.validationStatus
            });

            if (!retrying) {
              await rootTrace?.end({
                status: "failed",
                outputSummary: failure.message,
                error: failure.message,
                metadata: {
                  failureCode: failure.code ?? "execution_failed",
                  toolName: failure.toolName ?? null,
                  path: failure.path ?? null,
                  completedAt: nextRun.completedAt
                }
              });
              return;
            }

            currentRun = nextRun;
          }
        }
      };

      if (rootTrace && options.traceService) {
        await runWithTraceScope(
          {
            runId: run.id,
            traceService: options.traceService,
            activeSpan: rootTrace
          },
          executeTrackedRun
        );
      } else {
        await executeTrackedRun();
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
    attachments: normalizeRunAttachments(run.attachments),
    context: normalizeRunContextInput(run.context),
    retryCount: typeof run.retryCount === "number" ? run.retryCount : 0,
            validationStatus: run.validationStatus ?? "not_run",
            lastValidationResult: run.lastValidationResult ?? null,
            orchestration: normalizeOrchestrationState(run.orchestration),
            phaseExecution: normalizePhaseExecutionState(run.phaseExecution),
            rollingSummary: normalizeRollingSummary(run.rollingSummary),
            events: Array.isArray(run.events) ? run.events : []
  };
}

function normalizeRunAttachments(attachments: AgentRunRecord["attachments"] | SubmitTaskInput["attachments"]) {
  return Array.isArray(attachments)
    ? attachments
        .filter((attachment) => typeof attachment?.name === "string" && attachment.name.trim())
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name.trim(),
          mimeType: attachment.mimeType?.trim() ? attachment.mimeType.trim() : null,
          size: typeof attachment.size === "number" ? attachment.size : 0,
          kind: attachment.kind ?? "unknown",
          analysis: {
            status: attachment.analysis?.status ?? "metadata_only",
            summary: attachment.analysis?.summary?.trim()
              ? attachment.analysis.summary.trim()
              : "Attachment uploaded without a detailed analysis summary.",
            excerpt: attachment.analysis?.excerpt?.trim() ? attachment.analysis.excerpt.trim() : null,
            warnings: Array.isArray(attachment.analysis?.warnings)
              ? attachment.analysis.warnings.map((warning) => warning.trim()).filter(Boolean)
              : []
          }
        }))
    : [];
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

function normalizeOrchestrationState(orchestration: AgentRunRecord["orchestration"]) {
  if (!orchestration) {
    return null;
  }

  return {
    status: orchestration.status,
    iteration: typeof orchestration.iteration === "number" ? orchestration.iteration : 0,
    stepRetryCount:
      typeof orchestration.stepRetryCount === "number" ? orchestration.stepRetryCount : 0,
    replanCount: typeof orchestration.replanCount === "number" ? orchestration.replanCount : 0,
    maxStepRetries:
      typeof orchestration.maxStepRetries === "number" ? orchestration.maxStepRetries : 1,
    maxReplans: typeof orchestration.maxReplans === "number" ? orchestration.maxReplans : 1,
    nextAction: orchestration.nextAction ?? null,
    currentStep: orchestration.currentStep ?? null,
    lastPlannerResult: orchestration.lastPlannerResult ?? null,
    lastExecutorResult: orchestration.lastExecutorResult ?? null,
    lastVerifierResult: orchestration.lastVerifierResult ?? null
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
  if (run.phaseExecution) {
    return false;
  }

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
  const traceScope = getActiveTraceScope();

  if (traceScope) {
    for (const event of events) {
      traceScope.activeSpan.addEvent(event.type, {
        message: event.message,
        metadata: {
          at: event.at,
          stepId: event.stepId ?? null,
          phaseId: event.phaseId ?? null,
          storyId: event.storyId ?? null,
          taskId: event.taskId ?? null,
          gateId: event.gateId ?? null,
          path: event.path ?? null,
          toolName: event.toolName ?? null,
          retryCount: event.retryCount ?? null
        }
      });
    }
  }

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

function summarizeText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
