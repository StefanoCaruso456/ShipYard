import type { ContextAssembler, RoleContextPayload } from "../context/types";
import type { AgentInstructionRuntime } from "../instructions/types";
import { getActiveTraceScope, runWithTraceScope } from "../observability/traceScope";
import type { RunEvent } from "../validation/types";
import type { ExecutorAgentOutput } from "./agents/types";
import { invokeExecutorAgent } from "./agents/executorAgent";
import { invokePlannerAgent } from "./agents/plannerAgent";
import { invokeVerifierAgent } from "./agents/verifierAgent";
import type {
  AgentHandoff
} from "./coordinator/handoffs";
import { createAgentHandoff, createAgentInvocation } from "./coordinator/handoffs";
import {
  collectVerificationConflicts,
  createConflictRecord,
  recordCoordinationConflicts
} from "./coordinator/conflicts";
import { mergeExecutorResult, mergePlannerResult, mergeVerifierResult } from "./coordinator/merge";
import {
  cloneRunRecord,
  type AgentRunFailure,
  type AgentRunRecord,
  type AgentRunResult,
  type AgentRuntimeStatus,
  type ExecuteRun,
  type ExecutorStepResult,
  type OrchestrationAction,
  type OrchestrationState,
  type PlannerStep,
  type PlannerStepResult,
  type RepoMutationToolRequest,
  type Task,
  type ValidationGate,
  type ValidationGateResult,
  type VerifierStepResult
} from "./types";

const DEFAULT_STANDALONE_STEP_RETRIES = 1;
const DEFAULT_REPLAN_RETRIES = 1;

type ExecuteOrchestrationLoopOptions = {
  run: AgentRunRecord;
  task?: Task | null;
  instructionRuntime: AgentInstructionRuntime;
  contextAssembler?: ContextAssembler;
  executeRun: ExecuteRun;
  persistRun: (run: AgentRunRecord) => void | Promise<void>;
  getRuntimeStatus: () => AgentRuntimeStatus;
  maxStepRetries?: number;
  maxReplans?: number;
};

type VerificationInput = {
  run: AgentRunRecord;
  task?: Task | null;
  plannerResult: PlannerStepResult;
  executorResult: ExecutorStepResult;
  executionResult: AgentRunResult | null;
  payload: RoleContextPayload | null;
};

