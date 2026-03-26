import type {
  AgentRunRecord,
  ControlPlaneArtifact,
  ControlPlaneHandoff,
  ControlPlaneIntervention,
  ControlPlanePhaseNode,
  ControlPlaneRole,
  ControlPlaneState,
  ControlPlaneStoryNode,
  ControlPlaneTaskNode,
  OperatorJournalTone,
  OperatorRunBlocker,
  OperatorRunApprovalGate,
  OperatorRunCurrentWork,
  OperatorRunDelegationPacket,
  OperatorRunJournalEntry,
  OperatorRunOwner,
  OperatorRunPlanningArtifact,
  OperatorRunProgress,
  OperatorRunRetrySummary,
  OperatorRunStage,
  OperatorRunStageId,
  OperatorRunStageStatus,
  OperatorRunView,
  PhaseExecutionState,
  RebuildState,
  TeamSkillId
} from "./types";
import type { RunEvent, RunEventType } from "../validation/types";

const STAGE_ORDER: OperatorRunStageId[] = [
  "queued",
  "coordination",
  "execution",
  "validation",
  "rebuild",
  "delivery"
];

const STAGE_LABELS: Record<OperatorRunStageId, string> = {
  queued: "Queued",
  coordination: "Coordination",
  execution: "Execution",
  validation: "Validation",
  rebuild: "Rebuild",
  delivery: "Delivery"
};

const MAX_JOURNAL_ENTRIES = 25;

export function deriveOperatorRunView(run: AgentRunRecord): OperatorRunView {
  const current = deriveCurrentWork(run);
  const stageId = determineStageId(run);
  const blockers = deriveOpenBlockers(run.controlPlane);
  const owner = deriveOwner(run, current, stageId);
  const stages = buildStageSequence(run, stageId, current, blockers);
  const approval = deriveApproval(run);
  const planningArtifacts = derivePlanningArtifacts(run.controlPlane);
  const delegationPackets = deriveDelegationPackets(run.controlPlane);
  const stage = stages.find((candidate) => candidate.id === stageId) ?? stages[0] ?? {
    id: "queued",
    label: STAGE_LABELS.queued,
    status: "pending",
    detail: "Run has not started yet."
  };

  return {
    summary: deriveSummary(run, stage, blockers),
    stage,
    stages,
    owner,
    current,
    nextAction: deriveNextAction(run, stageId, current, blockers, approval),
    progress: deriveProgress(run),
    retries: deriveRetrySummary(run),
    approval,
    blockers,
    planningArtifacts,
    delegationPackets,
    journal: buildJournal(run)
  };
}

function determineStageId(run: AgentRunRecord): OperatorRunStageId {
  if (run.status === "pending") {
    return "queued";
  }

  if (run.rebuild && (run.rebuild.status === "queued" || run.rebuild.status === "rebuilding")) {
    return "rebuild";
  }

  if (run.status === "completed") {
    return "delivery";
  }

  if (run.status === "failed") {
    return determineFailureStage(run);
  }

  if (run.validationStatus === "failed" || run.validationStatus === "rolled_back") {
    return "validation";
  }

  if (run.orchestration?.status === "verifying") {
    return "validation";
  }

  if (run.orchestration?.status === "executing" || hasActiveTask(run)) {
    return "execution";
  }

  if (
    run.orchestration?.status === "planning" ||
    hasActiveCoordination(run) ||
    run.phaseExecution?.status === "in_progress" ||
    run.controlPlane?.status === "in_progress"
  ) {
    return "coordination";
  }

  return run.startedAt ? "execution" : "queued";
}

function determineFailureStage(run: AgentRunRecord): OperatorRunStageId {
  if (run.rebuild?.status === "failed") {
    return "rebuild";
  }

  if (
    run.validationStatus === "failed" ||
    run.validationStatus === "rolled_back" ||
    run.validationStatus === "rollback_failed" ||
    run.events.some(
      (event) =>
        event.type === "validation_failed" ||
        event.type === "validation_gate_failed" ||
        event.type === "rollback_failed"
    )
  ) {
    return "validation";
  }

  if (run.orchestration?.status === "planning") {
    return "coordination";
  }

  if (run.orchestration?.status === "verifying") {
    return "validation";
  }

  if (hasActiveTask(run) || run.orchestration?.status === "executing") {
    return "execution";
  }

  return "coordination";
}

function hasActiveTask(run: AgentRunRecord) {
  if (run.phaseExecution?.current.taskId) {
    return true;
  }

  return Boolean(
    run.phaseExecution?.phases.some((phase) =>
      phase.userStories.some((story) => story.tasks.some((task) => task.status === "running"))
    )
  );
}

