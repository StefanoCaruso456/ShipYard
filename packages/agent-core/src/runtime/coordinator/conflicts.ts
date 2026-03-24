import { getActiveTraceScope } from "../../observability/traceScope";
import type { TraceMetadata } from "../../observability/types";
import type { RunEvent } from "../../validation/types";
import type { ExecutorAgentOutput } from "../agents/types";
import type { AgentRunRecord, PlannerStepResult, VerifierStepResult } from "../types";

type AppendEvents = (run: AgentRunRecord, ...events: RunEvent[]) => void;

export type ConflictRecord = {
  type: string;
  stepId: string | null;
  reason: string;
  detectedAt: number;
  metadata?: TraceMetadata;
};

export function collectVerificationConflicts(input: {
  plannerResult: PlannerStepResult;
  execution: ExecutorAgentOutput;
  verifierResult: VerifierStepResult;
}): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  const detectedAt = Date.now();
  const stepId = input.verifierResult.stepId;
  const expectedPath = input.plannerResult.step.toolRequest
    ? "path" in input.plannerResult.step.toolRequest.input &&
      typeof input.plannerResult.step.toolRequest.input.path === "string"
      ? input.plannerResult.step.toolRequest.input.path
      : null
    : null;

  if (input.verifierResult.validationPassed === false) {
    conflicts.push({
      type: "executor_validation_failed",
      stepId,
      reason: "Executor result did not pass validation cleanly.",
      detectedAt,
      metadata: {
        toolName:
          input.execution.executorResult.toolResult?.toolName ??
          input.execution.executorResult.error?.toolName ??
          null,
        path:
          input.execution.executorResult.changedFiles[0] ??
          input.execution.executorResult.error?.path ??
          null
      }
    });
  }

  if (!input.verifierResult.intentMatched) {
    conflicts.push({
      type: "verifier_intent_mismatch",
      stepId,
      reason: "Verifier determined that execution evidence did not match the planned intent.",
      detectedAt,
      metadata: {
        successCriteria: input.plannerResult.step.successCriteria
      }
    });
  }

  if (!input.verifierResult.targetMatched) {
    conflicts.push({
      type: "verifier_target_mismatch",
      stepId,
      reason: "Verifier determined that execution did not stay on the expected target.",
      detectedAt,
      metadata: {
        expectedPath,
        changedFiles: input.execution.executorResult.changedFiles
      }
    });
  }

  if (input.verifierResult.sideEffectsDetected) {
    conflicts.push({
      type: "unexpected_side_effects",
      stepId,
      reason: "Executor changed files outside the planned scope.",
      detectedAt,
      metadata: {
        expectedPath,
        changedFiles: input.execution.executorResult.changedFiles
      }
    });
  }

  for (const gate of input.verifierResult.validationGateResults ?? []) {
    if (!gate.success) {
      conflicts.push({
        type: "validation_gate_failed",
        stepId,
        reason: gate.message,
        detectedAt,
        metadata: {
          gateId: gate.gateId,
          kind: gate.kind
        }
      });
    }
  }

  return dedupeConflicts(conflicts);
}

export function createConflictRecord(input: {
  type: string;
  stepId: string | null;
  reason: string;
  metadata?: TraceMetadata;
}): ConflictRecord {
  return {
    type: input.type,
    stepId: input.stepId,
    reason: input.reason,
    detectedAt: Date.now(),
    metadata: input.metadata
  };
}

export function recordCoordinationConflicts(input: {
  run: AgentRunRecord;
  conflicts: ConflictRecord[];
  appendEvents: AppendEvents;
}) {
  if (input.conflicts.length === 0) {
    return;
  }

  input.appendEvents(input.run, ...input.conflicts.map(toConflictEvent));

  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  for (const conflict of input.conflicts) {
    traceScope.activeSpan.addEvent("coordination_conflict_detected", {
      message: conflict.reason,
      metadata: {
        type: conflict.type,
        stepId: conflict.stepId,
        detectedAt: conflict.detectedAt,
        ...(conflict.metadata ?? {})
      }
    });
  }
}

function toConflictEvent(conflict: ConflictRecord): RunEvent {
  const metadata = conflict.metadata ?? {};
  const path = typeof metadata.path === "string" ? metadata.path : null;
  const toolName = typeof metadata.toolName === "string" ? metadata.toolName : null;

  return {
    at: new Date(conflict.detectedAt).toISOString(),
    type: "coordination_conflict_detected",
    stepId: conflict.stepId,
    message: `${conflict.type}: ${conflict.reason}`,
    path,
    toolName
  };
}

function dedupeConflicts(conflicts: ConflictRecord[]) {
  const seen = new Set<string>();

  return conflicts.filter((conflict) => {
    const key = `${conflict.type}:${conflict.stepId ?? "null"}:${conflict.reason}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