export async function executeOrchestrationLoop(
  options: ExecuteOrchestrationLoopOptions
): Promise<AgentRunResult> {
  const limits = {
    maxStepRetries:
      typeof options.maxStepRetries === "number" && options.maxStepRetries >= 0
        ? options.maxStepRetries
        : DEFAULT_STANDALONE_STEP_RETRIES,
    maxReplans:
      typeof options.maxReplans === "number" && options.maxReplans >= 0
        ? options.maxReplans
        : DEFAULT_REPLAN_RETRIES
  };

  const orchestration = ensureOrchestrationState(options.run, limits);

  while (true) {
    let plannerResult = orchestration.lastPlannerResult;

    if (!orchestration.currentStep) {
      orchestration.status = "planning";
      orchestration.nextAction = "plan";
      options.run.rollingSummary = {
        text: "Planner is selecting the next bounded step.",
        updatedAt: new Date().toISOString(),
        source: "result"
      };
      await persist(options.persistRun, options.run);

      const plannerPayload = await buildRolePayload(
        options.contextAssembler,
        "planner",
        options.run,
        options.getRuntimeStatus()
      );
      const plannerHandoff = createAgentHandoff({
        runId: options.run.id,
        stepId: null,
        source: "coordinator",
        target: "planner",
        purpose: "plan_next_step",
        payload: {
          run: options.run,
          task: options.task ?? null,
          payload: plannerPayload,
          iteration: orchestration.iteration + 1
        }
      });

      await traceHandoffCreation(plannerHandoff);

      const plannerAgentResult = await invokePlannerAgent({
        invocation: createAgentInvocation(plannerHandoff),
        execute: planNextStep
      });

      traceAgentResultReceipt(plannerAgentResult);

      const plannedStepResult = requireAgentOutput({
        result: plannerAgentResult,
        failureCode: "planning_failed",
        fallbackMessage: "Planner did not produce a bounded next step.",
        run: options.run
      });
      plannerResult = plannedStepResult;

      await runMergeWithTrace(
        {
          role: "planner",
          stepId: plannedStepResult.step.id,
          correlationId: plannerHandoff.correlationId,
          summary: plannedStepResult.summary
        },
        async () => {
          mergePlannerResult({
            run: options.run,
            orchestration,
            plannerResult: plannedStepResult,
            appendEvents: appendRunEvents
          });
        }
      );
      await persist(options.persistRun, options.run);
    }

    if (!plannerResult || !orchestration.currentStep) {
      throw createOrchestrationFailure(
        "planning_failed",
        "Planner did not produce a bounded next step.",
        options.run
      );
    }

    const executorPayload = await buildRolePayload(
      options.contextAssembler,
      "executor",
      options.run,
      options.getRuntimeStatus()
    );
    orchestration.status = "executing";
    orchestration.nextAction = null;
    options.run.rollingSummary = {
      text: `Executor is performing ${plannerResult.step.title}.`,
      updatedAt: new Date().toISOString(),
      source: "result"
    };
    await persist(options.persistRun, options.run);

    const executorHandoff = createAgentHandoff({
      runId: options.run.id,
      stepId: plannerResult.step.id,
      source: "planner",
      target: "executor",
      purpose: "execute_planned_step",
      payload: {
        run: options.run,
        plannerStep: plannerResult.step,
        payload: executorPayload,
        executeRun: options.executeRun,
        instructionRuntime: options.instructionRuntime
      }
    });

    await traceHandoffCreation(executorHandoff);

    const executorAgentResult = await invokeExecutorAgent({
      invocation: createAgentInvocation(executorHandoff),
      execute: executeExecutorStep
    });

    traceAgentResultReceipt(executorAgentResult);

    const execution = requireAgentOutput({
      result: executorAgentResult,
      failureCode: "execution_failed",
      fallbackMessage: "Executor agent failed unexpectedly.",
      run: options.run
    });

    await runMergeWithTrace(
      {
        role: "executor",
        stepId: plannerResult.step.id,
        correlationId: executorHandoff.correlationId,
        summary: execution.executorResult.summary
      },
      async () => {
        mergeExecutorResult({
          run: options.run,
          orchestration,
          execution,
          appendEvents: appendRunEvents,
          applyExecutionValidationState
        });
      }
    );
    await persist(options.persistRun, options.run);

    const verifierPayload = await buildRolePayload(
      options.contextAssembler,
      "verifier",
      options.run,
      options.getRuntimeStatus()
    );
    const verifierHandoff = createAgentHandoff({
      runId: options.run.id,
      stepId: plannerResult.step.id,
      source: "executor",
      target: "verifier",
      purpose: "verify_step_execution",
      payload: {
        run: options.run,
        task: options.task ?? null,
        plannerResult,
        executorResult: execution.executorResult,
        executionResult: execution.result,
        payload: verifierPayload
      }
    });

    await traceHandoffCreation(verifierHandoff);

    const verifierAgentResult = await invokeVerifierAgent({
      invocation: createAgentInvocation(verifierHandoff),
      execute: verifyStepResult
    });

    traceAgentResultReceipt(verifierAgentResult);

    const verifierResult = requireAgentOutput({
      result: verifierAgentResult,
      failureCode: "verification_failed",
      fallbackMessage: "Verifier did not produce a decision.",
      run: options.run
    });
    const conflicts = collectVerificationConflicts({
      plannerResult,
      execution,
      verifierResult
    });

    await runMergeWithTrace(
      {
        role: "verifier",
        stepId: plannerResult.step.id,
        correlationId: verifierHandoff.correlationId,
        summary: verifierResult.summary
      },
      async () => {
        mergeVerifierResult({
          run: options.run,
          orchestration,
          verifierResult,
          appendEvents: appendRunEvents
        });
        recordCoordinationConflicts({
          run: options.run,
          conflicts,
          appendEvents: appendRunEvents
        });
      }
    );
    await persist(options.persistRun, options.run);

    switch (verifierResult.decision) {
      case "continue": {
        await traceCoordinatorDecision({
          stepId: plannerResult.step.id,
          decision: "continue",
          summary: verifierResult.summary,
          correlationId: verifierHandoff.correlationId
        });
        orchestration.status = "completed";
        orchestration.nextAction = "continue";
        const completedResult =
          execution.result ??
          ({
            mode: "placeholder-execution",
            summary: execution.executorResult.summary,
            instructionEcho: options.run.instruction,
            skillId: options.instructionRuntime.skill.meta.id,
            completedAt: new Date().toISOString()
          } satisfies AgentRunResult);

        const resultWithOrchestration: AgentRunResult = {
          ...completedResult,
          orchestration: cloneOrchestrationState(orchestration)
        };

        options.run.result = resultWithOrchestration;
        await persist(options.persistRun, options.run);
        return resultWithOrchestration;
      }
      case "retry_step":
        if (orchestration.stepRetryCount >= orchestration.maxStepRetries) {
          const conflict = createConflictRecord({
            type: "retry_cap_exceeded",
            stepId: plannerResult.step.id,
            reason: `${verifierResult.summary} Retry cap reached.`,
            metadata: {
              maxStepRetries: orchestration.maxStepRetries,
              stepRetryCount: orchestration.stepRetryCount
            }
          });

          recordCoordinationConflicts({
            run: options.run,
            conflicts: [conflict],
            appendEvents: appendRunEvents
          });
          await persist(options.persistRun, options.run);
          await traceCoordinatorDecision({
            stepId: plannerResult.step.id,
            decision: "fail",
            summary: `${verifierResult.summary} Retry cap reached.`,
            correlationId: verifierHandoff.correlationId,
            failed: true
          });
          orchestration.status = "failed";
          throw createOrchestrationFailure(
            "verification_failed",
            `${verifierResult.summary} Retry cap reached.`,
            options.run
          );
        }

        await traceCoordinatorDecision({
          stepId: plannerResult.step.id,
          decision: "retry_step",
          summary: verifierResult.summary,
          correlationId: verifierHandoff.correlationId
        });
        orchestration.stepRetryCount += 1;
        options.run.retryCount += 1;
        orchestration.status = "executing";
        appendRunEvents(options.run, {
          at: new Date().toISOString(),
          type: "retry_scheduled",
          stepId: plannerResult.step.id,
          message: `Retrying step ${plannerResult.step.id} after verifier requested another attempt.`,
          retryCount: orchestration.stepRetryCount
        });
        options.run.rollingSummary = {
          text: `Retry scheduled for ${plannerResult.step.id}.`,
          updatedAt: new Date().toISOString(),
          source: "retry"
        };
        await persist(options.persistRun, options.run);
        continue;
      case "replan":
        if (orchestration.replanCount >= orchestration.maxReplans) {
          const conflict = createConflictRecord({
            type: "replan_cap_exceeded",
            stepId: plannerResult.step.id,
            reason: `${verifierResult.summary} Replan cap reached.`,
            metadata: {
              maxReplans: orchestration.maxReplans,
              replanCount: orchestration.replanCount
            }
          });

          recordCoordinationConflicts({
            run: options.run,
            conflicts: [conflict],
            appendEvents: appendRunEvents
          });
          await persist(options.persistRun, options.run);
          await traceCoordinatorDecision({
            stepId: plannerResult.step.id,
            decision: "fail",
            summary: `${verifierResult.summary} Replan cap reached.`,
            correlationId: verifierHandoff.correlationId,
            failed: true
          });
          orchestration.status = "failed";
          throw createOrchestrationFailure(
            "verification_failed",
            `${verifierResult.summary} Replan cap reached.`,
            options.run
          );
        }

        await traceCoordinatorDecision({
          stepId: plannerResult.step.id,
          decision: "replan",
          summary: verifierResult.summary,
          correlationId: verifierHandoff.correlationId
        });
        orchestration.replanCount += 1;
        options.run.retryCount += 1;
        orchestration.stepRetryCount = 0;
        orchestration.currentStep = null;
        orchestration.status = "planning";
        appendRunEvents(options.run, {
          at: new Date().toISOString(),
          type: "replan_requested",
          stepId: plannerResult.step.id,
          message: `Verifier requested a replan after step ${plannerResult.step.id}.`
        });
        options.run.rollingSummary = {
          text: `Replanning after verifier rejected ${plannerResult.step.id}.`,
          updatedAt: new Date().toISOString(),
          source: "retry"
        };
        await persist(options.persistRun, options.run);
        continue;
      case "fail":
        await traceCoordinatorDecision({
          stepId: plannerResult.step.id,
          decision: "fail",
          summary: verifierResult.summary,
          correlationId: verifierHandoff.correlationId,
          failed: true
        });
        orchestration.status = "failed";
        throw createOrchestrationFailure("verification_failed", verifierResult.summary, options.run);
    }
  }
}

