import {
  type ApprovalDecision,
  type ApprovalGateInput,
  type ApprovalGateState,
  cloneRunRecord,
  type AgentRunRecord,
  type AgentRunResult,
  type AgentRuntimeStatus,
  type ExecuteRun,
  type Phase,
  type PhaseExecutionInput,
  type PhaseExecutionProgress,
  type PhaseExecutionRetryPolicy,
  type PhaseExecutionState,
  type PhaseStatus,
  type RunContextInput,
  type Task,
  type TaskStatus,
  type UserStory,
  type ValidationGate,
  type ValidationGateKind,
  type ValidationGateResult
} from "./types";
import type { ValidationResult } from "../validation/types";
import { executeOrchestrationLoop } from "./orchestration";
import { applyFactoryStageExpansion } from "./factoryPlanner";
import { buildFactoryTaskDelegationRuntimeContext } from "./factoryDelegation";
import {
  findFactoryPhaseUnlockDecision,
  findFactoryPhaseVerificationResult
} from "./factoryQualityGates";
import { syncFactoryRunState } from "./factoryMode";
import {
  createControlPlaneState,
  recordPhaseCompleted,
  recordPhaseFailed,
  recordApprovalGateDecision,
  recordApprovalGateWaiting,
  recordPhaseStarted,
  recordStoryCompleted,
  recordStoryFailed,
  recordStoryRetry,
  recordStoryStarted,
  recordTaskCompleted,
  recordTaskFailed,
  recordTaskStarted,
  syncControlPlaneState
} from "./controlPlane";
import { normalizeRebuildState } from "./rebuildState";
import type { AgentInstructionRuntime } from "../instructions/types";
import type { ContextAssembler } from "../context/types";
import { getActiveTraceScope, runWithTraceScope } from "../observability/traceScope";
import type { RunEvent } from "../validation/types";

const DEFAULT_TASK_RETRIES = 1;
const DEFAULT_STORY_RETRIES = 1;

type ExecutePhaseExecutionOptions = {
  run: AgentRunRecord;
  instructionRuntime: AgentInstructionRuntime;
  contextAssembler?: ContextAssembler;
  executeRun: ExecuteRun;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
  getRuntimeStatus: () => AgentRuntimeStatus;
};

type ExecutionFailure = Error & {
  code?: string;
};

type ExternalContextItem = NonNullable<RunContextInput["externalContext"]>[number];

export function normalizePhaseExecutionInput(
  value: PhaseExecutionInput | null | undefined
): PhaseExecutionState | null {
  if (!value?.phases || value.phases.length === 0) {
    return null;
  }

  const retryPolicy = normalizeRetryPolicy(value.retryPolicy);
  const phases: Phase[] = value.phases
    .filter((phase) => phase && typeof phase.id === "string" && phase.id.trim())
    .map((phase) => ({
      id: phase.id.trim(),
      name: phase.name.trim(),
      description: phase.description.trim(),
      approvalGate: normalizeApprovalGate(phase.approvalGate, phase.id.trim(), phase.name.trim()),
      status: "pending" as const,
      completionCriteria: normalizePhaseCriteria(phase.completionCriteria),
      verificationCriteria: normalizePhaseCriteria(phase.verificationCriteria),
      userStories: phase.userStories
        .filter((story) => story && typeof story.id === "string" && story.id.trim())
        .map((story) => ({
          id: story.id.trim(),
          title: story.title.trim(),
          description: story.description.trim(),
          tasks: story.tasks
            .filter((task) => task && typeof task.id === "string" && task.id.trim())
            .map((task) => ({
              id: task.id.trim(),
              instruction: task.instruction.trim(),
              expectedOutcome: task.expectedOutcome.trim(),
              status: "pending" as const,
              toolRequest: task.toolRequest ?? null,
              context: normalizeOptionalContext(task.context),
              validationGates: normalizeValidationGates(task.validationGates),
              requiredSpecialistAgentTypeId: task.requiredSpecialistAgentTypeId ?? null,
              allowedToolNames: task.allowedToolNames ?? null,
              retryCount: 0,
              failureReason: null,
              lastValidationResults: null,
              result: null
            })),
          acceptanceCriteria: story.acceptanceCriteria
            .map((criterion) => criterion.trim())
            .filter(Boolean),
          validationGates: normalizeValidationGates(story.validationGates),
          preferredSpecialistAgentTypeId: story.preferredSpecialistAgentTypeId ?? null,
          status: "pending" as const,
          retryCount: 0,
          failureReason: null,
          lastValidationResults: null
        })),
      failureReason: null,
      lastValidationResults: null
    }))
    .filter((phase) => phase.userStories.length > 0);

  if (phases.length === 0) {
    return null;
  }

  return {
    status: "pending",
    phases,
    activeApprovalGateId: null,
    current: {
      phaseId: null,
      storyId: null,
      taskId: null
    },
    progress: computeProgress(phases),
    retryPolicy,
    lastFailureReason: null
  };
}

export function normalizePhaseExecutionState(
  value: PhaseExecutionState | null | undefined
): PhaseExecutionState | null {
  if (!value?.phases || value.phases.length === 0) {
    return null;
  }

  const phases: Phase[] = value.phases.map((phase) => ({
    id: phase.id.trim(),
    name: phase.name.trim(),
    description: phase.description.trim(),
    approvalGate: normalizeApprovalGateState(phase.approvalGate, phase.id.trim(), phase.name.trim()),
    status: normalizePhaseStatus(phase.status),
    completionCriteria: normalizePhaseCriteria(phase.completionCriteria),
    verificationCriteria: normalizePhaseCriteria(phase.verificationCriteria),
    userStories: phase.userStories.map((story) => ({
      id: story.id.trim(),
      title: story.title.trim(),
      description: story.description.trim(),
      tasks: story.tasks.map((task) => ({
        id: task.id.trim(),
        instruction: task.instruction.trim(),
        expectedOutcome: task.expectedOutcome.trim(),
        status: normalizeTaskStatus(task.status),
        toolRequest: task.toolRequest ?? null,
        context: normalizeOptionalContext(task.context),
        validationGates: normalizeValidationGates(task.validationGates),
        requiredSpecialistAgentTypeId: task.requiredSpecialistAgentTypeId ?? null,
        allowedToolNames: task.allowedToolNames ?? null,
        retryCount: typeof task.retryCount === "number" ? task.retryCount : 0,
        failureReason: task.failureReason?.trim() ? task.failureReason.trim() : null,
        lastValidationResults: normalizeGateResults(task.lastValidationResults),
        result: task.result ?? null
      })),
      acceptanceCriteria: story.acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean),
      validationGates: normalizeValidationGates(story.validationGates),
      preferredSpecialistAgentTypeId: story.preferredSpecialistAgentTypeId ?? null,
      status: normalizePhaseStatus(story.status),
      retryCount: typeof story.retryCount === "number" ? story.retryCount : 0,
      failureReason: story.failureReason?.trim() ? story.failureReason.trim() : null,
      lastValidationResults: normalizeGateResults(story.lastValidationResults)
    })),
    failureReason: phase.failureReason?.trim() ? phase.failureReason.trim() : null,
    lastValidationResults: normalizeGateResults(phase.lastValidationResults)
  }));

  return {
    status: normalizePhaseStatus(value.status),
    phases,
    activeApprovalGateId:
      typeof value.activeApprovalGateId === "string" && value.activeApprovalGateId.trim()
        ? value.activeApprovalGateId.trim()
        : findActiveApprovalGate(phases)?.gate.id ?? null,
    current: normalizeCurrentPointer(value, phases),
    progress: computeProgress(phases),
    retryPolicy: normalizeRetryPolicy(value.retryPolicy),
    lastFailureReason: value.lastFailureReason?.trim() ? value.lastFailureReason.trim() : null
  };
}

