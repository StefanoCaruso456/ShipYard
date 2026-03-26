import { randomUUID } from "node:crypto";

import type { ContextAssembler } from "../context/types";
import { getActiveTraceScope, runWithTraceScope } from "../observability/traceScope";
import type { TraceMetadata } from "../observability/types";
import type { TraceService } from "../observability/types";
import { executeOrchestrationLoop } from "./orchestration";
import {
  createControlPlaneState,
  normalizeControlPlaneState,
  recordApprovalGateDecision,
  syncControlPlaneState
} from "./controlPlane";
import {
  normalizeExternalSyncState,
  normalizeProjectLinks,
  reconcileExternalSyncState
} from "./externalRecordSync";
import { createInMemoryRunStore } from "./createInMemoryRunStore";
import {
  executePhaseExecutionRun,
  normalizePhaseExecutionInput,
  normalizePhaseExecutionState,
  resolvePhaseExecutionApproval
} from "./phaseExecution";
import { createRebuildState, normalizeRebuildState } from "./rebuildState";
import { normalizeRunContextInputValue } from "./schemas";
import type { AgentInstructionRuntime } from "../instructions/types";
import {
  cloneRunRecord,
  type AgentRunRecord,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunStore,
  type AgentRuntimeStatus,
  type ExternalRecordSyncService,
  type ExecuteRun,
  type PersistentAgentRuntimeService,
  type ResolveApprovalGateInput,
  type RunProjectInput,
  type SubmitTaskInput
} from "./types";
import type { RunEvent, ValidationResult } from "../validation/types";

type CreatePersistentRuntimeServiceOptions = {
  instructionRuntime: AgentInstructionRuntime;
  contextAssembler?: ContextAssembler;
  store?: AgentRunStore;
  executeRun?: ExecuteRun;
  traceService?: TraceService;
  externalRecordSync?: ExternalRecordSyncService;
};

const runStatuses: AgentRunStatus[] = ["pending", "running", "paused", "completed", "failed"];
const MAX_VALIDATION_RETRIES = 1;

