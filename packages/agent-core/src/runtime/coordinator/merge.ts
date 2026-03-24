import type { ExecutorAgentOutput } from "../agents/types";
import type {
  AgentRunRecord,
  OrchestrationState,
  PlannerStepResult,
  VerifierStepResult
} from "../types";
import type { RunEvent } from "../../validation/types";

type AppendEvents = (run: AgentRunRecord, ...events: RunEvent[]) => void;

export function mergePlannerResult(input: {
  run: AgentRunRecord;
  orchestration: OrchestrationState;
  plannerResult: PlannerStepResult;
  appendEvents: AppendEvents;
}) {
  input.orchestration.iteration += 1;
  input.orchestration.currentStep = input.plannerResult.step;
  input.orchestration.lastPlannerResult = input.plannerResult;
  input.orchestration.nextAction = null;
  input.orchestration.status = "executing";
  input.appendEvents(input.run, {
    at: input.plannerResult.at,
    type: "planner_step_proposed",
    stepId: input.plannerResult.step.id,
    message: input.plannerResult.summary
  });
  input.run.rollingSummary = {
    text: input.plannerResult.summary,
    updatedAt: input.plannerResult.at,
    source: "result"
  };
}

export function mergeExecutorResult(input: {
  run: AgentRunRecord;
  orchestration: OrchestrationState;
  execution: ExecutorAgentOutput;
  appendEvents: AppendEvents;
  applyExecutionValidationState: (run: AgentRunRecord, execution: ExecutorAgentOutput) => void;
}) {
  input.orchestration.lastExecutorResult = input.execution.executorResult;
  input.orchestration.status = "verifying";
  input.run.result = input.execution.result;
  input.run.error = input.execution.executorResult.error ?? null;
  input.applyExecutionValidationState(input.run, input.execution);
  input.appendEvents(input.run, {
    at: input.execution.executorResult.at,
    type: "executor_step_completed",
    stepId: input.execution.executorResult.stepId,
    message: input.execution.executorResult.summary,
    path:
      input.execution.executorResult.changedFiles[0] ??
      input.execution.executorResult.error?.path ??
      null,
    toolName:
      input.execution.executorResult.toolResult?.toolName ??
      input.execution.executorResult.error?.toolName ??
      null
  });
  input.run.rollingSummary = {
    text: input.execution.executorResult.summary,
    updatedAt: input.execution.executorResult.at,
    source: input.execution.executorResult.success ? "result" : "failure"
  };
}

export function mergeVerifierResult(input: {
  run: AgentRunRecord;
  orchestration: OrchestrationState;
  verifierResult: VerifierStepResult;
  appendEvents: AppendEvents;
}) {
  input.orchestration.lastVerifierResult = input.verifierResult;
  input.orchestration.nextAction = input.verifierResult.decision;

  if (input.verifierResult.validationGateResults?.some((gate) => !gate.success)) {
    input.appendEvents(
      input.run,
      ...input.verifierResult.validationGateResults
        .filter((gate) => !gate.success)
        .map<RunEvent>((gate) => ({
          at: input.verifierResult.at,
          type: "validation_gate_failed",
          stepId: input.verifierResult.stepId,
          gateId: gate.gateId,
          message: gate.message
        }))
    );
  }

  input.appendEvents(input.run, {
    at: input.verifierResult.at,
    type: "verifier_decision_made",
    stepId: input.verifierResult.stepId,
    message: input.verifierResult.summary
  });
  input.run.rollingSummary = {
    text: input.verifierResult.summary,
    updatedAt: input.verifierResult.at,
    source: input.verifierResult.decision === "continue" ? "result" : "failure"
  };
}