export async function executePhaseExecutionRun(
  options: ExecutePhaseExecutionOptions
): Promise<AgentRunResult> {
  const workingRun = cloneRunRecord(options.run);
  const phaseExecution = normalizePhaseExecutionState(workingRun.phaseExecution);

  if (!phaseExecution) {
    throw new Error("Phase execution state is missing.");
  }

  workingRun.phaseExecution = phaseExecution;
  workingRun.controlPlane =
    syncControlPlaneState(workingRun.controlPlane ?? createControlPlaneState(phaseExecution), phaseExecution);
  syncFactoryExecutionState(workingRun, options.run.createdAt);
  phaseExecution.status = "in_progress";

  for (let phaseIndex = 0; phaseIndex < phaseExecution.phases.length; ) {
    const rewindPhaseIndex = await maybeRewindForFactoryUnlock({
      run: workingRun,
      phaseExecution,
      phaseIndex,
      persistRun: options.persistRun
    });

    if (rewindPhaseIndex !== phaseIndex) {
      phaseIndex = rewindPhaseIndex;
      continue;
    }

    const phase = phaseExecution.phases[phaseIndex];

    if (!phase) {
      break;
    }

    if (phase.status === "completed") {
      phaseIndex += 1;
      continue;
    }

    const pauseResult = await maybePauseForApprovalGate({
      run: workingRun,
      phaseExecution,
      phase,
      instructionRuntime: options.instructionRuntime,
      persistRun: options.persistRun
    });

    if (pauseResult) {
      return pauseResult;
    }

    beginPhase(workingRun, phaseExecution, phase);
    await persist(options.persistRun, workingRun);

    let phaseComplete = false;

    while (!phaseComplete) {
      for (const story of phase.userStories) {
        if (story.status === "completed") {
          continue;
        }

        let storyComplete = false;

        while (!storyComplete) {
          beginStory(workingRun, phaseExecution, phase, story);
          await persist(options.persistRun, workingRun);

          for (const task of story.tasks) {
            if (task.status === "completed") {
              continue;
            }

            await executeTask({
              run: workingRun,
              phaseExecution,
              phase,
              story,
              task,
              instructionRuntime: options.instructionRuntime,
              contextAssembler: options.contextAssembler,
              executeRun: options.executeRun,
              persistRun: options.persistRun,
              getRuntimeStatus: options.getRuntimeStatus
            });
          }

          const storyGateResults = evaluateStoryGates(story);
          story.lastValidationResults = storyGateResults;

          if (storyGateResults.every((gate) => gate.success)) {
            story.status = "completed";
            story.failureReason = null;
            recordStoryCompleted(workingRun.controlPlane ?? null, story, storyGateResults);
            appendRunEvents(
              workingRun,
              ...createGateEvents({
                type: "validation_gate_passed",
                phaseId: phase.id,
                storyId: story.id,
                taskId: null,
                results: storyGateResults
              }),
              {
                at: new Date().toISOString(),
                type: "story_completed",
                phaseId: phase.id,
                storyId: story.id,
                taskId: null,
                message: `Story ${story.title} completed.`,
                retryCount: story.retryCount
              }
            );
            updateProgress(phaseExecution);
            workingRun.rollingSummary = {
              text: `Story completed: ${story.title}`,
              updatedAt: new Date().toISOString(),
              source: "result"
            };
            await persist(options.persistRun, workingRun);
            storyComplete = true;
            continue;
          }

          const storyFailureMessage = storyGateResults
            .filter((gate) => !gate.success)
            .map((gate) => gate.message)
            .join(" ");

          story.status = "failed";
          story.failureReason = storyFailureMessage;
          recordStoryFailed(workingRun.controlPlane ?? null, story, storyFailureMessage, storyGateResults);
          appendRunEvents(
            workingRun,
            ...createGateEvents({
              type: "validation_gate_failed",
              phaseId: phase.id,
              storyId: story.id,
              taskId: null,
              results: storyGateResults
            }),
            {
              at: new Date().toISOString(),
              type: "story_failed",
              phaseId: phase.id,
              storyId: story.id,
              taskId: null,
              message: storyFailureMessage,
              retryCount: story.retryCount
            }
          );
          updateProgress(phaseExecution);
          workingRun.rollingSummary = {
            text: `Story validation failed: ${storyFailureMessage}`,
            updatedAt: new Date().toISOString(),
            source: "failure"
          };
          await persist(options.persistRun, workingRun);

          if (story.retryCount >= phaseExecution.retryPolicy.maxStoryRetries) {
            phase.status = "failed";
            phase.failureReason = storyFailureMessage;
            phaseExecution.status = "failed";
            phaseExecution.lastFailureReason = storyFailureMessage;
            recordPhaseFailed(
              workingRun.controlPlane ?? null,
              phase,
              storyFailureMessage,
              phase.lastValidationResults ?? []
            );
            updateProgress(phaseExecution);
            await persist(options.persistRun, workingRun);
            throw createExecutionFailure(storyFailureMessage);
          }

          story.retryCount += 1;
          resetStoryTasks(story);
          story.status = "pending";
          recordStoryRetry(
            workingRun.controlPlane ?? null,
            story,
            story.retryCount,
            `Retrying story ${story.title} after validation gate failure.`
          );
          appendRunEvents(workingRun, {
            at: new Date().toISOString(),
            type: "retry_scheduled",
            phaseId: phase.id,
            storyId: story.id,
            taskId: null,
            message: `Retrying story ${story.title} after validation gate failure.`,
            retryCount: story.retryCount
          });
          updateProgress(phaseExecution);
          workingRun.rollingSummary = {
            text: `Retry scheduled for story ${story.title}`,
            updatedAt: new Date().toISOString(),
            source: "retry"
          };
          await persist(options.persistRun, workingRun);
        }
      }

      const factoryExpansion =
        workingRun.factory && phase.id === "factory-implementation"
          ? applyFactoryStageExpansion({
              factory: workingRun.factory,
              phaseExecution,
              stageId: "implementation",
              updatedAt: new Date().toISOString()
            })
          : null;

      if (factoryExpansion) {
        workingRun.factory = factoryExpansion.factory;
        workingRun.phaseExecution = factoryExpansion.phaseExecution;
        workingRun.controlPlane = syncControlPlaneState(
          workingRun.controlPlane ?? createControlPlaneState(factoryExpansion.phaseExecution),
          factoryExpansion.phaseExecution
        );
        syncFactoryExecutionState(
          workingRun,
          factoryExpansion.decision?.decidedAt ?? options.run.createdAt
        );
        updateProgress(factoryExpansion.phaseExecution);

        if (factoryExpansion.expanded && factoryExpansion.decision) {
          workingRun.rollingSummary = {
            text: factoryExpansion.decision.summary,
            updatedAt: factoryExpansion.decision.decidedAt,
            source: "result"
          };
          await persist(options.persistRun, workingRun);
          continue;
        }
      }

      phase.lastValidationResults = evaluatePhaseGates(phase);

      if (!phase.lastValidationResults.every((gate) => gate.success)) {
        const phaseFailureMessage = phase.lastValidationResults
          .filter((gate) => !gate.success)
          .map((gate) => gate.message)
          .join(" ");
        phase.status = "failed";
        phase.failureReason = phaseFailureMessage;
        phaseExecution.status = "failed";
        phaseExecution.lastFailureReason = phaseFailureMessage;
        recordPhaseFailed(
          workingRun.controlPlane ?? null,
          phase,
          phaseFailureMessage,
          phase.lastValidationResults
        );
        appendRunEvents(
          workingRun,
          ...createGateEvents({
            type: "validation_gate_failed",
            phaseId: phase.id,
            storyId: null,
            taskId: null,
            results: phase.lastValidationResults
          }),
          {
            at: new Date().toISOString(),
            type: "phase_failed",
            phaseId: phase.id,
            storyId: null,
            taskId: null,
            message: phaseFailureMessage
          }
        );
        updateProgress(phaseExecution);
        await persist(options.persistRun, workingRun);
        throw createExecutionFailure(phaseFailureMessage);
      }

      const factoryQualityGatePause = await maybePauseForFactoryQualityGate({
        run: workingRun,
        phaseExecution,
        phase,
        instructionRuntime: options.instructionRuntime,
        persistRun: options.persistRun
      });

      if (factoryQualityGatePause) {
        if ("paused" in factoryQualityGatePause) {
          return factoryQualityGatePause.paused;
        }

        if (factoryQualityGatePause.retryScheduled) {
          continue;
        }
      }

      phase.status = "completed";
      phase.failureReason = null;
      recordPhaseCompleted(workingRun.controlPlane ?? null, phase, phase.lastValidationResults);
      appendRunEvents(
        workingRun,
        ...createGateEvents({
          type: "validation_gate_passed",
          phaseId: phase.id,
          storyId: null,
          taskId: null,
          results: phase.lastValidationResults
        }),
        {
          at: new Date().toISOString(),
          type: "phase_completed",
          phaseId: phase.id,
          storyId: null,
          taskId: null,
          message: `Phase ${phase.name} completed.`
        }
      );
      updateProgress(phaseExecution);
      workingRun.rollingSummary = {
        text: `Phase completed: ${phase.name}`,
        updatedAt: new Date().toISOString(),
        source: "result"
      };
      await persist(options.persistRun, workingRun);
      phaseComplete = true;
    }

    phaseIndex += 1;
  }

  phaseExecution.status = "completed";
  phaseExecution.current = {
    phaseId: null,
    storyId: null,
    taskId: null
  };
  phaseExecution.lastFailureReason = null;
  updateProgress(phaseExecution);
  workingRun.validationStatus = "passed";
  workingRun.rollingSummary = {
    text: renderFinalSummary(phaseExecution),
    updatedAt: new Date().toISOString(),
    source: "result"
  };
  await persist(options.persistRun, workingRun);

  return {
    mode: options.run.rebuild ? "ship-rebuild" : "phase-execution",
    summary: renderFinalSummary(phaseExecution),
    instructionEcho: options.run.instruction,
    skillId: options.instructionRuntime.skill.meta.id,
    completedAt: new Date().toISOString(),
    responseText: renderPhaseExecutionResponse(phaseExecution),
    phaseExecution,
    controlPlane: workingRun.controlPlane ?? null,
    rebuild: normalizeRebuildState(workingRun.rebuild, {
      phaseExecution,
      controlPlane: workingRun.controlPlane ?? null,
      runStatus: "completed",
      validationStatus: "passed"
    })
  };
}