function hasActiveCoordination(run: AgentRunRecord) {
  if (run.phaseExecution?.current.phaseId || run.phaseExecution?.current.storyId) {
    return true;
  }

  return Boolean(
    run.controlPlane?.handoffs.some(
      (handoff) => handoff.status === "created" || handoff.status === "accepted"
    )
  );
}

function buildStageSequence(
  run: AgentRunRecord,
  activeStageId: OperatorRunStageId,
  current: OperatorRunCurrentWork,
  blockers: OperatorRunBlocker[]
): OperatorRunStage[] {
  const activeIndex = STAGE_ORDER.indexOf(activeStageId);

  return STAGE_ORDER.map((stageId, index) => {
    const status = deriveStageStatus(run, stageId, activeStageId, activeIndex, index);
    return {
      id: stageId,
      label: STAGE_LABELS[stageId],
      status,
      detail: describeStage(run, stageId, status, current, blockers)
    };
  });
}

function deriveStageStatus(
  run: AgentRunRecord,
  stageId: OperatorRunStageId,
  activeStageId: OperatorRunStageId,
  activeIndex: number,
  index: number
): OperatorRunStageStatus {
  if (stageId === "rebuild" && !run.rebuild) {
    return "skipped";
  }

  if (run.status === "completed") {
    if (stageId === "rebuild" && !run.rebuild) {
      return "skipped";
    }

    return stageId === "delivery"
      ? "completed"
      : index < STAGE_ORDER.indexOf("delivery")
        ? "completed"
        : "pending";
  }

  if (run.status === "failed") {
    if (index < activeIndex) {
      return "completed";
    }

    if (stageId === activeStageId) {
      return "failed";
    }

    return "pending";
  }

  if (run.status === "pending") {
    return stageId === "queued" ? "active" : stageId === "rebuild" && !run.rebuild ? "skipped" : "pending";
  }

  if (index < activeIndex) {
    return "completed";
  }

  if (stageId === activeStageId) {
    return "active";
  }

  return "pending";
}

function describeStage(
  run: AgentRunRecord,
  stageId: OperatorRunStageId,
  status: OperatorRunStageStatus,
  current: OperatorRunCurrentWork,
  blockers: OperatorRunBlocker[]
) {
  switch (stageId) {
    case "queued":
      return status === "active"
        ? "Run is accepted by the runtime and waiting for a worker."
        : "Run has moved out of the intake queue.";
    case "coordination":
      if (blockers.length > 0 && status !== "completed") {
        return `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} are stopping coordination.`;
      }

      if (run.orchestration?.status === "planning") {
        return "Planner is shaping the next step for execution.";
      }

      if (run.phaseExecution?.status === "in_progress" || run.controlPlane?.status === "in_progress") {
        return current.entityKind === "phase" || current.entityKind === "story"
          ? `Production lead is routing ${current.label ?? "current work"}.`
          : "Production lead is routing the active workflow.";
      }

      return status === "completed"
        ? "The run has already been coordinated."
        : "Runtime coordination has not started yet.";
    case "execution":
      if (current.entityKind === "task" && current.label) {
        return `Working on ${current.label}.`;
      }

      if (run.orchestration?.currentStep?.title) {
        return `Running ${run.orchestration.currentStep.title}.`;
      }

      return status === "completed"
        ? "Execution finished for the current run."
        : "Runtime is executing the active work.";
    case "validation":
      if (run.validationStatus === "failed" || run.validationStatus === "rolled_back") {
        return "Validation detected a problem and the run needs another pass.";
      }

      if (run.orchestration?.status === "verifying") {
        return "Verifier is checking the latest execution evidence.";
      }

      return status === "completed"
        ? "Validation checks finished for the run."
        : "Validation has not started yet.";
    case "rebuild":
      if (!run.rebuild) {
        return "This run does not include a rebuild step.";
      }

      if (run.rebuild.status === "queued") {
        return "Rebuild is queued and waiting to start.";
      }

      if (run.rebuild.status === "rebuilding") {
        return `Applying artifacts and interventions for ${describeRebuildTarget(run.rebuild)}.`;
      }

      if (run.rebuild.status === "failed") {
        return run.rebuild.lastFailureReason ?? "Rebuild failed before delivery.";
      }

      return "Rebuild completed and delivery can proceed.";
    case "delivery":
      if (run.status === "completed") {
        return run.result?.summary ?? "Run completed and is ready for review.";
      }

      if (run.status === "failed") {
        return run.error?.message ?? "Run stopped before it could be delivered.";
      }

      return "Final delivery summary will appear when the run finishes.";
  }
}