export function planNextStep(input: {
  run: AgentRunRecord;
  task: Task | null;
  payload: RoleContextPayload | null;
  iteration: number;
}): PlannerStepResult {
  const at = new Date().toISOString();
  const activeToolRequest = input.task?.toolRequest ?? input.run.toolRequest ?? null;
  const validationTargets = deriveValidationTargets(input.run, input.task, input.payload);
  const successCriteria = deriveSuccessCriteria(input.run, input.task);
  const failureContext = extractSectionContent(input.payload, "known-failures");
  const objective = extractSectionContent(input.payload, "task-objective") ?? input.run.instruction;
  const stepId = `${input.task?.id ?? input.run.id}-step-${input.iteration}`;
  const targetPath = extractToolPath(activeToolRequest);

  return {
    role: "planner",
    at,
    summary: `Planner proposed ${stepId}: ${activeToolRequest ? "execute the scoped repo mutation" : "produce the scoped execution response"}.`,
    consumedContextSectionIds: selectConsumedSectionIds(input.payload, [
      "task-objective",
      "current-run-state",
      "validation-targets",
      "known-failures"
    ]),
    step: {
      id: stepId,
      title: activeToolRequest
        ? `${activeToolRequest.toolName}${targetPath ? ` ${targetPath}` : ""}`
        : summarizeText(input.task?.instruction ?? input.run.instruction, 80),
      kind: activeToolRequest ? "repo_tool" : "model_response",
      rationale: failureContext
        ? `Address the current task conservatively while accounting for the latest failure: ${failureContext}`
        : `Keep the next action bounded to the current task objective: ${objective}`,
      summary: activeToolRequest
        ? `Execute ${activeToolRequest.toolName}${targetPath ? ` on ${targetPath}` : ""}.`
        : `Respond directly to the current task without expanding scope.`,
      successCriteria,
      requiredInputs: targetPath ? [targetPath] : [],
      requiredTool: activeToolRequest?.toolName ?? null,
      toolRequest: activeToolRequest,
      validationTargets
    }
  };
}

