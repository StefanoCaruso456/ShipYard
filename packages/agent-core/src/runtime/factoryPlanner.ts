import {
  createExpansionBacklogItems,
  createFactoryStoryFromBacklogItem,
  getFactoryPhaseIdForStage,
  syncFactoryStagePlans
} from "./factoryBacklog";
import type {
  FactoryExpansionDecision,
  FactoryPhaseContract,
  FactoryRunState,
  FactoryStageId,
  FactoryStagePlan,
  FactoryVerificationCriterion,
  PhaseExecutionState,
  Task
} from "./types";

type FactoryMissingWork = {
  stagePlan: FactoryStagePlan;
  phaseContract: FactoryPhaseContract;
  missingCompletionCriterionIds: string[];
  missingVerificationCriterionIds: string[];
  uncoveredCompletionCriterionIds: string[];
};

export function detectFactoryStageMissingWork(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState;
  stageId: FactoryStageId;
  updatedAt: string;
}): FactoryMissingWork | null {
  const syncedStagePlans = syncFactoryStagePlans({
    stagePlans: options.factory.stagePlans,
    phaseExecution: options.phaseExecution,
    completionContract: options.factory.completionContract,
    updatedAt: options.updatedAt
  });
  const stagePlan = syncedStagePlans.find((candidate) => candidate.stageId === options.stageId) ?? null;
  const phaseContract =
    options.factory.completionContract.phases.find(
      (candidate) => candidate.stageId === options.stageId
    ) ?? null;

  if (!stagePlan || !phaseContract) {
    return null;
  }

  const completedCriterionIds = new Set(
    stagePlan.backlog
      .filter((item) => item.status === "completed")
      .flatMap((item) => item.completionCriterionIds)
  );
  const coveredCriterionIds = new Set(
    stagePlan.backlog.flatMap((item) => item.completionCriterionIds)
  );
  const missingCompletionCriterionIds = phaseContract.completionCriteria
    .filter((criterion) => !completedCriterionIds.has(criterion.id))
    .map((criterion) => criterion.id);
  const missingVerificationCriterionIds = phaseContract.verificationCriteria
    .filter(
      (criterion) =>
        isExpandableVerificationCriterion(criterion) &&
        !isVerificationCriterionSatisfied({
          criterion,
          factory: options.factory,
          phaseExecution: options.phaseExecution,
          stagePlan
        })
    )
    .map((criterion) => criterion.id);

  return {
    stagePlan,
    phaseContract,
    missingCompletionCriterionIds,
    missingVerificationCriterionIds,
    uncoveredCompletionCriterionIds: missingCompletionCriterionIds.filter(
      (criterionId) => !coveredCriterionIds.has(criterionId)
    )
  };
}

