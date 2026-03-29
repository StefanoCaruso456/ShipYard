import { decideCoordinatorFactoryPhaseUnlock } from "./orchestration";
import { detectFactoryStageMissingWork } from "./factoryPlanner";
import type {
  FactoryArtifact,
  FactoryBacklogItem,
  FactoryCompletionCriterion,
  FactoryContractEvidenceKind,
  FactoryPhaseContract,
  FactoryPhaseRecoveryAction,
  FactoryPhaseUnlockDecision,
  FactoryPhaseVerificationResult,
  FactoryQualityGateResult,
  FactoryRunState,
  FactoryStageId,
  FactoryStagePlan,
  FactoryVerificationCriterion,
  Phase,
  PhaseExecutionState,
  PhaseStatus,
  Task
} from "./types";

export function syncFactoryQualityGateState(options: {
  factory: FactoryRunState;
  phaseExecution?: PhaseExecutionState | null;
  updatedAt: string;
}): Pick<FactoryRunState, "phaseVerificationResults" | "phaseUnlockDecisions"> {
  const phaseVerificationResults = options.factory.completionContract.phases.map((phaseContract) =>
    evaluateFactoryPhaseVerification({
      factory: options.factory,
      phaseExecution: options.phaseExecution ?? null,
      phaseContract,
      updatedAt: options.updatedAt
    })
  );

  const phaseUnlockDecisions = phaseVerificationResults.map((verificationResult, index) =>
    decideCoordinatorFactoryPhaseUnlock({
      verificationResult,
      nextPhase: options.factory.completionContract.phases[index + 1] ?? null,
      decidedAt: options.updatedAt
    })
  );

  return {
    phaseVerificationResults,
    phaseUnlockDecisions
  };
}

export function findFactoryPhaseVerificationResult(
  factory: FactoryRunState | null | undefined,
  phaseId: string
) {
  return (
    factory?.phaseVerificationResults.find((result) => result.phaseId === phaseId) ?? null
  );
}

export function findFactoryPhaseUnlockDecision(
  factory: FactoryRunState | null | undefined,
  phaseId: string
) {
  return factory?.phaseUnlockDecisions.find((decision) => decision.phaseId === phaseId) ?? null;
}

export function evaluateFactoryPhaseVerification(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState | null;
  phaseContract: FactoryPhaseContract;
  updatedAt: string;
}): FactoryPhaseVerificationResult {
  const phase =
    options.phaseExecution?.phases.find(
      (candidate) => candidate.id === options.phaseContract.phaseId
    ) ?? null;
  const stagePlan =
    options.factory.stagePlans.find(
      (candidate) => candidate.stageId === options.phaseContract.stageId
    ) ?? null;
  const candidatePhaseStatus = deriveCandidatePhaseStatus(phase, stagePlan);
  const completedCompletionCriterionIds = new Set(
    (stagePlan?.backlog ?? [])
      .filter((item) => item.status === "completed")
      .flatMap((item) => item.completionCriterionIds)
  );
  const satisfiedCompletionCriterionIds = options.phaseContract.completionCriteria
    .filter((criterion) => completedCompletionCriterionIds.has(criterion.id))
    .map((criterion) => criterion.id);
  const missingCompletionCriterionIds = options.phaseContract.completionCriteria
    .filter((criterion) => !completedCompletionCriterionIds.has(criterion.id))
    .map((criterion) => criterion.id);
  const qualityGateResults = options.phaseContract.verificationCriteria.map((criterion) =>
    evaluateFactoryQualityGate({
      factory: options.factory,
      phaseExecution: options.phaseExecution,
      phaseContract: options.phaseContract,
      phase,
      stagePlan,
      criterion,
      candidatePhaseStatus,
      updatedAt: options.updatedAt
    })
  );
  const satisfiedVerificationCriterionIds = qualityGateResults
    .filter((result) => result.status === "passed")
    .map((result) => result.criterionId);
  const pendingVerificationCriterionIds = qualityGateResults
    .filter((result) => result.status === "pending")
    .map((result) => result.criterionId);
  const failedVerificationCriterionIds = qualityGateResults
    .filter((result) => result.status === "failed")
    .map((result) => result.criterionId);
  const completionSatisfied = missingCompletionCriterionIds.length === 0;
  const verified =
    completionSatisfied &&
    pendingVerificationCriterionIds.length === 0 &&
    failedVerificationCriterionIds.length === 0;
  const status = verified ? "passed" : candidatePhaseStatus === "completed" ? "failed" : "pending";
  const recoveryActions =
    status === "failed"
      ? deriveRecoveryActions({
          factory: options.factory,
          phaseExecution: options.phaseExecution,
          phaseContract: options.phaseContract,
          qualityGateResults,
          missingCompletionCriterionIds,
          stagePlan
        })
      : [];

  return {
    id: `factory-phase-verification:${options.phaseContract.phaseId}`,
    phaseId: options.phaseContract.phaseId,
    stageId: options.phaseContract.stageId,
    status,
    summary: buildVerificationSummary({
      phaseContract: options.phaseContract,
      completionSatisfied,
      missingCompletionCriterionIds,
      pendingVerificationCriterionIds,
      failedVerificationCriterionIds,
      verified
    }),
    candidatePhaseStatus,
    completionSatisfied,
    verified,
    satisfiedCompletionCriterionIds,
    missingCompletionCriterionIds,
    satisfiedVerificationCriterionIds,
    pendingVerificationCriterionIds,
    failedVerificationCriterionIds,
    qualityGateResults,
    recoveryActions,
    evaluatedAt: options.updatedAt,
    verifiedAt: verified ? options.updatedAt : null
  };
}