export function verifyStepResult(input: VerificationInput): VerifierStepResult {
  const at = new Date().toISOString();
  const evidence = buildVerificationEvidence(input.executionResult, input.executorResult);
  const expectedPath = extractToolPath(input.plannerResult.step.toolRequest);
  const intentMatched =
    input.plannerResult.step.successCriteria.length === 0
      ? input.executorResult.success
      : input.plannerResult.step.successCriteria.every((criterion) =>
          includesNormalized(evidence, criterion)
        );
  const targetMatched = expectedPath
    ? input.executorResult.changedFiles.length > 0
      ? input.executorResult.changedFiles.every((path) => path === expectedPath)
      : input.executorResult.error?.path === expectedPath || input.executorResult.success
    : true;
  const validationPassed = deriveValidationPassed(input.executionResult, input.executorResult);
  const sideEffectsDetected = expectedPath
    ? input.executorResult.changedFiles.some((path) => path !== expectedPath)
    : false;
  const validationGateResults =
    input.task && input.executionResult
      ? evaluateTaskGatesForVerification(input.task, input.executionResult)
      : null;
  const taskValidationPassed = validationGateResults
    ? validationGateResults.every((gate) => gate.success)
    : true;
  const reasons = collectVerificationReasons({
    executorResult: input.executorResult,
    intentMatched,
    targetMatched,
    validationPassed,
    sideEffectsDetected,
    taskValidationPassed,
    validationGateResults
  });
  const state = input.run.orchestration;
  const decision = decideVerifierAction({
    executorResult: input.executorResult,
    intentMatched,
    targetMatched,
    validationPassed,
    sideEffectsDetected,
    taskValidationPassed,
    stepRetryCount: state?.stepRetryCount ?? 0,
    maxStepRetries: state?.maxStepRetries ?? DEFAULT_STANDALONE_STEP_RETRIES,
    replanCount: state?.replanCount ?? 0,
    maxReplans: state?.maxReplans ?? DEFAULT_REPLAN_RETRIES
  });

  return {
    role: "verifier",
    at,
    stepId: input.plannerResult.step.id,
    decision,
    summary: renderVerifierSummary(decision, input.plannerResult.step.id, reasons),
    reasons,
    intentMatched,
    targetMatched,
    validationPassed,
    sideEffectsDetected,
    validationGateResults,
    consumedContextSectionIds: selectConsumedSectionIds(input.payload, [
      "task-objective",
      "current-run-state",
      "recent-tool-results",
      "validation-targets",
      "known-failures"
    ])
  };
}