export function resolvePhaseExecutionApproval(options: {
  phaseExecution: PhaseExecutionState;
  gateId: string;
  decision: ApprovalDecision;
  comment?: string | null;
}) {
  const match = findApprovalGateById(options.phaseExecution.phases, options.gateId);

  if (!match) {
    throw new Error(`Approval gate ${options.gateId} was not found.`);
  }

  const { phase, phaseIndex, gate } = match;
  const decidedAt = new Date().toISOString();
  const comment = options.comment?.trim() ? options.comment.trim() : null;

  gate.decisions.push({
    id: `approval-decision:${gate.id}:${gate.decisions.length + 1}`,
    decision: options.decision,
    comment,
    decidedAt
  });

  if (options.decision === "approve") {
    gate.status = "approved";
    gate.resolvedAt = decidedAt;
    options.phaseExecution.activeApprovalGateId = null;
    options.phaseExecution.status = "pending";
    options.phaseExecution.lastFailureReason = null;

    return {
      phase,
      gate,
      outcome: "resume" as const,
      summary: `Approved ${gate.title} for ${phase.name}.`
    };
  }

  if (options.decision === "reject") {
    gate.status = "rejected";
    gate.resolvedAt = decidedAt;
    options.phaseExecution.activeApprovalGateId = gate.id;
    options.phaseExecution.status = "blocked";
    options.phaseExecution.lastFailureReason = comment ?? `Approval rejected for ${phase.name}.`;

    return {
      phase,
      gate,
      outcome: "paused" as const,
      summary: comment ?? `Approval rejected for ${phase.name}.`
    };
  }

  if (phaseIndex === 0) {
    throw new Error("Cannot request a retry before the first gated phase.");
  }

  gate.status = "pending";
  gate.waitingAt = null;
  gate.resolvedAt = null;
  options.phaseExecution.activeApprovalGateId = null;
  options.phaseExecution.status = "pending";
  options.phaseExecution.lastFailureReason = null;
  resetPhasesForApprovalRetry(options.phaseExecution.phases, phaseIndex - 1, phaseIndex);

  return {
    phase,
    gate,
    outcome: "retry_requested" as const,
    summary: comment ?? `Retry requested before ${phase.name}.`
  };
}

async function maybeRewindForFactoryUnlock(options: {
  run: AgentRunRecord;
  phaseExecution: PhaseExecutionState;
  phaseIndex: number;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
}) {
  if (!options.run.factory || options.phaseIndex <= 0) {
    return options.phaseIndex;
  }

  const previousPhase = options.phaseExecution.phases[options.phaseIndex - 1];

  if (!previousPhase) {
    return options.phaseIndex;
  }

  syncFactoryExecutionState(options.run, new Date().toISOString());

  const verificationResult = findFactoryPhaseVerificationResult(options.run.factory, previousPhase.id);
  const unlockDecision = findFactoryPhaseUnlockDecision(options.run.factory, previousPhase.id);

  if (
    previousPhase.status !== "completed" ||
    verificationResult?.status === "passed" ||
    unlockDecision?.outcome === "unlocked"
  ) {
    return options.phaseIndex;
  }

  previousPhase.status = "in_progress";
  previousPhase.failureReason =
    unlockDecision?.summary ??
    verificationResult?.summary ??
    "Factory verification must pass before the next phase can start.";
  options.phaseExecution.status = "in_progress";
  options.phaseExecution.current = {
    phaseId: previousPhase.id,
    storyId: previousPhase.userStories.find((story) => story.status !== "completed")?.id ?? null,
    taskId: null
  };
  options.phaseExecution.lastFailureReason = previousPhase.failureReason;
  updateProgress(options.phaseExecution);
  options.run.rollingSummary = {
    text: previousPhase.failureReason,
    updatedAt: new Date().toISOString(),
    source: "failure"
  };
  await persist(options.persistRun, options.run);

  return options.phaseIndex - 1;
}