function evaluateFactoryQualityGate(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState | null;
  phaseContract: FactoryPhaseContract;
  phase: Phase | null;
  stagePlan: FactoryStagePlan | null;
  criterion: FactoryVerificationCriterion;
  candidatePhaseStatus: PhaseStatus;
  updatedAt: string;
}): FactoryQualityGateResult {
  const evaluation = evaluateCriterionEvidence({
    factory: options.factory,
    phaseExecution: options.phaseExecution,
    phase: options.phase,
    stagePlan: options.stagePlan,
    criterion: options.criterion,
    candidatePhaseStatus: options.candidatePhaseStatus
  });

  return {
    criterionId: options.criterion.id,
    phaseId: options.phaseContract.phaseId,
    stageId: options.phaseContract.stageId,
    description: options.criterion.description,
    evidenceKind: options.criterion.evidenceKind,
    target: options.criterion.target,
    expectedValue: options.criterion.expectedValue ?? null,
    actualValue: evaluation.actualValue,
    status: evaluation.status,
    success: evaluation.status === "passed",
    message: evaluation.message,
    sourceTaskIds: evaluation.sourceTaskIds,
    sourceStoryIds: evaluation.sourceStoryIds,
    sourceArtifactIds: evaluation.sourceArtifactIds,
    sourceBacklogItemIds: evaluation.sourceBacklogItemIds,
    evaluatedAt: options.updatedAt
  };
}