function ensureOrchestrationState(
  run: AgentRunRecord,
  limits: { maxStepRetries: number; maxReplans: number }
) {
  const current = run.orchestration;

  if (current) {
    current.maxStepRetries = limits.maxStepRetries;
    current.maxReplans = limits.maxReplans;
    return current;
  }

  run.orchestration = {
    status: "idle",
    iteration: 0,
    stepRetryCount: 0,
    replanCount: 0,
    maxStepRetries: limits.maxStepRetries,
    maxReplans: limits.maxReplans,
    nextAction: null,
    currentStep: null,
    lastPlannerResult: null,
    lastExecutorResult: null,
    lastVerifierResult: null
  };

  return run.orchestration;
}

async function executeExecutorStep(input: {
  run: AgentRunRecord;
  plannerStep: PlannerStep;
  payload: RoleContextPayload | null;
  executeRun: ExecuteRun;
  instructionRuntime: AgentInstructionRuntime;
}): Promise<ExecutorAgentOutput> {
  const at = new Date().toISOString();
  const scopedRun = cloneRunRecord(input.run);

  scopedRun.toolRequest = input.plannerStep.toolRequest ?? null;

  try {
    const result = await input.executeRun(scopedRun, {
      instructionRuntime: input.instructionRuntime,
      roleContextPrompt: input.payload?.prompt ?? null,
      roleContextSectionIds: input.payload?.sections.map((section) => section.id) ?? [],
      plannedStep: input.plannerStep
    });

    return {
      result,
      executorResult: {
        role: "executor",
        at,
        stepId: input.plannerStep.id,
        success: true,
        mode: result.mode,
        summary: result.summary,
        responseText: result.responseText ?? null,
        toolResult: result.toolResult ?? null,
        changedFiles: extractChangedFiles(result),
        validationTargets: input.plannerStep.validationTargets,
        consumedContextSectionIds: input.payload?.sections.map((section) => section.id) ?? [],
        error: null
      }
    };
  } catch (error) {
    const failure = normalizeAgentRunFailure(error);

    return {
      result: null,
      executorResult: {
        role: "executor",
        at,
        stepId: input.plannerStep.id,
        success: false,
        mode: null,
        summary: failure.message,
        responseText: null,
        toolResult: null,
        changedFiles: failure.path ? [failure.path] : [],
        validationTargets: input.plannerStep.validationTargets,
        consumedContextSectionIds: input.payload?.sections.map((section) => section.id) ?? [],
        error: failure
      }
    };
  }
}