function beginPhase(run: AgentRunRecord, phaseExecution: PhaseExecutionState, phase: Phase) {
  phase.status = "in_progress";
  phase.failureReason = null;
  phaseExecution.current = {
    phaseId: phase.id,
    storyId: null,
    taskId: null
  };
  updateProgress(phaseExecution);
  recordPhaseStarted(run.controlPlane ?? null, phase, run.factory ?? null);
  appendRunEvents(run, {
    at: new Date().toISOString(),
    type: "phase_started",
    phaseId: phase.id,
    storyId: null,
    taskId: null,
    message: `Phase ${phase.name} started.`
  });
}

async function maybePauseForApprovalGate(options: {
  run: AgentRunRecord;
  phaseExecution: PhaseExecutionState;
  phase: Phase;
  instructionRuntime: AgentInstructionRuntime;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
}) {
  const gate = options.phase.approvalGate;

  if (!gate) {
    return null;
  }

  if (gate.status === "approved") {
    return null;
  }

  const now = new Date().toISOString();
  const summary =
    gate.status === "rejected"
      ? latestApprovalComment(gate) ?? `Approval rejected for ${options.phase.name}.`
      : `Waiting for approval before ${options.phase.name}.`;

  if (gate.status === "pending") {
    gate.status = "waiting";
    gate.waitingAt = now;
    gate.resolvedAt = null;
    recordApprovalGateWaiting(options.run.controlPlane ?? null, options.phase, gate);
    appendRunEvents(options.run, {
      at: now,
      type: "approval_gate_waiting",
      phaseId: options.phase.id,
      gateId: gate.id,
      message: summary
    });
  }

  options.phaseExecution.status = "blocked";
  options.phaseExecution.activeApprovalGateId = gate.id;
  options.phaseExecution.current = {
    phaseId: options.phase.id,
    storyId: null,
    taskId: null
  };
  options.phaseExecution.lastFailureReason = gate.status === "rejected" ? summary : null;
  updateProgress(options.phaseExecution);
  options.run.rollingSummary = {
    text: summary,
    updatedAt: now,
    source: gate.status === "rejected" ? "failure" : "result"
  };
  await persist(options.persistRun, options.run);

  return {
    mode: options.run.rebuild ? "ship-rebuild" : "phase-execution",
    summary,
    instructionEcho: options.run.instruction,
    skillId: options.instructionRuntime.skill.meta.id,
    completedAt: now,
    phaseExecution: options.phaseExecution,
    controlPlane: options.run.controlPlane ?? null,
    rebuild: normalizeRebuildState(options.run.rebuild, {
      phaseExecution: options.phaseExecution,
      controlPlane: options.run.controlPlane ?? null,
      runStatus: "paused",
      validationStatus: options.run.validationStatus
    }),
    paused: {
      reason: "approval_gate",
      gateId: gate.id,
      gateKind: gate.kind,
      phaseId: options.phase.id,
      summary
    }
  } satisfies AgentRunResult;
}

async function maybePauseForFactoryQualityGate(options: {
  run: AgentRunRecord;
  phaseExecution: PhaseExecutionState;
  phase: Phase;
  instructionRuntime: AgentInstructionRuntime;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
}): Promise<
  | {
      retryScheduled: true;
    }
  | {
      paused: AgentRunResult;
    }
  | null
> {
  if (!options.run.factory) {
    return null;
  }

  syncFactoryExecutionState(options.run, new Date().toISOString());

  const verificationResult = findFactoryPhaseVerificationResult(options.run.factory, options.phase.id);
  const unlockDecision = findFactoryPhaseUnlockDecision(options.run.factory, options.phase.id);

  if (
    !verificationResult ||
    !unlockDecision ||
    verificationResult.status === "passed" ||
    unlockDecision.outcome === "unlocked"
  ) {
    return null;
  }

  const retryScheduled = await retryFactoryVerificationFailures({
    run: options.run,
    phaseExecution: options.phaseExecution,
    phase: options.phase,
    verificationResult,
    persistRun: options.persistRun
  });

  if (retryScheduled) {
    return {
      retryScheduled: true
    };
  }

  const now = new Date().toISOString();
  options.phase.status = "blocked";
  options.phase.failureReason = unlockDecision.summary;
  options.phaseExecution.status = "blocked";
  options.phaseExecution.lastFailureReason = unlockDecision.summary;
  options.phaseExecution.current = {
    phaseId: options.phase.id,
    storyId: null,
    taskId: null
  };
  updateProgress(options.phaseExecution);
  options.run.rollingSummary = {
    text: unlockDecision.summary,
    updatedAt: now,
    source: "failure"
  };
  syncFactoryExecutionState(options.run, now);
  await persist(options.persistRun, options.run);

  return {
    paused: {
      mode: options.run.rebuild ? "ship-rebuild" : "phase-execution",
      summary: unlockDecision.summary,
      instructionEcho: options.run.instruction,
      skillId: options.instructionRuntime.skill.meta.id,
      completedAt: now,
      phaseExecution: options.phaseExecution,
      controlPlane: options.run.controlPlane ?? null,
      factory: options.run.factory ?? null,
      rebuild: normalizeRebuildState(options.run.rebuild, {
        phaseExecution: options.phaseExecution,
        controlPlane: options.run.controlPlane ?? null,
        runStatus: "paused",
        validationStatus: options.run.validationStatus
      }),
      paused: {
        reason: "factory_quality_gate",
        phaseId: options.phase.id,
        decisionId: unlockDecision.id,
        summary: unlockDecision.summary,
        recoveryActions: unlockDecision.recoveryActions
      }
    }
  };
}

function beginStory(
  run: AgentRunRecord,
  phaseExecution: PhaseExecutionState,
  phase: Phase,
  story: UserStory
) {
  story.status = "in_progress";
  story.failureReason = null;
  phaseExecution.current = {
    phaseId: phase.id,
    storyId: story.id,
    taskId: null
  };
  updateProgress(phaseExecution);
  recordStoryStarted(run.controlPlane ?? null, story, run.factory ?? null);
  appendRunEvents(run, {
    at: new Date().toISOString(),
    type: "story_started",
    phaseId: phase.id,
    storyId: story.id,
    taskId: null,
    message: `Story ${story.title} started.`,
    retryCount: story.retryCount
  });
}