function evaluateCriterionEvidence(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState | null;
  phase: Phase | null;
  stagePlan: FactoryStagePlan | null;
  criterion: FactoryVerificationCriterion;
  candidatePhaseStatus: PhaseStatus;
}): Omit<FactoryQualityGateResult, "criterionId" | "phaseId" | "stageId" | "description" | "evidenceKind" | "target" | "expectedValue" | "evaluatedAt" | "success"> {
  const failureStatus = options.candidatePhaseStatus === "completed" ? "failed" : "pending";

  switch (options.criterion.evidenceKind) {
    case "phase_status": {
      const actualValue = options.candidatePhaseStatus;
      const passed = actualValue === (options.criterion.expectedValue ?? "completed");

      return {
        actualValue,
        status: passed ? "passed" : failureStatus,
        message: passed
          ? `Phase status satisfied ${options.criterion.description}`
          : options.candidatePhaseStatus === "completed"
            ? `Factory phase reached completion but ${options.criterion.description.toLowerCase()}`
            : `Waiting for ${options.criterion.description.toLowerCase()}`,
        sourceTaskIds: [],
        sourceStoryIds: [],
        sourceArtifactIds: [],
        sourceBacklogItemIds: []
      };
    }
    case "artifact_status": {
      const artifact =
        options.factory.artifacts.find((candidate) => candidate.id === options.criterion.target) ??
        null;
      const actualValue = artifact?.status ?? null;
      const passed = actualValue === (options.criterion.expectedValue ?? "completed");

      return {
        actualValue,
        status: passed ? "passed" : failureStatus,
        message: passed
          ? `Artifact ${artifact?.title ?? options.criterion.target} satisfied the quality gate.`
          : artifact
            ? `${artifact.title} is ${artifact.status}, not ${options.criterion.expectedValue ?? "completed"}.`
            : `Artifact ${options.criterion.target} is not available yet.`,
        sourceTaskIds: artifactSourceTaskIds(options.criterion.target),
        sourceStoryIds: artifactSourceStoryIds(options.criterion.target),
        sourceArtifactIds: artifact ? [artifact.id] : [],
        sourceBacklogItemIds: artifactSourceBacklogItemIds(options.factory, options.criterion.target)
      };
    }
    case "task_evidence": {
      const taskMatch = findTaskWithStory(options.phaseExecution, options.criterion.target);
      const actualValue = taskMatch?.task ? summarizeTaskEvidence(taskMatch.task) : null;
      const passed =
        Boolean(taskMatch?.task && taskMatch.task.status === "completed") &&
        includesNormalized(actualValue ?? "", options.criterion.expectedValue ?? "");

      return {
        actualValue,
        status: passed ? "passed" : failureStatus,
        message: passed
          ? `Task ${options.criterion.target} produced the required verification evidence.`
          : taskMatch?.task
            ? `Task ${options.criterion.target} completed without the expected verification evidence.`
            : `Task ${options.criterion.target} has not produced verification evidence yet.`,
        sourceTaskIds: taskMatch?.task ? [taskMatch.task.id] : [],
        sourceStoryIds: taskMatch?.story ? [taskMatch.story.id] : [],
        sourceArtifactIds: [],
        sourceBacklogItemIds: findBacklogItemsForTask(options.factory, options.criterion.target).map(
          (item) => item.id
        )
      };
    }
    case "backlog_item_status": {
      const matchingItems = findBacklogItemsForCompletionCriterion(
        options.stagePlan,
        options.criterion.target
      );
      const completedItem = matchingItems.find((item) => item.status === "completed") ?? null;
      const actualValue = completedItem?.status ?? matchingItems[0]?.status ?? null;
      const passed = Boolean(completedItem);

      return {
        actualValue,
        status: passed ? "passed" : failureStatus,
        message: passed
          ? `Backlog completion evidence is recorded for ${options.criterion.target}.`
          : matchingItems.length > 0
            ? `Backlog items for ${options.criterion.target} exist but are not completed.`
            : `Factory backlog does not yet cover ${options.criterion.target}.`,
        sourceTaskIds: uniqueStrings(
          matchingItems.map((item) => item.taskId).filter((value): value is string => Boolean(value))
        ),
        sourceStoryIds: uniqueStrings(
          matchingItems.map((item) => item.storyId).filter((value): value is string => Boolean(value))
        ),
        sourceArtifactIds: [],
        sourceBacklogItemIds: matchingItems.map((item) => item.id)
      };
    }
    case "delivery_summary": {
      const actualValue = options.factory.deliverySummary?.trim() || null;
      const passed = Boolean(actualValue);

      return {
        actualValue,
        status: passed ? "passed" : failureStatus,
        message: passed
          ? "Delivery summary is persisted in Factory runtime state."
          : "Delivery summary is not persisted in Factory runtime state yet.",
        sourceTaskIds: ["task-delivery-summary"],
        sourceStoryIds: ["story-delivery-handoff"],
        sourceArtifactIds: ["factory-artifact:delivery-summary"],
        sourceBacklogItemIds: findBacklogItemsForTask(options.factory, "task-delivery-summary").map(
          (item) => item.id
        )
      };
    }
    case "result_summary":
    case "repository_link":
      return {
        actualValue: null,
        status: failureStatus,
        message: `Evidence kind ${options.criterion.evidenceKind} is not evaluated in phase verification.`,
        sourceTaskIds: [],
        sourceStoryIds: [],
        sourceArtifactIds: [],
        sourceBacklogItemIds: []
      };
  }
}

function deriveRecoveryActions(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState | null;
  phaseContract: FactoryPhaseContract;
  qualityGateResults: FactoryQualityGateResult[];
  missingCompletionCriterionIds: string[];
  stagePlan: FactoryStagePlan | null;
}): FactoryPhaseRecoveryAction[] {
  const actions: FactoryPhaseRecoveryAction[] = [];
  const blockingResults = options.qualityGateResults.filter((result) => result.status === "failed");
  const missingWork =
    options.phaseExecution && options.phaseContract.stageId === "implementation"
      ? detectFactoryStageMissingWork({
          factory: options.factory,
          phaseExecution: options.phaseExecution,
          stageId: options.phaseContract.stageId,
          updatedAt: blockingResults[0]?.evaluatedAt ?? new Date().toISOString()
        })
      : null;

  if (
    options.phaseContract.stageId === "implementation" &&
    ((missingWork?.uncoveredCompletionCriterionIds.length ?? 0) > 0 ||
      (missingWork?.missingVerificationCriterionIds.length ?? 0) > 0)
  ) {
    actions.push("expand_backlog");
  }

  if (
    options.missingCompletionCriterionIds.length > 0 ||
    blockingResults.some(
      (result) =>
        result.sourceTaskIds.length > 0 ||
        result.sourceStoryIds.length > 0 ||
        result.evidenceKind === "artifact_status"
    )
  ) {
    actions.push("retry_current_phase");
  }

  if (
    blockingResults.some((result) => result.sourceTaskIds.length > 0) &&
    hasOwnershipAssignments(options.factory, options.phaseContract.stageId)
  ) {
    actions.push("reassign_owner");
  }

  return uniqueValues(actions);
}