async function buildRolePayload(
  contextAssembler: ContextAssembler | undefined,
  role: "planner" | "executor" | "verifier",
  run: AgentRunRecord,
  runtimeStatus: AgentRuntimeStatus
) {
  if (!contextAssembler) {
    return null;
  }

  const traceScope = getActiveTraceScope();
  const contextSpan = traceScope
    ? await traceScope.activeSpan.startChild({
        name: `${role}:context`,
        spanType: "context",
        inputSummary: `Assemble ${role} context payload.`,
        metadata: {
          role,
          runId: run.id
        }
      })
    : null;

  try {
    const payload =
      contextSpan && traceScope
        ? await runWithTraceScope(
            {
              ...traceScope,
              activeSpan: contextSpan
            },
            () =>
              contextAssembler.buildRolePayload(role, {
                run,
                runtimeStatus
              })
          )
        : contextAssembler.buildRolePayload(role, {
            run,
            runtimeStatus
          });

    contextSpan?.annotate({
      sectionIds: payload.sections.map((section) => section.id),
      omittedSectionIds: payload.omittedSections.map((section) => section.id),
      promptLength: payload.prompt.length,
      selectedFiles: run.context.relevantFiles.map((file) => ({
        path: file.path,
        source: file.source ?? null,
        reason: file.reason ?? null
      }))
    });
    await contextSpan?.end({
      status: "completed",
      outputSummary: `Assembled ${role} context with ${payload.sections.length} section(s).`
    });

    return payload;
  } catch (error) {
    await contextSpan?.end({
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function deriveValidationTargets(
  run: AgentRunRecord,
  task: Task | null,
  payload: RoleContextPayload | null
) {
  const fromPayload = extractSectionList(payload, "validation-targets");

  if (fromPayload.length > 0) {
    return fromPayload;
  }

  return uniqueStrings([
    ...(task?.context?.validationTargets ?? []),
    ...run.context.validationTargets
  ]);
}

function deriveSuccessCriteria(run: AgentRunRecord, task: Task | null) {
  const criteria: string[] = [];

  for (const gate of task?.validationGates ?? []) {
    if (gate.expectedValue?.trim()) {
      criteria.push(gate.expectedValue.trim());
    }
  }

  if (criteria.length === 0 && task?.expectedOutcome?.trim()) {
    criteria.push(task.expectedOutcome.trim());
  }

  if (criteria.length === 0 && run.context.objective?.trim() && (task?.toolRequest ?? run.toolRequest)) {
    criteria.push(run.context.objective.trim());
  }

  return uniqueStrings(criteria);
}

function extractChangedFiles(result: AgentRunResult) {
  if (result.mode !== "repo-tool" || !result.toolResult?.ok) {
    return [];
  }

  const candidate = result.toolResult.data as { path?: string };
  return candidate.path ? [candidate.path] : [];
}

function extractToolPath(toolRequest: RepoMutationToolRequest | null | undefined) {
  if (!toolRequest) {
    return null;
  }

  return "path" in toolRequest.input && typeof toolRequest.input.path === "string"
    ? toolRequest.input.path
    : null;
}

function deriveValidationPassed(
  result: AgentRunResult | null,
  executorResult: ExecutorStepResult
): boolean | null {
  if (result?.mode === "repo-tool" && result.toolResult?.ok) {
    return result.toolResult.data.validationResult.success;
  }

  if (executorResult.error?.validationResult) {
    return executorResult.error.validationResult.success;
  }

  return null;
}

function collectVerificationReasons(input: {
  executorResult: ExecutorStepResult;
  intentMatched: boolean;
  targetMatched: boolean;
  validationPassed: boolean | null;
  sideEffectsDetected: boolean;
  taskValidationPassed: boolean;
  validationGateResults: ValidationGateResult[] | null;
}) {
  const reasons: string[] = [];

  if (!input.executorResult.success) {
    reasons.push(input.executorResult.error?.message ?? input.executorResult.summary);
  }

  if (!input.intentMatched) {
    reasons.push("Execution evidence did not match the planned step intent.");
  }

  if (!input.targetMatched) {
    reasons.push("Execution did not stay on the expected target.");
  }

  if (input.validationPassed === false) {
    reasons.push("Validation did not pass cleanly.");
  }

  if (input.sideEffectsDetected) {
    reasons.push("Unexpected side effects were detected.");
  }

  if (!input.taskValidationPassed) {
    reasons.push(
      ...(input.validationGateResults ?? [])
        .filter((gate) => !gate.success)
        .map((gate) => gate.message)
    );
  }

  return uniqueStrings(reasons);
}

function decideVerifierAction(input: {
  executorResult: ExecutorStepResult;
  intentMatched: boolean;
  targetMatched: boolean;
  validationPassed: boolean | null;
  sideEffectsDetected: boolean;
  taskValidationPassed: boolean;
  stepRetryCount: number;
  maxStepRetries: number;
  replanCount: number;
  maxReplans: number;
}): VerifierStepResult["decision"] {
  const stepCanRetry = input.stepRetryCount < input.maxStepRetries;
  const canReplan = input.replanCount < input.maxReplans;

  if (input.executorResult.success) {
    if (
      input.intentMatched &&
      input.targetMatched &&
      input.validationPassed !== false &&
      !input.sideEffectsDetected &&
      input.taskValidationPassed
    ) {
      return "continue";
    }

    if ((!input.targetMatched || input.sideEffectsDetected) && canReplan) {
      return "replan";
    }

    return stepCanRetry ? "retry_step" : "fail";
  }

  if (isRetargetingFailure(input.executorResult.error) && canReplan) {
    return "replan";
  }

  return stepCanRetry ? "retry_step" : "fail";
}

function renderVerifierSummary(
  decision: OrchestrationAction,
  stepId: string,
  reasons: string[]
) {
  switch (decision) {
    case "continue":
      return `Verifier approved ${stepId}.`;
    case "retry_step":
      return `Verifier requested a retry for ${stepId}.${reasons.length > 0 ? ` ${reasons[0]}` : ""}`;
    case "replan":
      return `Verifier requested a replan for ${stepId}.${reasons.length > 0 ? ` ${reasons[0]}` : ""}`;
    case "fail":
      return `Verifier failed ${stepId}.${reasons.length > 0 ? ` ${reasons[0]}` : ""}`;
    case "plan":
      return `Planner will propose a new step for ${stepId}.`;
  }
}

function evaluateTaskGatesForVerification(task: Task, result: AgentRunResult): ValidationGateResult[] {
  const gates = task.validationGates.length > 0 ? task.validationGates : deriveTaskGates(task, result);
  const evidence = buildTaskEvidence(result);

  return gates.map((gate) =>
    evaluateValidationGate(gate, {
      evidence,
      result
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

  if (task.expectedOutcome.trim()) {
    gates.push({
      id: `${task.id}-expected-outcome`,
      description: `Task evidence includes the expected outcome for ${task.id}.`,
      kind: "evidence_includes",
      expectedValue: task.expectedOutcome
    });
  }

  return gates;
}

function evaluateValidationGate(
  gate: ValidationGate,
  input: {
    evidence: string;
    result: AgentRunResult;
  }
): ValidationGateResult {
  switch (gate.kind) {
    case "task_completed":
      return createGateResult(gate, true, "Task produced a result.");
    case "tool_result_ok":
      return createGateResult(
        gate,
        input.result.mode === "repo-tool" && input.result.toolResult?.ok === true,
        "Repo mutation tool returned success."
      );
    case "validation_passed":
      return createGateResult(
        gate,
        input.result.mode === "repo-tool" &&
          input.result.toolResult?.ok === true &&
          input.result.toolResult.data.validationResult.success === true,
        "Repo mutation validation passed."
      );
    case "result_summary_includes":
      return createGateResult(
        gate,
        includesNormalized(input.result.summary, gate.expectedValue ?? ""),
        `Summary includes "${gate.expectedValue ?? ""}".`
      );
    case "response_text_includes":
      return createGateResult(
        gate,
        includesNormalized(input.result.responseText ?? "", gate.expectedValue ?? ""),
        `Response includes "${gate.expectedValue ?? ""}".`
      );
    case "evidence_includes":
      return createGateResult(
        gate,
        includesNormalized(input.evidence, gate.expectedValue ?? ""),
        `Execution evidence includes "${gate.expectedValue ?? ""}".`
      );
    case "event_type_present":
      return createGateResult(gate, false, "Event presence gates are not supported yet.");
    case "all_tasks_completed":
      return createGateResult(gate, true, "Task-level verification treats the current task as active.");
    case "all_user_stories_completed":
      return createGateResult(
        gate,
        true,
        "Task-level verification defers user story completion to the phase engine."
      );
  }
}

function createGateResult(gate: ValidationGate, success: boolean, baseMessage: string) {
  return {
    gateId: gate.id,
    description: gate.description,
    kind: gate.kind,
    success,
    message: success ? baseMessage : `Validation gate failed: ${gate.description}`,
    expectedValue: gate.expectedValue ?? null
  } satisfies ValidationGateResult;
}

function buildTaskEvidence(result: AgentRunResult) {
  return [
    result.summary,
    result.responseText ?? null,
    result.mode === "repo-tool" ? JSON.stringify(result.toolResult) : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildVerificationEvidence(result: AgentRunResult | null, executorResult: ExecutorStepResult) {
  return [
    result?.summary ?? null,
    result?.responseText ?? null,
    result?.mode === "repo-tool" ? JSON.stringify(result.toolResult) : null,
    executorResult.summary,
    executorResult.error?.message ?? null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isRetargetingFailure(error: AgentRunFailure | null | undefined) {
  return (
    error?.code === "anchor_not_found" ||
    error?.code === "ambiguous_match" ||
    error?.code === "location_mismatch"
  );
}

function normalizeAgentRunFailure(error: unknown): AgentRunFailure {
  const fallbackMessage = error instanceof Error ? error.message : "Unknown runtime error.";
  const failure: AgentRunFailure = {
    message: fallbackMessage,
    code: "execution_failed"
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
      failure.code = candidate.code as AgentRunFailure["code"];
    }

    if (typeof candidate.toolName === "string") {
      failure.toolName = candidate.toolName as AgentRunFailure["toolName"];
    }

    if (typeof candidate.path === "string") {
      failure.path = candidate.path;
    }

    if (candidate.validationResult && typeof candidate.validationResult === "object") {
      failure.validationResult = candidate.validationResult as AgentRunFailure["validationResult"];
    }

    if (candidate.rollback && typeof candidate.rollback === "object") {
      failure.rollback = candidate.rollback as AgentRunFailure["rollback"];
    }
  }

  return failure;
}

function createOrchestrationFailure(
  code: NonNullable<AgentRunFailure["code"]>,
  message: string,
  run: AgentRunRecord
) {
  const error = new Error(message) as Error & AgentRunFailure;
  error.code = code === "verification_failed" && run.error?.code ? run.error.code : code;
  error.validationResult = run.lastValidationResult;
  error.rollback = run.error?.rollback ?? null;
  error.path = run.error?.path;
  error.toolName = run.error?.toolName;
  return error;
}

function applyExecutionValidationState(run: AgentRunRecord, execution: ExecutorAgentOutput) {
  if (execution.result?.mode === "repo-tool" && execution.result.toolResult?.ok) {
    run.lastValidationResult = execution.result.toolResult.data.validationResult ?? null;
    run.validationStatus = execution.result.toolResult.data.validationResult.success ? "passed" : "failed";
    return;
  }

  if (execution.executorResult.error?.rollback?.attempted) {
    run.validationStatus = execution.executorResult.error.rollback.success
      ? "rolled_back"
      : "rollback_failed";
  } else if (execution.executorResult.error?.validationResult) {
    run.validationStatus = execution.executorResult.error.validationResult.success ? "passed" : "failed";
  }

  if (execution.executorResult.error?.validationResult) {
    run.lastValidationResult = execution.executorResult.error.validationResult;
  }
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

  run.events = [...run.events, ...events];
}

async function persist(
  persistRun: (run: AgentRunRecord) => void | Promise<void>,
  run: AgentRunRecord
) {
  await persistRun(cloneRunRecord(run));
}

function requireAgentOutput<Output>(input: {
  result: {
    status: "success" | "failure";
    output: Output | null;
    error?: string | null;
  };
  failureCode: NonNullable<AgentRunFailure["code"]>;
  fallbackMessage: string;
  run: AgentRunRecord;
}) {
  if (input.result.status === "failure" || input.result.output === null) {
    throw createOrchestrationFailure(
      input.failureCode,
      input.result.error ?? input.fallbackMessage,
      input.run
    );
  }

  return input.result.output;
}

async function traceHandoffCreation(handoff: AgentHandoff<unknown>) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("handoff_created", {
    message: `${handoff.source} -> ${handoff.target}: ${handoff.purpose}`,
    metadata: {
      source: handoff.source,
      target: handoff.target,
      stepId: handoff.stepId,
      correlationId: handoff.correlationId,
      purpose: handoff.purpose
    }
  });
}

function traceAgentResultReceipt(input: {
  role: string;
  stepId: string | null;
  status: "success" | "failure";
  correlationId: string;
  metadata?: Record<string, unknown>;
  error?: string | null;
}) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("agent_result_received", {
    message: `${input.role} agent returned ${input.status}.`,
    metadata: {
      role: input.role,
      stepId: input.stepId,
      correlationId: input.correlationId,
      ...(input.metadata ?? {}),
      error: input.error ?? null
    }
  });
}

async function runMergeWithTrace(
  input: {
    role: "planner" | "executor" | "verifier";
    stepId: string | null;
    correlationId: string;
    summary: string;
  },
  callback: () => Promise<void> | void
) {
  const traceScope = getActiveTraceScope();

  try {
    await callback();
    traceScope?.activeSpan.addEvent("state_merged", {
      message: input.summary,
      metadata: {
        role: input.role,
        stepId: input.stepId,
        correlationId: input.correlationId
      }
    });
  } catch (error) {
    traceScope?.activeSpan.addEvent("state_merge_failed", {
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        role: input.role,
        stepId: input.stepId,
        correlationId: input.correlationId
      }
    });
    throw error;
  }
}

async function traceCoordinatorDecision(input: {
  stepId: string | null;
  decision: "continue" | "retry_step" | "replan" | "fail";
  summary: string;
  correlationId: string;
  failed?: boolean;
}) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("coordinator_decision", {
    message: input.summary,
    metadata: {
      decision: input.decision,
      stepId: input.stepId,
      correlationId: input.correlationId,
      failed: input.failed ?? false
    }
  });
}

function extractSectionContent(payload: RoleContextPayload | null, sectionId: string) {
  return payload?.sections.find((section) => section.id === sectionId)?.content ?? null;
}

function extractSectionList(payload: RoleContextPayload | null, sectionId: string) {
  const content = extractSectionContent(payload, sectionId);

  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

function selectConsumedSectionIds(payload: RoleContextPayload | null, preferredIds: string[]) {
  if (!payload) {
    return [];
  }

  const available = new Set(payload.sections.map((section) => section.id));
  return preferredIds.filter((id) => available.has(id));
}

function cloneOrchestrationState(state: OrchestrationState) {
  return structuredClone(state);
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

function summarizeText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