async function executeTask(options: {
  run: AgentRunRecord;
  phaseExecution: PhaseExecutionState;
  phase: Phase;
  story: UserStory;
  task: Task;
  instructionRuntime: AgentInstructionRuntime;
  contextAssembler?: ContextAssembler;
  executeRun: ExecuteRun;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
  getRuntimeStatus: () => AgentRuntimeStatus;
}) {
  const { run, phaseExecution, phase, story, task } = options;
  task.status = "running";
  task.failureReason = null;
  phaseExecution.current = {
    phaseId: phase.id,
    storyId: story.id,
    taskId: task.id
  };
  updateProgress(phaseExecution);
  recordTaskStarted(run.controlPlane ?? null, story, task, run.factory ?? null);
  run.rollingSummary = {
    text: `Executing ${phase.name} -> ${story.title} -> ${task.id}`,
    updatedAt: new Date().toISOString(),
    source: "result"
  };
  appendRunEvents(run, {
    at: new Date().toISOString(),
    type: "task_started",
    phaseId: phase.id,
    storyId: story.id,
    taskId: task.id,
    message: `Task ${task.id} started.`,
    retryCount: task.retryCount
  });
  await persist(options.persistRun, run);

  let result: AgentRunResult;
  const traceScope = getActiveTraceScope();
  const taskSpan = traceScope
    ? await traceScope.activeSpan.startChild({
        name: `task:${task.id}`,
        spanType: "task",
        inputSummary: task.instruction,
        metadata: {
          phaseId: phase.id,
          storyId: story.id,
          taskId: task.id,
          expectedOutcome: task.expectedOutcome,
          retryCount: task.retryCount
        }
      })
    : null;

  try {
    const executeTaskRun = async () =>
      executeOrchestrationLoop({
        run: createTaskScopedRun(run, phaseExecution, phase, story, task),
        task,
        instructionRuntime: options.instructionRuntime,
        contextAssembler: options.contextAssembler,
        executeRun: options.executeRun,
        persistRun: async (updatedRun) => {
          run.orchestration = updatedRun.orchestration;
          run.result = updatedRun.result;
          run.error = updatedRun.error;
          run.events = updatedRun.events;
          run.validationStatus = updatedRun.validationStatus;
          run.lastValidationResult = updatedRun.lastValidationResult;
          run.rollingSummary = updatedRun.rollingSummary;
          run.phaseExecution = phaseExecution;
          await persist(options.persistRun, run);
        },
        getRuntimeStatus: options.getRuntimeStatus,
        maxStepRetries: phaseExecution.retryPolicy.maxTaskRetries,
        maxReplans: phaseExecution.retryPolicy.maxReplans
      });

    result =
      taskSpan && traceScope
        ? await runWithTraceScope(
            {
              ...traceScope,
              activeSpan: taskSpan
            },
            executeTaskRun
          )
        : await executeTaskRun();
  } catch (error) {
    const failure = createExecutionFailure(
      error instanceof Error ? error.message : "Task execution failed unexpectedly."
    );
    task.retryCount = run.orchestration?.stepRetryCount ?? task.retryCount;
    task.lastValidationResults = run.orchestration?.lastVerifierResult?.validationGateResults ?? null;
    task.status = "failed";
    task.failureReason = failure.message;
    recordTaskFailed(
      run.controlPlane ?? null,
      task,
      failure.message,
      task.lastValidationResults
    );
    appendRunEvents(run, {
      at: new Date().toISOString(),
      type: "task_failed",
      phaseId: phase.id,
      storyId: story.id,
      taskId: task.id,
      stepId: run.orchestration?.currentStep?.id ?? null,
      message: failure.message,
      retryCount: task.retryCount
    });
    taskSpan?.annotate({
      retryCount: task.retryCount,
      validationGateFailures: task.lastValidationResults
        ?.filter((gate) => !gate.success)
        .map((gate) => gate.gateId) ?? [],
      failureReason: failure.message
    });
    await taskSpan?.end({
      status: "failed",
      outputSummary: failure.message,
      error: failure.message
    });
    await persist(options.persistRun, run);
    throw failure;
  }

  const taskGateResults =
    run.orchestration?.lastVerifierResult?.validationGateResults ?? evaluateTaskGates(task, result);

  task.retryCount = run.orchestration?.stepRetryCount ?? task.retryCount;
  task.lastValidationResults = taskGateResults;
  task.result = result;
  run.result = result;

  if (taskGateResults.every((gate) => gate.success)) {
    task.status = "completed";
    task.failureReason = null;
    recordTaskCompleted(run.controlPlane ?? null, task, result, taskGateResults);
    appendRunEvents(
      run,
      ...createGateEvents({
        type: "validation_gate_passed",
        phaseId: phase.id,
        storyId: story.id,
        taskId: task.id,
        results: taskGateResults
      }),
      {
        at: new Date().toISOString(),
        type: "task_completed",
        phaseId: phase.id,
        storyId: story.id,
        taskId: task.id,
        stepId: run.orchestration?.currentStep?.id ?? null,
        message: `Task ${task.id} completed.`,
        retryCount: task.retryCount
      }
    );
    taskSpan?.annotate({
      retryCount: task.retryCount,
      validationGateCount: taskGateResults.length,
      validationPassed: true
    });
    await taskSpan?.end({
      status: "completed",
      outputSummary: result.summary
    });
    updateProgress(phaseExecution);
    await persist(options.persistRun, run);
    return;
  }

  const taskFailureMessage = taskGateResults
    .filter((gate) => !gate.success)
    .map((gate) => gate.message)
    .join(" ");

  task.status = "failed";
  task.failureReason = taskFailureMessage;
  recordTaskFailed(run.controlPlane ?? null, task, taskFailureMessage, taskGateResults);
  appendRunEvents(
    run,
    ...createGateEvents({
      type: "validation_gate_failed",
      phaseId: phase.id,
      storyId: story.id,
      taskId: task.id,
      results: taskGateResults
    }),
    {
      at: new Date().toISOString(),
      type: "task_failed",
      phaseId: phase.id,
      storyId: story.id,
      taskId: task.id,
      stepId: run.orchestration?.currentStep?.id ?? null,
      message: taskFailureMessage,
      retryCount: task.retryCount
    }
  );
  taskSpan?.annotate({
    retryCount: task.retryCount,
    validationGateCount: taskGateResults.length,
    validationPassed: false,
    validationGateFailures: taskGateResults
      .filter((gate) => !gate.success)
      .map((gate) => gate.gateId)
  });
  await taskSpan?.end({
    status: "failed",
    outputSummary: taskFailureMessage,
    error: taskFailureMessage
  });
  updateProgress(phaseExecution);
  await persist(options.persistRun, run);
  throw createExecutionFailure(taskFailureMessage);
}

function evaluateTaskGates(task: Task, result: AgentRunResult): ValidationGateResult[] {
  const gates = task.validationGates.length > 0 ? task.validationGates : deriveTaskGates(task, result);
  const evidence = buildTaskEvidence(task, result);

  return gates.map((gate) =>
    evaluateGate(gate, {
      evidence,
      result,
      allTasksCompleted: true,
      allStoriesCompleted: true
    })
  );
}

function evaluateStoryGates(story: UserStory): ValidationGateResult[] {
  const gates = story.validationGates.length > 0 ? story.validationGates : deriveStoryGates(story);
  const evidence = buildStoryEvidence(story);

  return gates.map((gate) =>
    evaluateGate(gate, {
      evidence,
      result: null,
      allTasksCompleted: story.tasks.every((task) => task.status === "completed"),
      allStoriesCompleted: false
    })
  );
}

function evaluatePhaseGates(phase: Phase): ValidationGateResult[] {
  const gates: ValidationGate[] = [
    {
      id: `${phase.id}-all-user-stories-completed`,
      description: `All user stories in ${phase.name} completed.`,
      kind: "all_user_stories_completed"
    }
  ];

  return gates.map((gate) =>
    evaluateGate(gate, {
      evidence: buildPhaseEvidence(phase),
      result: null,
      allTasksCompleted: false,
      allStoriesCompleted: phase.userStories.every((story) => story.status === "completed")
    })
  );
}