export function applyFactoryStageExpansion(options: {
  factory: FactoryRunState | null | undefined;
  phaseExecution: PhaseExecutionState | null | undefined;
  stageId: FactoryStageId;
  updatedAt: string;
}): {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState;
  decision: FactoryExpansionDecision | null;
  expanded: boolean;
} | null {
  if (!options.factory || !options.phaseExecution) {
    return null;
  }

  const phaseId = getFactoryPhaseIdForStage(options.stageId);
  const phase = options.phaseExecution.phases.find((candidate) => candidate.id === phaseId);

  if (!phase) {
    return null;
  }

  const missingWork = detectFactoryStageMissingWork({
    factory: options.factory,
    phaseExecution: options.phaseExecution,
    stageId: options.stageId,
    updatedAt: options.updatedAt
  });

  if (!missingWork) {
    return null;
  }

  const baseFactory: FactoryRunState = {
    ...options.factory,
    stagePlans: syncFactoryStagePlans({
      stagePlans: options.factory.stagePlans,
      phaseExecution: options.phaseExecution,
      completionContract: options.factory.completionContract,
      updatedAt: options.updatedAt
    })
  };

  if (missingWork.uncoveredCompletionCriterionIds.length > 0) {
    const expansionItems = createExpansionBacklogItems({
      appSpec: baseFactory.completionContract.appSpec,
      completionCriteria: missingWork.phaseContract.completionCriteria,
      verificationCriteria: missingWork.phaseContract.verificationCriteria,
      completionCriterionIds: missingWork.uncoveredCompletionCriterionIds,
      createdAt: options.updatedAt
    });

    for (const item of expansionItems) {
      if (
        item.storyId &&
        phase.userStories.some((candidate) => candidate.id === item.storyId)
      ) {
        continue;
      }

      phase.userStories.push(createFactoryStoryFromBacklogItem(item));
    }

    const stagePlans = baseFactory.stagePlans.map((plan) =>
      plan.stageId === options.stageId
        ? {
            ...plan,
            backlog: [...plan.backlog, ...expansionItems],
            lastExpandedAt: options.updatedAt,
            updatedAt: options.updatedAt
          }
        : plan
    );
    const syncedStagePlans = syncFactoryStagePlans({
      stagePlans,
      phaseExecution: options.phaseExecution,
      completionContract: baseFactory.completionContract,
      updatedAt: options.updatedAt
    });
    const decision = createExpansionDecision({
      stageId: options.stageId,
      phaseId,
      outcome: "expanded",
      summary: `Expanded the Factory implementation backlog with ${expansionItems.length} additional item(s).`,
      rationale:
        missingWork.uncoveredCompletionCriterionIds.length === 1
          ? `The completion contract still had 1 uncovered implementation criterion.`
          : `The completion contract still had ${missingWork.uncoveredCompletionCriterionIds.length} uncovered implementation criteria.`,
      missingCompletionCriterionIds: missingWork.missingCompletionCriterionIds,
      missingVerificationCriterionIds: missingWork.missingVerificationCriterionIds,
      addedBacklogItemIds: expansionItems.map((item) => item.id),
      decidedAt: options.updatedAt
    });

    return {
      factory: {
        ...baseFactory,
        stagePlans: syncedStagePlans,
        expansionDecisions: appendExpansionDecision(baseFactory.expansionDecisions, decision)
      },
      phaseExecution: options.phaseExecution,
      decision,
      expanded: true
    };
  }

  if (
    missingWork.missingCompletionCriterionIds.length === 0 &&
    missingWork.missingVerificationCriterionIds.length === 0 &&
    shouldRecordCompletionDecision(baseFactory, options.stageId)
  ) {
    const decision = createExpansionDecision({
      stageId: options.stageId,
      phaseId,
      outcome: "complete",
      summary: "Factory implementation backlog satisfied the completion contract.",
      rationale: "All implementation completion and expandable verification criteria are satisfied.",
      missingCompletionCriterionIds: [],
      missingVerificationCriterionIds: [],
      addedBacklogItemIds: [],
      decidedAt: options.updatedAt
    });

    return {
      factory: {
        ...baseFactory,
        expansionDecisions: appendExpansionDecision(baseFactory.expansionDecisions, decision)
      },
      phaseExecution: options.phaseExecution,
      decision,
      expanded: false
    };
  }

  return {
    factory: baseFactory,
    phaseExecution: options.phaseExecution,
    decision: null,
    expanded: false
  };
}

function isExpandableVerificationCriterion(criterion: FactoryVerificationCriterion) {
  return criterion.evidenceKind === "task_evidence" || criterion.evidenceKind === "backlog_item_status";
}

function isVerificationCriterionSatisfied(options: {
  criterion: FactoryVerificationCriterion;
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState;
  stagePlan: FactoryStagePlan;
}) {
  switch (options.criterion.evidenceKind) {
    case "backlog_item_status":
      return options.stagePlan.backlog.some(
        (item) =>
          item.status === "completed" &&
          item.completionCriterionIds.includes(options.criterion.target)
      );
    case "task_evidence": {
      const task = findTask(options.phaseExecution, options.criterion.target);

      if (!task || task.status !== "completed") {
        return false;
      }

      return includesNormalized(buildTaskEvidence(task), options.criterion.expectedValue ?? "");
    }
    default:
      return false;
  }
}

function createExpansionDecision(
  decision: Omit<FactoryExpansionDecision, "id">
): FactoryExpansionDecision {
  return {
    id: `factory-expansion:${decision.stageId}:${decision.outcome}:${decision.decidedAt}`,
    ...decision
  };
}

function appendExpansionDecision(
  existing: FactoryRunState["expansionDecisions"],
  decision: FactoryExpansionDecision
) {
  return [...existing, decision];
}

function shouldRecordCompletionDecision(factory: FactoryRunState, stageId: FactoryStageId) {
  return !factory.expansionDecisions.some(
    (decision) => decision.stageId === stageId && decision.outcome === "complete"
  );
}

function findTask(phaseExecution: PhaseExecutionState, taskId: string): Task | null {
  for (const phase of phaseExecution.phases) {
    for (const story of phase.userStories) {
      const task = story.tasks.find((candidate) => candidate.id === taskId);

      if (task) {
        return task;
      }
    }
  }

  return null;
}

function buildTaskEvidence(task: Task) {
  return [
    task.result?.summary ?? null,
    task.result?.responseText ?? null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function includesNormalized(haystack: string, needle: string) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