function buildVerificationSummary(options: {
  phaseContract: FactoryPhaseContract;
  completionSatisfied: boolean;
  missingCompletionCriterionIds: string[];
  pendingVerificationCriterionIds: string[];
  failedVerificationCriterionIds: string[];
  verified: boolean;
}) {
  if (options.verified) {
    return `${options.phaseContract.name} satisfied its completion and verification contract.`;
  }

  if (
    options.missingCompletionCriterionIds.length === 0 &&
    options.pendingVerificationCriterionIds.length === 0 &&
    options.failedVerificationCriterionIds.length === 0
  ) {
    return `${options.phaseContract.name} has not started verification yet.`;
  }

  const parts: string[] = [];

  if (!options.completionSatisfied) {
    parts.push(
      options.missingCompletionCriterionIds.length === 1
        ? "1 completion criterion is still missing."
        : `${options.missingCompletionCriterionIds.length} completion criteria are still missing.`
    );
  }

  if (options.failedVerificationCriterionIds.length > 0) {
    parts.push(
      options.failedVerificationCriterionIds.length === 1
        ? "1 verification criterion failed."
        : `${options.failedVerificationCriterionIds.length} verification criteria failed.`
    );
  }

  if (options.pendingVerificationCriterionIds.length > 0) {
    parts.push(
      options.pendingVerificationCriterionIds.length === 1
        ? "1 verification criterion is pending."
        : `${options.pendingVerificationCriterionIds.length} verification criteria are pending.`
    );
  }

  return `${options.phaseContract.name} is not yet verified. ${parts.join(" ")}`.trim();
}

function deriveCandidatePhaseStatus(
  phase: Phase | null,
  stagePlan: FactoryStagePlan | null
): PhaseStatus {
  if (phase) {
    if (phase.userStories.every((story) => story.status === "completed")) {
      return "completed";
    }

    return phase.status;
  }

  switch (stagePlan?.status) {
    case "active":
      return "in_progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function findTaskWithStory(
  phaseExecution: PhaseExecutionState | null,
  taskId: string
): {
  task: Task;
  story: Phase["userStories"][number];
} | null {
  if (!phaseExecution) {
    return null;
  }

  for (const phase of phaseExecution.phases) {
    for (const story of phase.userStories) {
      const task = story.tasks.find((candidate) => candidate.id === taskId);

      if (task) {
        return { task, story };
      }
    }
  }

  return null;
}

function findBacklogItemsForTask(factory: FactoryRunState, taskId: string) {
  return factory.stagePlans.flatMap((stagePlan) =>
    stagePlan.backlog.filter((item) => item.taskId === taskId)
  );
}

function findBacklogItemsForCompletionCriterion(
  stagePlan: FactoryStagePlan | null,
  completionCriterionId: string
) {
  return (stagePlan?.backlog ?? []).filter((item) =>
    item.completionCriterionIds.includes(completionCriterionId)
  );
}

function artifactSourceTaskIds(artifactId: string) {
  switch (artifactId) {
    case "factory-artifact:repository":
    case "factory-artifact:bootstrap-plan":
      return ["task-repository-bootstrap"];
    case "factory-artifact:delivery-summary":
      return ["task-delivery-summary"];
    default:
      return [];
  }
}

function artifactSourceStoryIds(artifactId: string) {
  switch (artifactId) {
    case "factory-artifact:repository":
    case "factory-artifact:bootstrap-plan":
      return ["story-repository-bootstrap"];
    case "factory-artifact:delivery-summary":
      return ["story-delivery-handoff"];
    default:
      return [];
  }
}

function artifactSourceBacklogItemIds(factory: FactoryRunState, artifactId: string) {
  return artifactSourceTaskIds(artifactId).flatMap((taskId) =>
    findBacklogItemsForTask(factory, taskId).map((item) => item.id)
  );
}

function hasOwnershipAssignments(factory: FactoryRunState, stageId: FactoryStageId) {
  const plan = factory.ownershipPlans.find((candidate) => candidate.stageId === stageId);

  return Boolean((plan?.storyAssignments.length ?? 0) > 0 || (plan?.taskAssignments.length ?? 0) > 0);
}

function summarizeTaskEvidence(task: Task) {
  return [task.result?.summary ?? null, task.result?.responseText ?? null]
    .filter(Boolean)
    .join("\n\n");
}

function includesNormalized(haystack: string, needle: string) {
  if (!needle.trim()) {
    return true;
  }

  return normalizeText(haystack).includes(normalizeText(needle));
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueValues<T>(values: T[]) {
  return [...new Set(values)];
}