function deriveTaskGates(task: Task, result: AgentRunResult): ValidationGate[] {
  const gates: ValidationGate[] = [
    {
      id: `${task.id}-task-completed`,
      description: `Task ${task.id} completed successfully.`,
      kind: "task_completed"
    }
  ];

  if (result.mode === "repo-tool") {
    gates.push({
      id: `${task.id}-tool-result-ok`,
      description: `Repo tool request for ${task.id} returned success.`,
      kind: "tool_result_ok"
    });
    gates.push({
      id: `${task.id}-validation-passed`,
      description: `Repo tool validation for ${task.id} passed.`,
      kind: "validation_passed"
    });
  }

  if (task.expectedOutcome) {
    gates.push({
      id: `${task.id}-expected-outcome`,
      description: `Task evidence includes the expected outcome for ${task.id}.`,
      kind: "evidence_includes",
      expectedValue: task.expectedOutcome
    });
  }

  return gates;
}

function deriveStoryGates(story: UserStory): ValidationGate[] {
  const gates: ValidationGate[] = [
    {
      id: `${story.id}-all-tasks-completed`,
      description: `All tasks in ${story.title} completed.`,
      kind: "all_tasks_completed"
    }
  ];

  for (const criterion of story.acceptanceCriteria) {
    gates.push({
      id: `${story.id}-${slugify(criterion)}`,
      description: `Story evidence includes acceptance criterion: ${criterion}`,
      kind: "evidence_includes",
      expectedValue: criterion
    });
  }

  return gates;
}

function evaluateGate(
  gate: ValidationGate,
  input: {
    evidence: string;
    result: AgentRunResult | null;
    allTasksCompleted: boolean;
    allStoriesCompleted: boolean;
  }
): ValidationGateResult {
  switch (gate.kind) {
    case "task_completed":
      return createGateResult(gate, input.result !== null, "Task produced a result.");
    case "all_tasks_completed":
      return createGateResult(gate, input.allTasksCompleted, "Every task reached completed state.");
    case "all_user_stories_completed":
      return createGateResult(
        gate,
        input.allStoriesCompleted,
        "Every user story reached completed state."
      );
    case "tool_result_ok":
      return createGateResult(
        gate,
        input.result?.mode === "repo-tool" && input.result.toolResult?.ok === true,
        "Repo tool returned success."
      );
    case "validation_passed":
      {
        const validationResult =
          input.result?.mode === "repo-tool" && input.result.toolResult?.ok === true
            ? ((input.result.toolResult.data as { validationResult?: ValidationResult })
                .validationResult ?? null)
            : null;

        return createGateResult(
          gate,
          validationResult?.success === true,
          "Repo tool validation passed."
        );
      }
    case "result_summary_includes":
      return createGateResult(
        gate,
        includesNormalized(input.result?.summary ?? "", gate.expectedValue ?? ""),
        `Summary includes "${gate.expectedValue ?? ""}".`
      );
    case "response_text_includes":
      return createGateResult(
        gate,
        includesNormalized(input.result?.responseText ?? "", gate.expectedValue ?? ""),
        `Response includes "${gate.expectedValue ?? ""}".`
      );
    case "event_type_present":
      return createGateResult(gate, false, "Event presence gates are not supported yet.");
    case "evidence_includes":
      return createGateResult(
        gate,
        includesNormalized(input.evidence, gate.expectedValue ?? ""),
        `Execution evidence includes "${gate.expectedValue ?? ""}".`
      );
  }
}

function createGateResult(
  gate: ValidationGate,
  success: boolean,
  baseMessage: string
): ValidationGateResult {
  return {
    gateId: gate.id,
    description: gate.description,
    kind: gate.kind,
    success,
    message: success ? baseMessage : `Validation gate failed: ${gate.description}`,
    expectedValue: gate.expectedValue ?? null
  };
}

function createTaskScopedRun(
  run: AgentRunRecord,
  phaseExecution: PhaseExecutionState,
  phase: Phase,
  story: UserStory,
  task: Task
): AgentRunRecord {
  const scopedRun = cloneRunRecord(run);
  const factoryDelegationContext = buildFactoryTaskDelegationRuntimeContext({
    factory: run.factory ?? null,
    phase,
    story,
    task
  });

  scopedRun.instruction = task.instruction;
  scopedRun.title = `${phase.name} / ${story.title} / ${task.id}`;
  scopedRun.toolRequest = task.toolRequest;
  const mergedContext = mergeContexts(run.context, task.context, {
    objective: task.expectedOutcome || story.title || phase.name,
    constraints: story.acceptanceCriteria.map((criterion) => `Acceptance criterion: ${criterion}`),
    specialistAgentTypeId:
      task.requiredSpecialistAgentTypeId ??
      task.context?.specialistAgentTypeId ??
      story.preferredSpecialistAgentTypeId ??
      run.context.specialistAgentTypeId ??
      null
  });
  scopedRun.context = {
    ...mergedContext,
    constraints: uniqueStrings([
      ...mergedContext.constraints,
      ...factoryDelegationContext.constraints
    ]),
    externalContext: mergeExternalContext(
      mergedContext.externalContext,
      factoryDelegationContext.externalContext ?? []
    ),
    validationTargets: uniqueStrings([
      ...mergedContext.validationTargets,
      ...factoryDelegationContext.validationTargets
    ]),
    specialistAgentTypeId:
      mergedContext.specialistAgentTypeId ??
      factoryDelegationContext.specialistAgentTypeId ??
      null
  };
  scopedRun.orchestration = null;
  scopedRun.phaseExecution = phaseExecution;

  return scopedRun;
}

function mergeContexts(
  base: RunContextInput,
  override: RunContextInput | null,
  additions: {
    objective: string;
    constraints: string[];
    specialistAgentTypeId: RunContextInput["specialistAgentTypeId"];
  }
): RunContextInput {
  return {
    objective: override?.objective?.trim()
      ? override.objective.trim()
      : additions.objective || base.objective || null,
    constraints: uniqueStrings([
      ...base.constraints,
      ...(override?.constraints ?? []),
      ...additions.constraints
    ]),
    relevantFiles:
      override?.relevantFiles && override.relevantFiles.length > 0
        ? override.relevantFiles
        : base.relevantFiles,
    externalContext: mergeExternalContext(base.externalContext, override?.externalContext ?? []),
    validationTargets: uniqueStrings([
      ...base.validationTargets,
      ...(override?.validationTargets ?? [])
    ]),
    specialistAgentTypeId:
      override?.specialistAgentTypeId ??
      additions.specialistAgentTypeId ??
      base.specialistAgentTypeId ??
      null
  };
}