export async function createPersistentRuntimeService(
  options: CreatePersistentRuntimeServiceOptions
): Promise<PersistentAgentRuntimeService> {
  const store = options.store ?? createInMemoryRunStore();
  const executeRun = options.executeRun ?? defaultExecuteRun;
  const queue: string[] = [];
  const startedAt = new Date().toISOString();
  const runs = new Map<string, AgentRunRecord>(
    (await store.load()).map((run) => {
      const normalized = normalizeRunRecord(run);

      return [normalized.id, cloneRunRecord(normalized)];
    })
  );

  let activeRunId: string | null = null;
  let processing = false;
  let loopScheduled = false;

  await recoverStoredRuns();

  function getStoredRun(id: string) {
    const run = runs.get(id);

    return run ? cloneRunRecord(run) : null;
  }

  function listStoredRuns() {
    return Array.from(runs.values())
      .map((run, index) => ({
        run,
        index
      }))
      .sort((left, right) => {
        const activityOrder = getRunSortTimestamp(right.run).localeCompare(getRunSortTimestamp(left.run));

        if (activityOrder !== 0) {
          return activityOrder;
        }

        const createdOrder = right.run.createdAt.localeCompare(left.run.createdAt);

        if (createdOrder !== 0) {
          return createdOrder;
        }

        return right.index - left.index;
      })
      .map(({ run }) => cloneRunRecord(run));
  }

  async function createStoredRun(run: AgentRunRecord) {
    const normalized = normalizeRunRecord(run);

    runs.set(normalized.id, cloneRunRecord(normalized));

    try {
      await store.create(normalized);
    } catch (error) {
      runs.delete(normalized.id);
      throw error;
    }

    return cloneRunRecord(normalized);
  }

  async function updateStoredRun(run: AgentRunRecord) {
    const normalized = normalizeRunRecord(run);
    const previous = runs.get(normalized.id);

    if (!previous) {
      throw new Error(`Cannot update unknown run: ${normalized.id}`);
    }

    runs.set(normalized.id, cloneRunRecord(normalized));

    try {
      await store.update(normalized);
    } catch (error) {
      runs.set(normalized.id, cloneRunRecord(previous));
      throw error;
    }

    return cloneRunRecord(normalized);
  }

  async function createPersistedRun(run: AgentRunRecord) {
    const preparedRun = prepareRunForExternalSync(run);
    const createdRun = await createStoredRun(preparedRun);

    return syncExternalRun(createdRun);
  }

  async function updatePersistedRun(run: AgentRunRecord) {
    const preparedRun = prepareRunForExternalSync(run);
    const updatedRun = await updateStoredRun(preparedRun);

    return syncExternalRun(updatedRun);
  }

  async function syncRunWithTrace(
    run: AgentRunRecord,
    syncRun: () => Promise<AgentRunRecord>
  ) {
    const traceScope = getActiveTraceScope();

    if (!traceScope) {
      return syncRun();
    }

    const pendingActionCount =
      run.externalSync?.actions.filter((action) => action.status !== "completed").length ?? 0;
    const syncSpan = await traceScope.activeSpan.startChild({
      name: "external-sync:file_mirror",
      spanType: "sync",
      inputSummary: `Sync ${pendingActionCount} outbound external record action(s).`,
      metadata: {
        provider: run.externalSync?.provider ?? "file_mirror",
        pendingActionCount
      },
      tags: ["external-sync", "provider:file_mirror"]
    });

    try {
      const syncedRun = await syncRun();

      syncSpan.annotate({
        pendingActionCount,
        syncedActionCount:
          syncedRun.externalSync?.actions.filter((action) => action.status === "completed").length ??
          0,
        externalRecordCount: syncedRun.externalSync?.records.length ?? 0
      });
      await syncSpan.end({
        status: "completed",
        outputSummary: `Mirrored ${syncedRun.externalSync?.records.length ?? 0} external record(s).`
      });

      return syncedRun;
    } catch (error) {
      const message = error instanceof Error ? error.message : "External record sync failed.";

      await syncSpan.end({
        status: "failed",
        outputSummary: message,
        error: message
      });
      throw error;
    }
  }

  async function performExternalSync(
    run: AgentRunRecord,
    externalRecordSync: ExternalRecordSyncService,
    updateRun: (run: AgentRunRecord) => Promise<AgentRunRecord>
  ) {
    const syncedState = await externalRecordSync.syncRun(run);
    const syncedRun = normalizeRunRecord({
      ...run,
      externalSync: syncedState
    });

    if (didExternalSyncStateChange(run.externalSync, syncedState)) {
      return updateRun(syncedRun);
    }

    return syncedRun;
  }

  async function failExternalSyncGracefully(
    run: AgentRunRecord,
    error: unknown,
    updateRun: (run: AgentRunRecord) => Promise<AgentRunRecord>
  ) {
    const message = error instanceof Error ? error.message : "External record sync failed.";
    const degradedState = normalizeExternalSyncState(run.externalSync);
    const degradedRun = normalizeRunRecord({
      ...run,
      externalSync: {
        ...degradedState,
        status: "degraded",
        lastError: message
      }
    });

    if (didExternalSyncStateChange(run.externalSync, degradedRun.externalSync)) {
      return updateRun(degradedRun);
    }

    return degradedRun;
  }

  async function syncExternalRun(run: AgentRunRecord) {
    const normalized = normalizeRunRecord(run);

    if (!options.externalRecordSync) {
      return normalized;
    }

    const updateRun = async (nextRun: AgentRunRecord) => updateStoredRun(nextRun);

    try {
      return await syncRunWithTrace(normalized, () =>
        performExternalSync(normalized, options.externalRecordSync!, updateRun)
      );
    } catch (error) {
      return failExternalSyncGracefully(normalized, error, updateRun);
    }
  }

  async function submitTask(input: SubmitTaskInput): Promise<AgentRunRecord> {
    const instruction = input.instruction.trim();

    if (!instruction) {
      throw new Error("Task instruction is required.");
    }

    const runId = randomUUID();
    const threadId = input.threadId?.trim() ? input.threadId.trim() : runId;
    const parentRunId = input.parentRunId?.trim() ? input.parentRunId.trim() : null;
    const phaseExecution = normalizePhaseExecutionInput(input.phaseExecution);
    const controlPlane = phaseExecution ? createControlPlaneState(phaseExecution) : null;
    const rebuild = input.rebuild
      ? createRebuildState(input.rebuild, {
          phaseExecution,
          controlPlane,
          runStatus: "pending",
          validationStatus: "not_run"
        })
      : null;

    const run: AgentRunRecord = {
      id: runId,
      threadId,
      parentRunId,
      title: input.title?.trim() ? input.title.trim() : null,
      instruction,
      simulateFailure: input.simulateFailure ?? false,
      toolRequest: input.toolRequest ?? null,
      attachments: normalizeRunAttachments(input.attachments),
      project: normalizeRunProject(input.project),
      context: normalizeRunContextInput(input.context),
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      validationStatus: "not_run",
      lastValidationResult: null,
      orchestration: null,
      phaseExecution,
      controlPlane,
      rebuild,
      rollingSummary: null,
      events: [],
      error: null,
      result: null
    };

    const storedRun = await createPersistedRun(run);
    enqueueRun(storedRun);
    scheduleProcessing();

    return cloneRunRecord(storedRun);
  }

  async function resolveApprovalGate(input: ResolveApprovalGateInput): Promise<AgentRunRecord> {
    const storedRun = getStoredRun(input.runId);

    if (!storedRun) {
      throw new Error(`Run ${input.runId} was not found.`);
    }

    if (!storedRun.phaseExecution) {
      throw new Error(`Run ${input.runId} does not have phase execution state.`);
    }

    const run = normalizeRunRecord(storedRun);
    const phaseExecution = normalizePhaseExecutionState(run.phaseExecution);

    if (!phaseExecution) {
      throw new Error(`Run ${input.runId} phase execution could not be loaded.`);
    }

    const resolution = resolvePhaseExecutionApproval({
      phaseExecution,
      gateId: input.gateId,
      decision: input.decision,
      comment: input.comment
    });
    const controlPlane = syncControlPlaneState(
      run.controlPlane ?? createControlPlaneState(phaseExecution),
      phaseExecution
    );

    recordApprovalGateDecision(
      controlPlane,
      resolution.phase,
      resolution.gate,
      input.decision,
      resolution.summary
    );

    const eventAt = new Date().toISOString();
    const eventType =
      input.decision === "approve"
        ? "approval_gate_approved"
        : input.decision === "reject"
          ? "approval_gate_rejected"
          : "approval_gate_retry_requested";
    const nextStatus = resolution.outcome === "paused" ? "paused" : "pending";
    const updatedRun = normalizeRunRecord({
      ...run,
      status: nextStatus,
      completedAt: null,
      error: null,
      result: null,
      context:
        input.decision === "request_retry" && input.comment?.trim()
          ? appendApprovalFeedbackContext(run.context, resolution, input.comment)
          : run.context,
      phaseExecution,
      controlPlane,
      rollingSummary: {
        text: resolution.summary,
        updatedAt: eventAt,
        source: input.decision === "reject" ? "failure" : "result"
      },
      events: appendRunEvents(run, {
        at: eventAt,
        type: eventType,
        phaseId: resolution.phase.id,
        gateId: resolution.gate.id,
        message: resolution.summary
      })
    });

    const persistedRun = await updatePersistedRun(updatedRun);

    if (nextStatus === "pending") {
      if (!queue.includes(persistedRun.id)) {
        enqueueRun(persistedRun);
      }

      scheduleProcessing();
    }

    return cloneRunRecord(persistedRun);
  }

  function getRun(id: string): AgentRunRecord | null {
    const run = getStoredRun(id);

    return run ? normalizeRunRecord(run) : null;
  }

  function listRuns(): AgentRunRecord[] {
    return listStoredRuns().map(normalizeRunRecord);
  }

  function getStatus(): AgentRuntimeStatus {
    const currentRuns = listStoredRuns();
    const runsByStatus = createRunCounts();

    for (const run of currentRuns) {
      runsByStatus[run.status] += 1;
    }

    return {
      startedAt,
      workerState: processing ? "running" : "idle",
      activeRunId,
      queuedRuns: queue.length,
      totalRuns: currentRuns.length,
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

  function enqueueRun(run: AgentRunRecord) {
    const threadInsertionIndex = findThreadInsertionIndex(run);

    if (threadInsertionIndex === null) {
      queue.push(run.id);
      return;
    }

    queue.splice(threadInsertionIndex, 0, run.id);
  }

  function findThreadInsertionIndex(run: AgentRunRecord) {
    if (!run.parentRunId) {
      return null;
    }

    let lastQueuedRunForThreadIndex = -1;

    for (const [index, queuedRunId] of queue.entries()) {
      const queuedRun = runs.get(queuedRunId);

      if (queuedRun?.threadId === run.threadId) {
        lastQueuedRunForThreadIndex = index;
      }
    }

    if (lastQueuedRunForThreadIndex >= 0) {
      return lastQueuedRunForThreadIndex + 1;
    }

    const activeRun = activeRunId ? runs.get(activeRunId) : null;

    if (activeRun?.threadId === run.threadId) {
      return 0;
    }

    return null;
  }

  async function recoverStoredRuns() {
    const recoveredAt = new Date().toISOString();
    const existingRuns = listStoredRuns()
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const run of existingRuns) {
      if (run.status === "pending") {
        queue.push(run.id);
        continue;
      }

      if (run.status === "paused") {
        continue;
      }

      if (run.status === "running") {
        await updatePersistedRun({
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

        const queuedRun = getStoredRun(runId);

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
            roleFlow: run.rebuild
              ? "ship-rebuild"
              : run.phaseExecution
                ? "phase-execution"
                : "orchestration",
            repoRoot: process.cwd(),
            workspaceIdentifier: options.instructionRuntime.skill.meta.id,
            queuedAt: run.createdAt,
            ...buildRunTraceMetadata(run)
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

          await updateStoredRun(runningRun);
          rootTrace?.annotate(buildRunTraceMetadata(runningRun));

          try {
            const result = runningRun.phaseExecution
              ? await executePhaseExecutionRun({
                  run: runningRun,
                  instructionRuntime: options.instructionRuntime,
                  contextAssembler: options.contextAssembler,
                  executeRun,
                  persistRun: async (updatedRun) => {
                    await updatePersistedRun(normalizeRunRecord(updatedRun));
                  },
                  getRuntimeStatus: () => getStatus()
                })
              : await executeOrchestrationLoop({
                  run: runningRun,
                  instructionRuntime: options.instructionRuntime,
                  contextAssembler: options.contextAssembler,
                  executeRun,
                  persistRun: async (updatedRun) => {
                    await updatePersistedRun(normalizeRunRecord(updatedRun));
                  },
                  getRuntimeStatus: () => getStatus()
                });
            if (result.paused?.reason === "approval_gate") {
              const latestStoredRun = normalizeRunRecord(getStoredRun(run.id) ?? runningRun);
              const pausedRun = normalizeRunRecord({
                ...latestStoredRun,
                status: "paused",
                completedAt: null,
                error: null,
                result: null,
                phaseExecution: result.phaseExecution ?? latestStoredRun.phaseExecution,
                controlPlane: result.controlPlane ?? latestStoredRun.controlPlane,
                rebuild: result.rebuild ?? latestStoredRun.rebuild,
                rollingSummary: {
                  text: result.summary,
                  updatedAt: new Date().toISOString(),
                  source: "result"
                }
              });

              await updatePersistedRun(pausedRun);
              rootTrace?.annotate({
                ...buildRunTraceMetadata(pausedRun),
                finalStatus: pausedRun.status
              });
              await rootTrace?.end({
                status: "completed",
                outputSummary: result.summary,
                metadata: {
                  pausedForApproval: true,
                  gateId: result.paused.gateId,
                  phaseId: result.paused.phaseId
                }
              });
              return;
            }
            const completedAt = new Date().toISOString();
            const validationResult = extractValidationResult(result);
            const latestStoredRun = normalizeRunRecord(getStoredRun(run.id) ?? runningRun);
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

            await updatePersistedRun(completedRun);
            rootTrace?.annotate({
              ...buildRunTraceMetadata(completedRun),
              finalStatus: completedRun.status,
              provider: completedRun.result?.provider ?? null,
              modelId: completedRun.result?.modelId ?? null,
              inputTokens: completedRun.result?.usage?.inputTokens ?? null,
              outputTokens: completedRun.result?.usage?.outputTokens ?? null,
              totalTokens: completedRun.result?.usage?.totalTokens ?? null,
              providerLatencyMs: completedRun.result?.usage?.providerLatencyMs ?? null,
              estimatedCostUsd: completedRun.result?.usage?.estimatedCostUsd ?? null,
              queueDelayMs: computeQueueDelayMs(completedRun),
              changedFiles: extractChangedFilesFromToolResult(
                completedRun.result?.mode === "repo-tool" ? completedRun.result.toolResult : null
              )
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
            const latestStoredRun = normalizeRunRecord(getStoredRun(run.id) ?? runningRun);
            const nextRun = normalizeRunRecord({
              ...latestStoredRun,
              status: retrying ? "pending" : "failed",
              completedAt: retrying ? null : new Date().toISOString(),
              retryCount: retrying ? latestStoredRun.retryCount + 1 : latestStoredRun.retryCount,
              validationStatus: deriveValidationStatus(latestStoredRun, failure),
              lastValidationResult:
                failure.validationResult ?? latestStoredRun.lastValidationResult ?? null,
              events: appendRunEvents(
                latestStoredRun,
                ...createFailureEvents(failure, latestStoredRun.retryCount, retrying)
              ),
              rollingSummary: createFailureRollingSummary(failure, retrying),
              error: retrying ? null : failure,
              result: null
            });

            await updatePersistedRun(nextRun);
            rootTrace?.annotate({
              ...buildRunTraceMetadata(nextRun)
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
    resolveApprovalGate,
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
  const phaseExecution = normalizePhaseExecutionState(run.phaseExecution);
  const controlPlane = normalizeControlPlaneState(run.controlPlane, phaseExecution);

  return {
    ...run,
    threadId: run.threadId?.trim() ? run.threadId.trim() : run.id,
    parentRunId: run.parentRunId?.trim() ? run.parentRunId.trim() : null,
    toolRequest: run.toolRequest ?? null,
    attachments: normalizeRunAttachments(run.attachments),
    project: normalizeRunProject(run.project),
    context: normalizeRunContextInput(run.context),
    retryCount: typeof run.retryCount === "number" ? run.retryCount : 0,
    validationStatus: run.validationStatus ?? "not_run",
    lastValidationResult: run.lastValidationResult ?? null,
    orchestration: normalizeOrchestrationState(run.orchestration),
    phaseExecution,
    controlPlane,
    rebuild: normalizeRebuildState(run.rebuild, {
      phaseExecution,
      controlPlane,
      runStatus: run.status,
      validationStatus: run.validationStatus ?? "not_run",
      updatedAt: controlPlane?.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt,
      lastFailureReason: run.error?.message ?? null
    }),
    externalSync: normalizeExternalSyncState(run.externalSync),
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

function normalizeRunProject(
  project: AgentRunRecord["project"] | SubmitTaskInput["project"]
): RunProjectInput | null {
  if (!project?.id?.trim()) {
    return null;
  }

  return {
    id: project.id.trim(),
    name: project.name?.trim() ? project.name.trim() : null,
    kind: project.kind === "local" ? "local" : "live",
    environment: project.environment?.trim() ? project.environment.trim() : null,
    description: project.description?.trim() ? project.description.trim() : null,
    links: normalizeProjectLinks(project.links),
    folder: project.folder
      ? {
          name: project.folder.name?.trim() ? project.folder.name.trim() : null,
          displayPath: project.folder.displayPath?.trim() ? project.folder.displayPath.trim() : null,
          status:
            project.folder.status === "connected" || project.folder.status === "needs-access"
              ? project.folder.status
              : null,
          provider:
            project.folder.provider === "runtime" ||
            project.folder.provider === "browser-file-system-access"
              ? project.folder.provider
              : null
        }
      : null
  };
}

function prepareRunForExternalSync(run: AgentRunRecord): AgentRunRecord {
  const normalized = normalizeRunRecord(run);

  return normalizeRunRecord({
    ...normalized,
    externalSync: reconcileExternalSyncState(normalized)
  });
}

function didExternalSyncStateChange(
  previous: AgentRunRecord["externalSync"],
  next: AgentRunRecord["externalSync"]
) {
  return JSON.stringify(normalizeExternalSyncState(previous)) !== JSON.stringify(normalizeExternalSyncState(next));
}

function normalizeRunContextInput(
  context: AgentRunRecord["context"] | SubmitTaskInput["context"]
): AgentRunRecord["context"] {
  return normalizeRunContextInputValue(context);
}

function appendApprovalFeedbackContext(
  context: AgentRunRecord["context"],
  resolution: {
    phase: { id: string; name: string };
    gate: { id: string; title: string };
  },
  comment: string
): AgentRunRecord["context"] {
  const normalizedComment = comment.trim();

  if (!normalizedComment) {
    return context;
  }

  return {
    ...context,
    externalContext: [
      ...(context.externalContext ?? []),
      {
        id: `approval-feedback:${resolution.gate.id}:${Date.now()}`,
        kind: "prior_output",
        title: `${resolution.gate.title} feedback`,
        content: `Before ${resolution.phase.name}, the operator requested another pass: ${normalizedComment}`,
        source: "approval_gate",
        format: "markdown"
      }
    ]
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

function extractChangedFilesFromToolResult(toolResult: AgentRunResult["toolResult"] | null | undefined) {
  if (!toolResult?.ok) {
    return [];
  }

  switch (toolResult.toolName) {
    case "edit_file_region":
    case "create_file":
    case "delete_file":
      return [toolResult.data.path];
    default:
      return [];
  }
}

function buildRunTraceMetadata(run: AgentRunRecord): TraceMetadata {
  return {
    threadId: run.threadId,
    parentRunId: run.parentRunId,
    status: run.status,
    retryCount: run.retryCount,
    validationStatus: run.validationStatus,
    attachmentCount: run.attachments.length,
    attachmentKinds: uniqueStrings(run.attachments.map((attachment) => attachment.kind)),
    selectedFileCount: run.context.relevantFiles.length,
    selectedFiles: run.context.relevantFiles.map((file) => ({
      path: file.path,
      source: file.source ?? null,
      reason: file.reason ?? null
    })),
    validationTargetCount: run.context.validationTargets.length,
    validationTargets: run.context.validationTargets,
    requestedToolName: run.toolRequest?.toolName ?? null,
    projectId: run.project?.id ?? null,
    projectName: run.project?.name ?? null,
    projectKind: run.project?.kind ?? null,
    projectFolderPath: run.project?.folder?.displayPath ?? null,
    ...buildOrchestrationTraceMetadata(run.orchestration),
    ...buildPhaseExecutionTraceMetadata(run.phaseExecution),
    ...buildControlPlaneTraceMetadata(run.controlPlane),
    ...buildRebuildTraceMetadata(run.rebuild)
  };
}

function buildOrchestrationTraceMetadata(orchestration: AgentRunRecord["orchestration"]): TraceMetadata {
  if (!orchestration) {
    return {
      orchestrationStatus: null,
      orchestrationIteration: null,
      orchestrationCurrentStepId: null,
      orchestrationNextAction: null,
      orchestrationStepRetryCount: null,
      orchestrationMaxStepRetries: null,
      orchestrationReplanCount: null,
      orchestrationMaxReplans: null
    };
  }

  return {
    orchestrationStatus: orchestration.status,
    orchestrationIteration: orchestration.iteration,
    orchestrationCurrentStepId: orchestration.currentStep?.id ?? null,
    orchestrationNextAction: orchestration.nextAction,
    orchestrationStepRetryCount: orchestration.stepRetryCount,
    orchestrationMaxStepRetries: orchestration.maxStepRetries,
    orchestrationReplanCount: orchestration.replanCount,
    orchestrationMaxReplans: orchestration.maxReplans
  };
}

function buildPhaseExecutionTraceMetadata(runPhaseExecution: AgentRunRecord["phaseExecution"]): TraceMetadata {
  if (!runPhaseExecution) {
    return {
      phaseExecutionStatus: null,
      phaseExecutionCurrentPhaseId: null,
      phaseExecutionCurrentStoryId: null,
      phaseExecutionCurrentTaskId: null,
      phaseExecutionTotalPhases: null,
      phaseExecutionCompletedPhases: null,
      phaseExecutionTotalStories: null,
      phaseExecutionCompletedStories: null,
      phaseExecutionTotalTasks: null,
      phaseExecutionCompletedTasks: null,
      phaseExecutionMaxTaskRetries: null,
      phaseExecutionMaxStoryRetries: null,
      phaseExecutionMaxReplans: null
    };
  }

  return {
    phaseExecutionStatus: runPhaseExecution.status,
    phaseExecutionCurrentPhaseId: runPhaseExecution.current.phaseId,
    phaseExecutionCurrentStoryId: runPhaseExecution.current.storyId,
    phaseExecutionCurrentTaskId: runPhaseExecution.current.taskId,
    phaseExecutionTotalPhases: runPhaseExecution.progress.totalPhases,
    phaseExecutionCompletedPhases: runPhaseExecution.progress.completedPhases,
    phaseExecutionTotalStories: runPhaseExecution.progress.totalStories,
    phaseExecutionCompletedStories: runPhaseExecution.progress.completedStories,
    phaseExecutionTotalTasks: runPhaseExecution.progress.totalTasks,
    phaseExecutionCompletedTasks: runPhaseExecution.progress.completedTasks,
    phaseExecutionMaxTaskRetries: runPhaseExecution.retryPolicy.maxTaskRetries,
    phaseExecutionMaxStoryRetries: runPhaseExecution.retryPolicy.maxStoryRetries,
    phaseExecutionMaxReplans: runPhaseExecution.retryPolicy.maxReplans
  };
}

function buildRebuildTraceMetadata(runRebuild: AgentRunRecord["rebuild"]): TraceMetadata {
  if (!runRebuild) {
    return {
      rebuildStatus: null,
      rebuildScope: null,
      rebuildShipId: null,
      rebuildLabel: null,
      rebuildObjective: null,
      rebuildProjectId: null,
      rebuildRootPath: null,
      rebuildBaseBranch: null,
      rebuildEntryPaths: [],
      rebuildValidationStatus: null,
      rebuildArtifactCount: null,
      rebuildArtifactKinds: [],
      rebuildInterventionCount: null,
      rebuildInterventionKinds: [],
      rebuildLastFailureReason: null
    };
  }

  return {
    rebuildStatus: runRebuild.status,
    rebuildScope: runRebuild.target.scope,
    rebuildShipId: runRebuild.target.shipId,
    rebuildLabel: runRebuild.target.label,
    rebuildObjective: runRebuild.target.objective,
    rebuildProjectId: runRebuild.target.projectId,
    rebuildRootPath: runRebuild.target.rootPath,
    rebuildBaseBranch: runRebuild.target.baseBranch,
    rebuildEntryPaths: runRebuild.target.entryPaths,
    rebuildValidationStatus: runRebuild.validationStatus,
    rebuildArtifactCount: runRebuild.artifactLog.length,
    rebuildArtifactKinds: uniqueStrings(runRebuild.artifactLog.map((artifact) => artifact.kind)),
    rebuildInterventionCount: runRebuild.interventionLog.length,
    rebuildInterventionKinds: uniqueStrings(
      runRebuild.interventionLog.map((intervention) => intervention.kind)
    ),
    rebuildLastFailureReason: runRebuild.lastFailureReason
  };
}

function buildControlPlaneTraceMetadata(controlPlane: AgentRunRecord["controlPlane"]): TraceMetadata {
  if (!controlPlane) {
    return {
      controlPlaneStatus: null,
      controlPlaneArtifactCount: null,
      controlPlaneArtifactKinds: [],
      controlPlaneHandoffCount: null,
      controlPlanePendingHandoffCount: null,
      controlPlaneAcceptedHandoffCount: null,
      controlPlaneCompletedHandoffCount: null,
      controlPlaneWorkPacketCount: null,
      controlPlaneWorkPacketOwnerAgentTypes: [],
      controlPlaneActiveApprovalGateId: null,
      controlPlaneCurrentEntityKind: null,
      controlPlaneCurrentEntityId: null
    };
  }

  return {
    controlPlaneStatus: controlPlane.status,
    controlPlaneArtifactCount: controlPlane.artifacts.length,
    controlPlaneArtifactKinds: uniqueStrings(controlPlane.artifacts.map((artifact) => artifact.kind)),
    controlPlaneHandoffCount: controlPlane.handoffs.length,
    controlPlanePendingHandoffCount: controlPlane.handoffs.filter((handoff) => handoff.status === "created")
      .length,
    controlPlaneAcceptedHandoffCount: controlPlane.handoffs.filter((handoff) => handoff.status === "accepted")
      .length,
    controlPlaneCompletedHandoffCount: controlPlane.handoffs.filter((handoff) => handoff.status === "completed")
      .length,
    controlPlaneWorkPacketCount: controlPlane.handoffs.filter((handoff) => handoff.workPacket !== null).length,
    controlPlaneWorkPacketOwnerAgentTypes: uniqueStrings(
      controlPlane.handoffs.flatMap((handoff) =>
        handoff.workPacket?.ownerAgentTypeId ? [handoff.workPacket.ownerAgentTypeId] : []
      )
    ),
    controlPlaneActiveApprovalGateId: controlPlane.activeApprovalGateId,
    controlPlaneCurrentEntityKind:
      controlPlane.current.taskId != null
        ? "task"
        : controlPlane.current.storyId != null
          ? "story"
          : controlPlane.current.phaseId != null
            ? "phase"
            : null,
    controlPlaneCurrentEntityId:
      controlPlane.current.taskId ?? controlPlane.current.storyId ?? controlPlane.current.phaseId ?? null
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

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function computeQueueDelayMs(run: AgentRunRecord) {
  if (!run.startedAt) {
    return null;
  }

  return new Date(run.startedAt).getTime() - new Date(run.createdAt).getTime();
}

function getRunSortTimestamp(run: AgentRunRecord) {
  return run.completedAt ?? run.startedAt ?? run.createdAt;
}