function deriveSummary(
  run: AgentRunRecord,
  stage: OperatorRunStage,
  blockers: OperatorRunBlocker[]
) {
  if (run.error?.message?.trim()) {
    return run.error.message.trim();
  }

  if (blockers[0]?.summary) {
    return blockers[0].summary;
  }

  if (run.result?.summary?.trim()) {
    return run.result.summary.trim();
  }

  if (run.rollingSummary?.text?.trim()) {
    return run.rollingSummary.text.trim();
  }

  return stage.detail;
}

function deriveProgress(run: AgentRunRecord): OperatorRunProgress | null {
  const progress = run.phaseExecution?.progress ?? run.controlPlane?.progress ?? run.rebuild?.progress;

  if (!progress) {
    return null;
  }

  return {
    totalPhases: progress.totalPhases,
    completedPhases: progress.completedPhases,
    totalStories: progress.totalStories,
    completedStories: progress.completedStories,
    totalTasks: progress.totalTasks,
    completedTasks: progress.completedTasks
  };
}

function deriveRetrySummary(run: AgentRunRecord): OperatorRunRetrySummary {
  const stories = run.phaseExecution?.phases.flatMap((phase) => phase.userStories) ?? [];
  const tasks = stories.flatMap((story) => story.tasks);
  const storyRetries = stories.reduce((total, story) => total + story.retryCount, 0);
  const taskRetries = tasks.reduce((total, task) => total + task.retryCount, 0);
  const runRetries = run.retryCount;
  const totalRetries = runRetries + storyRetries + taskRetries;
  const maxStoryRetries = run.phaseExecution?.retryPolicy.maxStoryRetries ?? null;
  const maxTaskRetries = run.phaseExecution?.retryPolicy.maxTaskRetries ?? null;

  return {
    runRetries,
    storyRetries,
    taskRetries,
    totalRetries,
    maxStoryRetries,
    maxTaskRetries,
    note:
      totalRetries === 0
        ? "No retries yet."
        : `Retries so far: ${taskRetries} task, ${storyRetries} story, ${runRetries} run.`
  };
}

function deriveApproval(run: AgentRunRecord): OperatorRunView["approval"] {
  const controlPlane = run.controlPlane;

  if (!controlPlane || controlPlane.approvalGates.length === 0) {
    return null;
  }

  const gates: OperatorRunApprovalGate[] = controlPlane.approvalGates.map((gate) => ({
    id: gate.id,
    kind: gate.kind,
    phaseId: gate.phaseId,
    phaseName: gate.phaseName,
    title: gate.title,
    instructions: gate.instructions,
    status: gate.status,
    waitingAt: gate.waitingAt,
    resolvedAt: gate.resolvedAt,
    ownerLabel: resolveAgentLabel(
      controlPlane,
      gate.ownerId,
      gate.ownerRole,
      gate.ownerAgentTypeId
    ),
    decisions: gate.decisions.map((decision) => ({ ...decision }))
  }));
  const activeGate =
    gates.find((gate) => gate.id === controlPlane.activeApprovalGateId) ??
    gates.find((gate) => gate.status === "waiting" || gate.status === "rejected") ??
    null;

  return {
    activeGateId: activeGate?.id ?? null,
    activeGate,
    gates
  };
}