function buildTaskEvidence(task: Task, result: AgentRunResult) {
  return [
    result.summary,
    result.responseText ?? null,
    result.mode === "repo-tool" ? JSON.stringify(result.toolResult) : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildStoryEvidence(story: UserStory) {
  return [
    story.title,
    story.description,
    ...story.tasks.flatMap((task) => [
      task.result?.summary ?? null,
      task.result?.responseText ?? null
    ])
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildPhaseEvidence(phase: Phase) {
  return [
    phase.name,
    phase.description,
    ...phase.userStories.map((story) => buildStoryEvidence(story))
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderFinalSummary(phaseExecution: PhaseExecutionState) {
  return `Phase execution completed across ${phaseExecution.progress.completedPhases}/${phaseExecution.progress.totalPhases} phases, ${phaseExecution.progress.completedStories}/${phaseExecution.progress.totalStories} stories, and ${phaseExecution.progress.completedTasks}/${phaseExecution.progress.totalTasks} tasks.`;
}

function renderPhaseExecutionResponse(phaseExecution: PhaseExecutionState) {
  return phaseExecution.phases
    .map((phase) =>
      [
        `Phase: ${phase.name} (${phase.status})`,
        ...phase.userStories.map((story) =>
          [
            `Story: ${story.title} (${story.status})`,
            ...story.tasks.map(
              (task) =>
                `Task: ${task.id} (${task.status}) -> ${task.result?.summary ?? task.expectedOutcome}`
            )
          ].join("\n")
        )
      ].join("\n")
    )
    .join("\n\n");
}

function appendRunEvents(run: AgentRunRecord, ...events: RunEvent[]) {
  run.events = [...run.events, ...events];
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  for (const event of events) {
    traceScope.activeSpan.addEvent(event.type, {
      message: event.message,
      metadata: {
        at: event.at,
        phaseId: event.phaseId ?? null,
        storyId: event.storyId ?? null,
        taskId: event.taskId ?? null,
        stepId: event.stepId ?? null,
        gateId: event.gateId ?? null,
        path: event.path ?? null,
        toolName: event.toolName ?? null,
        retryCount: event.retryCount ?? null,
        validationSucceeded: event.validationResult?.success ?? null,
        rollbackAttempted: event.rollback?.attempted ?? null,
        rollbackSucceeded: event.rollback?.success ?? null
      }
    });
  }
}

function createGateEvents(input: {
  type: "validation_gate_passed" | "validation_gate_failed";
  phaseId: string | null;
  storyId: string | null;
  taskId: string | null;
  results: ValidationGateResult[];
}) {
  const now = new Date().toISOString();

  return input.results.map<RunEvent>((result) => ({
    at: now,
    type: input.type,
    phaseId: input.phaseId,
    storyId: input.storyId,
    taskId: input.taskId,
    gateId: result.gateId,
    message: result.message
  }));
}

function updateProgress(phaseExecution: PhaseExecutionState) {
  phaseExecution.progress = computeProgress(phaseExecution.phases);
}

function computeProgress(phases: Phase[]): PhaseExecutionProgress {
  const totalPhases = phases.length;
  const totalStories = phases.reduce((count, phase) => count + phase.userStories.length, 0);
  const totalTasks = phases.reduce(
    (count, phase) =>
      count +
      phase.userStories.reduce((storyCount, story) => storyCount + story.tasks.length, 0),
    0
  );

  return {
    totalPhases,
    completedPhases: phases.filter((phase) => phase.status === "completed").length,
    totalStories,
    completedStories: phases.reduce(
      (count, phase) =>
        count + phase.userStories.filter((story) => story.status === "completed").length,
      0
    ),
    totalTasks,
    completedTasks: phases.reduce(
      (count, phase) =>
        count +
        phase.userStories.reduce(
          (storyCount, story) =>
            storyCount + story.tasks.filter((task) => task.status === "completed").length,
          0
        ),
      0
    )
  };
}

function normalizeRetryPolicy(
  value: Partial<PhaseExecutionRetryPolicy> | PhaseExecutionRetryPolicy | null | undefined
): PhaseExecutionRetryPolicy {
  return {
    maxTaskRetries:
      typeof value?.maxTaskRetries === "number" && value.maxTaskRetries >= 0
        ? value.maxTaskRetries
        : DEFAULT_TASK_RETRIES,
    maxStoryRetries:
      typeof value?.maxStoryRetries === "number" && value.maxStoryRetries >= 0
        ? value.maxStoryRetries
        : DEFAULT_STORY_RETRIES,
    maxReplans:
      typeof value?.maxReplans === "number" && value.maxReplans >= 0
        ? value.maxReplans
        : DEFAULT_TASK_RETRIES
  };
}

function normalizeValidationGates(value: ValidationGate[] | null | undefined) {
  return Array.isArray(value)
    ? value
        .filter((gate) => gate && typeof gate.description === "string" && gate.description.trim())
        .map((gate, index) => ({
          id: gate.id?.trim() ? gate.id.trim() : `gate-${index + 1}`,
          description: gate.description.trim(),
          kind: normalizeGateKind(gate.kind),
          expectedValue: gate.expectedValue?.trim() ? gate.expectedValue.trim() : null
        }))
    : [];
}

function normalizePhaseCriteria(value: string[] | null | undefined) {
  return uniqueStrings(Array.isArray(value) ? value : []);
}

function normalizeApprovalGate(
  value: ApprovalGateInput | ApprovalGateState | null | undefined,
  phaseId: string,
  phaseName: string
): ApprovalGateState | null {
  if (!value || typeof value.kind !== "string") {
    return null;
  }

  const kind =
    value.kind === "architecture" ||
    value.kind === "implementation" ||
    value.kind === "deployment"
      ? value.kind
      : null;

  if (!kind) {
    return null;
  }

  const title =
    typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : defaultApprovalGateTitle(kind);
  const instructions =
    typeof value.instructions === "string" && value.instructions.trim()
      ? value.instructions.trim()
      : null;
  const status =
    "status" in value &&
    (value.status === "waiting" ||
      value.status === "approved" ||
      value.status === "rejected" ||
      value.status === "pending")
      ? value.status
      : "pending";
  const decisions =
    "decisions" in value && Array.isArray(value.decisions)
      ? value.decisions
          .filter(
            (decision) =>
              decision &&
              (decision.decision === "approve" ||
                decision.decision === "reject" ||
                decision.decision === "request_retry") &&
              typeof decision.decidedAt === "string"
          )
          .map((decision, index) => ({
            id:
              typeof decision.id === "string" && decision.id.trim()
                ? decision.id.trim()
                : `approval-decision:${phaseId}:${index + 1}`,
            decision: decision.decision,
            comment:
              typeof decision.comment === "string" && decision.comment.trim()
                ? decision.comment.trim()
                : null,
            decidedAt: decision.decidedAt
          }))
      : [];

  return {
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : `approval:${phaseId}:${kind}`,
    kind,
    title,
    instructions,
    status,
    waitingAt:
      "waitingAt" in value && typeof value.waitingAt === "string" && value.waitingAt.trim()
        ? value.waitingAt
        : null,
    resolvedAt:
      "resolvedAt" in value && typeof value.resolvedAt === "string" && value.resolvedAt.trim()
        ? value.resolvedAt
        : null,
    decisions
  };
}

function normalizeApprovalGateState(
  value: ApprovalGateState | ApprovalGateInput | null | undefined,
  phaseId: string,
  phaseName: string
) {
  return normalizeApprovalGate(value, phaseId, phaseName);
}

function normalizeGateKind(value: ValidationGateKind) {
  return value;
}

function normalizeGateResults(value: ValidationGateResult[] | null | undefined) {
  return Array.isArray(value)
    ? value.map((result) => ({
        gateId: result.gateId,
        description: result.description,
        kind: normalizeGateKind(result.kind),
        success: Boolean(result.success),
        message: result.message,
        expectedValue: result.expectedValue ?? null
      }))
    : null;
}

function normalizeOptionalContext(value: RunContextInput | null | undefined) {
  if (!value) {
    return null;
  }

  return {
    objective: value.objective?.trim() ? value.objective.trim() : null,
    constraints: uniqueStrings(value.constraints ?? []),
    relevantFiles: Array.isArray(value.relevantFiles) ? value.relevantFiles : [],
    externalContext: Array.isArray(value.externalContext) ? value.externalContext : [],
    validationTargets: uniqueStrings(value.validationTargets ?? []),
    specialistAgentTypeId: value.specialistAgentTypeId ?? null
  };
}

function mergeExternalContext(
  base: RunContextInput["externalContext"],
  override: RunContextInput["externalContext"]
) {
  const merged = new Map<string, ExternalContextItem>();

  for (const item of [...(base ?? []), ...(override ?? [])]) {
    if (!item?.id?.trim()) {
      continue;
    }

    merged.set(item.id.trim(), item);
  }

  return [...merged.values()];
}

function normalizePhaseStatus(value: string): PhaseStatus {
  return value === "in_progress" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed"
    ? value
    : "pending";
}

function normalizeTaskStatus(value: string): TaskStatus {
  return value === "running" || value === "completed" || value === "failed" ? value : "pending";
}

function normalizeCurrentPointer(value: PhaseExecutionState, phases: PhaseExecutionState["phases"]) {
  const currentPhase =
    phases.find((phase) => phase.id === value.current.phaseId) ??
    phases.find((phase) => phase.status === "in_progress") ??
    phases.find((phase) => phase.status === "blocked") ??
    phases.find((phase) => phase.status !== "completed") ??
    null;
  const currentStory =
    currentPhase?.userStories.find((story) => story.id === value.current.storyId) ??
    currentPhase?.userStories.find((story) => story.status === "in_progress") ??
    currentPhase?.userStories.find((story) => story.status === "blocked") ??
    currentPhase?.userStories.find((story) => story.status !== "completed") ??
    null;
  const currentTask =
    currentStory?.tasks.find((task) => task.id === value.current.taskId) ??
    currentStory?.tasks.find((task) => task.status === "running") ??
    currentStory?.tasks.find((task) => task.status !== "completed") ??
    null;

  return {
    phaseId: currentPhase?.id ?? null,
    storyId: currentStory?.id ?? null,
    taskId: currentTask?.id ?? null
  };
}

function resetStoryTasks(story: UserStory) {
  for (const task of story.tasks) {
    task.status = "pending";
    task.failureReason = null;
    task.lastValidationResults = null;
    task.result = null;
  }
}

async function retryFactoryVerificationFailures(options: {
  run: AgentRunRecord;
  phaseExecution: PhaseExecutionState;
  phase: Phase;
  verificationResult: NonNullable<ReturnType<typeof findFactoryPhaseVerificationResult>>;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
}) {
  if (!options.verificationResult.recoveryActions.includes("retry_current_phase")) {
    return false;
  }

  const sourceStoryIds = uniqueStrings(
    options.verificationResult.qualityGateResults
      .filter((result) => result.status === "failed")
      .flatMap((result) => result.sourceStoryIds)
  );

  if (sourceStoryIds.length === 0) {
    return false;
  }

  const stories = sourceStoryIds
    .map((storyId) => options.phase.userStories.find((candidate) => candidate.id === storyId) ?? null)
    .filter((story): story is UserStory => Boolean(story));

  if (stories.length === 0) {
    return false;
  }

  if (
    stories.some((story) => story.retryCount >= options.phaseExecution.retryPolicy.maxStoryRetries)
  ) {
    return false;
  }

  const now = new Date().toISOString();

  for (const story of stories) {
    story.retryCount += 1;
    story.status = "pending";
    story.failureReason = null;
    story.lastValidationResults = null;
    resetStoryTasks(story);
    recordStoryRetry(
      options.run.controlPlane ?? null,
      story,
      story.retryCount,
      `Retrying story ${story.title} after Factory verification failed.`
    );
    appendRunEvents(options.run, {
      at: now,
      type: "retry_scheduled",
      phaseId: options.phase.id,
      storyId: story.id,
      taskId: null,
      message: `Retrying story ${story.title} after Factory verification failed.`,
      retryCount: story.retryCount
    });
  }

  options.phase.status = "in_progress";
  options.phase.failureReason = null;
  options.phaseExecution.status = "in_progress";
  options.phaseExecution.lastFailureReason = null;
  options.phaseExecution.current = {
    phaseId: options.phase.id,
    storyId: stories[0]?.id ?? null,
    taskId: null
  };
  updateProgress(options.phaseExecution);
  options.run.rollingSummary = {
    text: options.verificationResult.summary,
    updatedAt: now,
    source: "retry"
  };
  syncFactoryExecutionState(options.run, now);
  await persist(options.persistRun, options.run);

  return true;
}

function resetPhasesForApprovalRetry(
  phases: Phase[],
  startIndex: number,
  retryGatePhaseIndex: number
) {
  for (let phaseIndex = startIndex; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];

    if (!phase) {
      continue;
    }

    phase.status = "pending";
    phase.failureReason = null;
    phase.lastValidationResults = null;

    if (phase.approvalGate && phaseIndex >= retryGatePhaseIndex) {
      phase.approvalGate.status = "pending";
      phase.approvalGate.waitingAt = null;
      phase.approvalGate.resolvedAt = null;
    }

    for (const story of phase.userStories) {
      story.status = "pending";
      story.failureReason = null;
      story.lastValidationResults = null;
      resetStoryTasks(story);
    }
  }
}

function findApprovalGateById(phases: Phase[], gateId: string) {
  for (const [phaseIndex, phase] of phases.entries()) {
    if (phase.approvalGate?.id === gateId) {
      return {
        phase,
        phaseIndex,
        gate: phase.approvalGate
      };
    }
  }

  return null;
}

function findActiveApprovalGate(phases: Phase[]) {
  return (
    phases
      .map((phase) => ({ phase, gate: phase.approvalGate }))
      .find(
        (entry): entry is { phase: Phase; gate: ApprovalGateState } =>
          Boolean(entry.gate && (entry.gate.status === "waiting" || entry.gate.status === "rejected"))
      ) ?? null
  );
}

function defaultApprovalGateTitle(kind: ApprovalGateState["kind"]) {
  switch (kind) {
    case "architecture":
      return "Architecture approval";
    case "implementation":
      return "Implementation approval";
    case "deployment":
      return "Deployment approval";
  }
}

function latestApprovalComment(gate: ApprovalGateState) {
  for (let index = gate.decisions.length - 1; index >= 0; index -= 1) {
    const comment = gate.decisions[index]?.comment?.trim();

    if (comment) {
      return comment;
    }
  }

  return null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function includesNormalized(source: string, target: string) {
  if (!target.trim()) {
    return true;
  }

  return normalizeText(source).includes(normalizeText(target));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "criterion";
}

async function persist(
  persistRun: (run: AgentRunRecord) => void | Promise<void>,
  run: AgentRunRecord
) {
  if (run.phaseExecution) {
    run.controlPlane = syncControlPlaneState(
      run.controlPlane ?? createControlPlaneState(run.phaseExecution),
      run.phaseExecution
    );
  }

  syncFactoryExecutionState(run, new Date().toISOString());

  await persistRun(cloneRunRecord(run));
}

function syncFactoryExecutionState(run: AgentRunRecord, updatedAt: string) {
  if (!run.factory) {
    return;
  }

  run.factory =
    syncFactoryRunState({
      factory: run.factory,
      phaseExecution: run.phaseExecution ?? null,
      controlPlane: run.controlPlane ?? null,
      project: run.project ?? null,
      status: run.status,
      rollingSummary: run.rollingSummary,
      resultSummary: run.result?.summary ?? null,
      updatedAt
    }) ?? run.factory;
}

function createExecutionFailure(message: string) {
  const error = new Error(message) as ExecutionFailure;
  error.code = "execution_failed";
  return error;
}