function deriveOpenBlockers(controlPlane: ControlPlaneState | null | undefined): OperatorRunBlocker[] {
  if (!controlPlane) {
    return [];
  }

  return controlPlane.blockers
    .filter((blocker) => blocker.status === "open")
    .map((blocker) => ({
      id: blocker.id,
      entityKind: blocker.entityKind,
      entityId: blocker.entityId,
      summary: blocker.summary,
      ownerLabel: resolveAgentLabel(
        controlPlane,
        blocker.ownerId,
        blocker.ownerRole,
        blocker.ownerAgentTypeId
      ),
      createdAt: blocker.createdAt
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function deriveCurrentWork(run: AgentRunRecord): OperatorRunCurrentWork {
  if (run.rebuild && run.rebuild.status !== "completed") {
    return {
      entityKind: "rebuild",
      entityId: run.rebuild.target.shipId,
      label: describeRebuildTarget(run.rebuild),
      status: run.rebuild.status
    };
  }

  const phaseExecution = run.phaseExecution;

  if (phaseExecution?.current.taskId) {
    const task = findTask(phaseExecution, phaseExecution.current.taskId);

    return {
      entityKind: "task",
      entityId: phaseExecution.current.taskId,
      label: task ? summarizeTask(task.id, task.expectedOutcome, task.instruction) : phaseExecution.current.taskId,
      status: task?.status ?? null
    };
  }

  if (phaseExecution?.current.storyId) {
    const story = findStory(phaseExecution, phaseExecution.current.storyId);

    return {
      entityKind: "story",
      entityId: phaseExecution.current.storyId,
      label: story?.title ?? phaseExecution.current.storyId,
      status: story?.status ?? null
    };
  }

  if (phaseExecution?.current.phaseId) {
    const phase = findPhase(phaseExecution, phaseExecution.current.phaseId);

    return {
      entityKind: "phase",
      entityId: phaseExecution.current.phaseId,
      label: phase?.name ?? phaseExecution.current.phaseId,
      status: phase?.status ?? null
    };
  }

  if (run.orchestration?.currentStep) {
    return {
      entityKind: "orchestration_step",
      entityId: run.orchestration.currentStep.id,
      label: run.orchestration.currentStep.title,
      status: run.orchestration.status
    };
  }

  return {
    entityKind: "run",
    entityId: run.id,
    label: run.title?.trim() || summarizeText(run.instruction, 96),
    status: run.status
  };
}

function deriveOwner(
  run: AgentRunRecord,
  current: OperatorRunCurrentWork,
  stageId: OperatorRunStageId
): OperatorRunOwner {
  const controlPlane = run.controlPlane;

  if (controlPlane) {
    if (current.entityKind === "task" && current.entityId) {
      const node = findTaskNode(controlPlane, current.entityId);

      if (node) {
        return toOwner(controlPlane, node.ownerId, node.ownerRole, node.ownerAgentTypeId);
      }
    }

    if (current.entityKind === "story" && current.entityId) {
      const node = findStoryNode(controlPlane, current.entityId);

      if (node) {
        return toOwner(controlPlane, node.ownerId, node.ownerRole, node.ownerAgentTypeId);
      }
    }

    if (current.entityKind === "phase" && current.entityId) {
      const node = findPhaseNode(controlPlane, current.entityId);

      if (node) {
        return toOwner(controlPlane, node.ownerId, node.ownerRole, node.ownerAgentTypeId);
      }
    }

    const runOwner = controlPlane.agents.find((agent) => agent.id === controlPlane.runOwnerId);

    if (runOwner) {
      return {
        id: runOwner.id,
        role: runOwner.role,
        label: runOwner.label,
        agentTypeId: runOwner.agentTypeId
      };
    }
  }

  if (stageId === "validation") {
    return {
      id: null,
      role: "verifier",
      label: "Verifier",
      agentTypeId: null
    };
  }

  if (stageId === "execution") {
    return {
      id: null,
      role: "executor",
      label: "Executor",
      agentTypeId: null
    };
  }

  if (stageId === "coordination") {
    return {
      id: null,
      role: "planner",
      label: "Planner",
      agentTypeId: null
    };
  }

  if (stageId === "queued") {
    return {
      id: null,
      role: "runtime_worker",
      label: "Runtime worker",
      agentTypeId: null
    };
  }

  return {
    id: null,
    role: "system",
    label: "Runtime record",
    agentTypeId: null
  };
}

function deriveNextAction(
  run: AgentRunRecord,
  stageId: OperatorRunStageId,
  current: OperatorRunCurrentWork,
  blockers: OperatorRunBlocker[],
  approval: OperatorRunView["approval"]
) {
  if (approval?.activeGate) {
    return `Review ${approval.activeGate.title.toLowerCase()} for ${approval.activeGate.phaseName}.`;
  }

  if (blockers[0]) {
    return `Resolve blocker: ${blockers[0].summary}`;
  }

  if (run.status === "completed") {
    return "Review the delivery summary and resulting artifacts.";
  }

  if (run.status === "failed") {
    return "Inspect the failure summary, resolve the issue, and retry the run.";
  }

  switch (stageId) {
    case "queued":
      return "Wait for the runtime worker to start this run.";
    case "coordination":
      if (current.entityKind === "phase" || current.entityKind === "story") {
        return `Route the next handoff for ${current.label ?? "the active workflow"}.`;
      }

      return "Wait for the planner or production lead to assign the next step.";
    case "execution":
      return current.label ? `Complete ${current.label}.` : "Wait for execution to finish.";
    case "validation":
      return run.validationStatus === "failed" || run.validationStatus === "rolled_back"
        ? "Fix the validation issue before retrying."
        : "Wait for validation to finish.";
    case "rebuild":
      return run.rebuild
        ? `Apply the rebuild workflow for ${describeRebuildTarget(run.rebuild)}.`
        : null;
    case "delivery":
      return "Review the final run outcome.";
  }
}

function buildJournal(run: AgentRunRecord): OperatorRunJournalEntry[] {
  const entries: OperatorRunJournalEntry[] = [];

  entries.push({
    id: `${run.id}:submitted`,
    kind: "run",
    at: run.createdAt,
    label: "Run submitted",
    detail: run.title?.trim() || summarizeText(run.instruction, 160),
    tone: "info",
    meta: []
  });

  if (run.startedAt) {
    entries.push({
      id: `${run.id}:started`,
      kind: "run",
      at: run.startedAt,
      label: "Run started",
      detail: "Runtime worker began processing the request.",
      tone: "info",
      meta: []
    });
  }

  if (run.completedAt) {
    entries.push({
      id: `${run.id}:completed`,
      kind: "run",
      at: run.completedAt,
      label: run.status === "failed" ? "Run failed" : "Run completed",
      detail:
        run.status === "failed"
          ? run.error?.message ?? "Run ended with an error."
          : run.result?.summary ?? "Run completed successfully.",
      tone: run.status === "failed" ? "danger" : "success",
      meta: []
    });
  }

  appendEventEntries(entries, run.events);
  appendArtifactEntries(entries, run.controlPlane?.artifacts ?? []);
  appendHandoffEntries(entries, run.controlPlane);
  appendInterventionEntries(entries, run.controlPlane?.interventions ?? []);
  appendBlockerEntries(entries, run.controlPlane);

  return [...entries]
    .sort((left, right) => {
      if (left.at === right.at) {
        return left.id.localeCompare(right.id);
      }

      return right.at.localeCompare(left.at);
    })
    .slice(0, MAX_JOURNAL_ENTRIES);
}

function derivePlanningArtifacts(
  controlPlane: ControlPlaneState | null | undefined
): OperatorRunPlanningArtifact[] {
  if (!controlPlane) {
    return [];
  }

  return controlPlane.artifacts
    .filter((artifact) =>
      [
        "plan",
        "requirements",
        "architecture_decision",
        "subtask_breakdown",
        "delegation_brief"
      ].includes(artifact.kind)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      entityKind: artifact.entityKind,
      entityId: artifact.entityId,
      summary: artifact.summary,
      createdAt: artifact.createdAt,
      producerLabel: resolveAgentLabel(
        controlPlane,
        artifact.producerId,
        artifact.producerRole,
        artifact.producerAgentTypeId
      ),
      path: artifact.path ?? null,
      highlights: describeArtifactHighlights(artifact)
    }));
}

function deriveDelegationPackets(
  controlPlane: ControlPlaneState | null | undefined
): OperatorRunDelegationPacket[] {
  if (!controlPlane) {
    return [];
  }

  return controlPlane.handoffs
    .filter((handoff) => handoff.workPacket !== null || handoff.artifactIds.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((handoff) => ({
      id: handoff.id,
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      routeLabel: `${resolveAgentLabel(
        controlPlane,
        handoff.fromId,
        handoff.fromRole,
        handoff.fromAgentTypeId
      )} -> ${resolveAgentLabel(controlPlane, handoff.toId, handoff.toRole, handoff.toAgentTypeId)}`,
      purpose: handoff.purpose,
      status: handoff.status,
      createdAt: handoff.createdAt,
      acceptedAt: handoff.acceptedAt,
      completedAt: handoff.completedAt,
      ownerLabel: resolveAgentLabel(controlPlane, handoff.toId, handoff.toRole, handoff.toAgentTypeId),
      artifactIds: [...handoff.artifactIds],
      dependencyIds: [...handoff.dependencyIds],
      acceptanceCriteria: [...handoff.acceptanceCriteria],
      validationTargets: [...handoff.validationTargets],
      workPacket: handoff.workPacket
        ? {
            ...handoff.workPacket,
            sourceArtifactIds: [...handoff.workPacket.sourceArtifactIds],
            constraints: [...handoff.workPacket.constraints],
            fileTargets: [...handoff.workPacket.fileTargets],
            domainTargets: [...handoff.workPacket.domainTargets],
            acceptanceCriteria: [...handoff.workPacket.acceptanceCriteria],
            validationTargets: [...handoff.workPacket.validationTargets],
            dependencyIds: [...handoff.workPacket.dependencyIds],
            taskIds: [...handoff.workPacket.taskIds],
            ownerLabel: resolveAgentTypeLabel(controlPlane, handoff.workPacket.ownerAgentTypeId)
          }
        : null
    }));
}

function describeArtifactHighlights(artifact: ControlPlaneArtifact) {
  if (!artifact.payload) {
    return [];
  }

  switch (artifact.payload.kind) {
    case "plan":
      return compactHighlights([
        `${artifact.payload.phaseIds.length} phase${artifact.payload.phaseIds.length === 1 ? "" : "s"}`,
        `${artifact.payload.storyIds.length} stor${artifact.payload.storyIds.length === 1 ? "y" : "ies"}`,
        `${artifact.payload.taskIds.length} task${artifact.payload.taskIds.length === 1 ? "" : "s"}`,
        artifact.payload.validationTargets.length
          ? `${artifact.payload.validationTargets.length} validation target${artifact.payload.validationTargets.length === 1 ? "" : "s"}`
          : null
      ]);
    case "requirements":
      return compactHighlights([
        summarizeText(artifact.payload.scopeSummary, 72),
        artifact.payload.constraints.length
          ? `${artifact.payload.constraints.length} constraint${artifact.payload.constraints.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.fileTargets.length
          ? `${artifact.payload.fileTargets.length} file target${artifact.payload.fileTargets.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.domainTargets.length
          ? `${artifact.payload.domainTargets.length} domain target${artifact.payload.domainTargets.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.approvalGateKind
          ? `${capitalize(artifact.payload.approvalGateKind)} approval gate`
          : null
      ]);
    case "architecture_decision":
      return compactHighlights([
        humanizeKey(artifact.payload.selectedSpecialistAgentTypeId),
        humanizeKey(artifact.payload.decisionSource),
        artifact.payload.fileTargets.length
          ? `${artifact.payload.fileTargets.length} file target${artifact.payload.fileTargets.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.allowedToolNames.length
          ? `${artifact.payload.allowedToolNames.length} allowed tool${artifact.payload.allowedToolNames.length === 1 ? "" : "s"}`
          : null
      ]);
    case "subtask_breakdown":
      return compactHighlights([
        `${artifact.payload.tasks.length} task${artifact.payload.tasks.length === 1 ? "" : "s"}`,
        humanizeKey(artifact.payload.dependencyStrategy),
        ...artifact.payload.tasks.slice(0, 2).map((task) => humanizeKey(task.specialistAgentTypeId))
      ]);
    case "delegation_brief":
      return compactHighlights([
        summarizeText(artifact.payload.scopeSummary, 72),
        artifact.payload.acceptanceCriteria.length
          ? `${artifact.payload.acceptanceCriteria.length} acceptance check${artifact.payload.acceptanceCriteria.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.validationTargets.length
          ? `${artifact.payload.validationTargets.length} validation target${artifact.payload.validationTargets.length === 1 ? "" : "s"}`
          : null,
        artifact.payload.dependencyIds.length
          ? `${artifact.payload.dependencyIds.length} dependenc${artifact.payload.dependencyIds.length === 1 ? "y" : "ies"}`
          : null
      ]);
  }
}

function appendEventEntries(entries: OperatorRunJournalEntry[], events: RunEvent[]) {
  for (const [index, event] of events.entries()) {
    const meta = [event.phaseId, event.storyId, event.taskId, event.toolName, event.path]
      .filter(Boolean)
      .map((value) => String(value));

    entries.push({
      id: `${event.type}:${event.at}:${index}`,
      kind: "event",
      at: event.at,
      label: describeEventLabel(event.type),
      detail: event.message,
      tone: mapEventTone(event.type),
      meta
    });
  }
}

function appendArtifactEntries(entries: OperatorRunJournalEntry[], artifacts: ControlPlaneArtifact[]) {
  for (const artifact of artifacts) {
    if (
      artifact.kind !== "plan" &&
      artifact.kind !== "requirements" &&
      artifact.kind !== "architecture_decision" &&
      artifact.kind !== "subtask_breakdown" &&
      artifact.kind !== "delivery_summary" &&
      artifact.kind !== "failure_report"
    ) {
      continue;
    }

    entries.push({
      id: artifact.id,
      kind: "artifact",
      at: artifact.createdAt,
      label: describeArtifactLabel(artifact.kind),
      detail: artifact.summary,
      tone: artifact.kind === "failure_report" ? "danger" : "default",
      meta: [artifact.entityKind, artifact.entityId].filter(Boolean)
    });
  }
}

function appendHandoffEntries(
  entries: OperatorRunJournalEntry[],
  controlPlane: ControlPlaneState | null | undefined
) {
  if (!controlPlane) {
    return;
  }

  for (const handoff of controlPlane.handoffs) {
    const route = `${resolveAgentLabel(
      controlPlane,
      handoff.fromId,
      handoff.fromRole,
      handoff.fromAgentTypeId
    )} -> ${resolveAgentLabel(controlPlane, handoff.toId, handoff.toRole, handoff.toAgentTypeId)}`;
    const meta = [route, handoff.entityKind, handoff.entityId];

    entries.push({
      id: `${handoff.id}:created`,
      kind: "handoff",
      at: handoff.createdAt,
      label: `${capitalize(handoff.entityKind)} handoff created`,
      detail: handoff.purpose,
      tone: "info",
      meta
    });

    if (handoff.acceptedAt) {
      entries.push({
        id: `${handoff.id}:accepted`,
        kind: "handoff",
        at: handoff.acceptedAt,
        label: `${capitalize(handoff.entityKind)} handoff accepted`,
        detail: handoff.purpose,
        tone: "info",
        meta
      });
    }

    if (handoff.completedAt) {
      entries.push({
        id: `${handoff.id}:completed`,
        kind: "handoff",
        at: handoff.completedAt,
        label: `${capitalize(handoff.entityKind)} handoff completed`,
        detail: handoff.purpose,
        tone: "success",
        meta
      });
    }
  }
}

function appendInterventionEntries(
  entries: OperatorRunJournalEntry[],
  interventions: ControlPlaneIntervention[]
) {
  for (const intervention of interventions) {
    entries.push({
      id: `${intervention.id}:created`,
      kind: "intervention",
      at: intervention.createdAt,
      label: `${humanizeKey(intervention.kind)} opened`,
      detail: intervention.summary,
      tone: intervention.kind === "retry" || intervention.kind === "manual_review" ? "warning" : "info",
      meta: [intervention.entityKind, intervention.entityId]
    });

    if (intervention.resolvedAt) {
      entries.push({
        id: `${intervention.id}:resolved`,
        kind: "intervention",
        at: intervention.resolvedAt,
        label: `${humanizeKey(intervention.kind)} resolved`,
        detail: intervention.summary,
        tone: "success",
        meta: [intervention.entityKind, intervention.entityId]
      });
    }
  }
}

function appendBlockerEntries(
  entries: OperatorRunJournalEntry[],
  controlPlane: ControlPlaneState | null | undefined
) {
  if (!controlPlane) {
    return;
  }

  for (const blocker of controlPlane.blockers) {
    const meta = [
      blocker.entityKind,
      blocker.entityId,
      resolveAgentLabel(controlPlane, blocker.ownerId, blocker.ownerRole, blocker.ownerAgentTypeId)
    ];

    entries.push({
      id: `${blocker.id}:opened`,
      kind: "blocker",
      at: blocker.createdAt,
      label: `${capitalize(blocker.entityKind)} blocker opened`,
      detail: blocker.summary,
      tone: "warning",
      meta
    });

    if (blocker.resolvedAt) {
      entries.push({
        id: `${blocker.id}:resolved`,
        kind: "blocker",
        at: blocker.resolvedAt,
        label: `${capitalize(blocker.entityKind)} blocker resolved`,
        detail: blocker.summary,
        tone: "success",
        meta
      });
    }
  }
}

function findPhase(phaseExecution: PhaseExecutionState, phaseId: string) {
  return phaseExecution.phases.find((phase) => phase.id === phaseId) ?? null;
}

function findStory(phaseExecution: PhaseExecutionState, storyId: string) {
  for (const phase of phaseExecution.phases) {
    const story = phase.userStories.find((candidate) => candidate.id === storyId);

    if (story) {
      return story;
    }
  }

  return null;
}

function findTask(phaseExecution: PhaseExecutionState, taskId: string) {
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

function findPhaseNode(controlPlane: ControlPlaneState, phaseId: string) {
  return controlPlane.phases.find((phase) => phase.id === phaseId) ?? null;
}

function findStoryNode(controlPlane: ControlPlaneState, storyId: string) {
  for (const phase of controlPlane.phases) {
    const story = phase.userStories.find((candidate) => candidate.id === storyId);

    if (story) {
      return story;
    }
  }

  return null;
}

function findTaskNode(controlPlane: ControlPlaneState, taskId: string) {
  for (const phase of controlPlane.phases) {
    for (const story of phase.userStories) {
      const task = story.tasks.find((candidate) => candidate.id === taskId);

      if (task) {
        return task;
      }
    }
  }

  return null;
}

function resolveAgentLabel(
  controlPlane: ControlPlaneState,
  agentId: string,
  role: ControlPlaneRole,
  agentTypeId: TeamSkillId | null
) {
  return (
    controlPlane.agents.find((agent) => agent.id === agentId)?.label ??
    deriveOwnerLabel(role, agentTypeId)
  );
}

function resolveAgentTypeLabel(controlPlane: ControlPlaneState, agentTypeId: TeamSkillId | null) {
  if (!agentTypeId) {
    return null;
  }

  return (
    controlPlane.agents.find((agent) => agent.agentTypeId === agentTypeId)?.label ??
    humanizeKey(agentTypeId)
  );
}

function toOwner(
  controlPlane: ControlPlaneState,
  id: string,
  role: ControlPlaneRole,
  agentTypeId: TeamSkillId | null
): OperatorRunOwner {
  return {
    id,
    role,
    label: resolveAgentLabel(controlPlane, id, role, agentTypeId),
    agentTypeId
  };
}

function deriveOwnerLabel(
  role: ControlPlaneRole | "planner" | "executor" | "verifier" | "runtime_worker" | "system",
  agentTypeId: TeamSkillId | null
) {
  if (role === "planner") {
    return "Planner";
  }

  if (role === "executor") {
    return "Executor";
  }

  if (role === "verifier") {
    return "Verifier";
  }

  if (role === "runtime_worker") {
    return "Runtime worker";
  }

  if (role === "system") {
    return "Runtime record";
  }

  const baseLabel =
    role === "production_lead"
      ? "Production Lead"
      : role === "specialist_dev"
        ? "Specialist Dev"
        : role === "execution_subagent"
          ? "Execution Subagent"
          : "Orchestrator";

  if (!agentTypeId || agentTypeId === "production_lead" || agentTypeId === "execution_subagent") {
    return baseLabel;
  }

  return `${baseLabel} (${humanizeKey(agentTypeId)})`;
}

function describeRebuildTarget(rebuild: RebuildState) {
  return rebuild.target.label?.trim() || rebuild.target.objective?.trim() || rebuild.target.shipId;
}

function summarizeTask(taskId: string, expectedOutcome: string, instruction: string) {
  const preferred = expectedOutcome.trim() || instruction.trim() || taskId;
  return summarizeText(preferred, 96);
}

function summarizeText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactHighlights(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 4);
}

function describeEventLabel(type: RunEventType) {
  switch (type) {
    case "approval_gate_waiting":
      return "Approval gate waiting";
    case "approval_gate_approved":
      return "Approval gate approved";
    case "approval_gate_rejected":
      return "Approval gate rejected";
    case "approval_gate_retry_requested":
      return "Approval gate retry requested";
    case "planner_step_proposed":
      return "Planner proposed a step";
    case "executor_step_completed":
      return "Executor completed a step";
    case "verifier_decision_made":
      return "Verifier made a decision";
    case "coordination_conflict_detected":
      return "Coordination conflict detected";
    case "retry_scheduled":
      return "Retry scheduled";
    case "validation_gate_failed":
      return "Validation gate failed";
    case "validation_gate_passed":
      return "Validation gate passed";
    default:
      return humanizeKey(type);
  }
}

function describeArtifactLabel(kind: ControlPlaneArtifact["kind"]) {
  switch (kind) {
    case "plan":
      return "Plan recorded";
    case "requirements":
      return "Requirements recorded";
    case "architecture_decision":
      return "Architecture decision recorded";
    case "subtask_breakdown":
      return "Subtask breakdown recorded";
    case "delivery_summary":
      return "Delivery summary recorded";
    case "failure_report":
      return "Failure report recorded";
    default:
      return humanizeKey(kind);
  }
}

function mapEventTone(type: RunEventType): OperatorJournalTone {
  if (
    type.includes("rejected") ||
    type.includes("failed") ||
    type.includes("execution_failed") ||
    type.includes("rollback_failed")
  ) {
    return "danger";
  }

  if (type.includes("retry") || type.includes("conflict") || type.includes("waiting")) {
    return "warning";
  }

  if (
    type.includes("approved") ||
    type.includes("completed") ||
    type.includes("passed") ||
    type.includes("succeeded")
  ) {
    return "success";
  }

  if (
    type.includes("started") ||
    type.includes("proposed") ||
    type.includes("made")
  ) {
    return "info";
  }

  return "default";
}

function humanizeKey(value: string) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => capitalize(segment))
    .join(" ");
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
