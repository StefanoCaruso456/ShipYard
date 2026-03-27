import type {
  ApprovalDecision,
  ApprovalGateState,
  AgentRunResult,
  ControlPlaneAgent,
  ControlPlaneApprovalGate,
  ControlPlaneArtifact,
  ControlPlaneArchitectureDecisionArtifactPayload,
  ControlPlaneBlocker,
  ControlPlaneConflict,
  ControlPlaneConflictKind,
  ControlPlaneDeliverySummaryArtifactPayload,
  ControlPlaneDeliverySummaryLink,
  ControlPlaneDecomposedTask,
  ControlPlaneDelegationBriefArtifactPayload,
  ControlPlaneEntityKind,
  ControlPlaneEntityStatus,
  ControlPlaneFailureReportArtifactPayload,
  ControlPlaneHandoff,
  ControlPlaneIntervention,
  ControlPlaneMergeDecision,
  ControlPlaneMergeResolution,
  ControlPlanePlanArtifactPayload,
  ControlPlanePhaseNode,
  ControlPlaneRequirementsArtifactPayload,
  ControlPlaneRole,
  ControlPlaneRoutingDecisionSource,
  ControlPlaneState,
  ControlPlaneStoryNode,
  ControlPlaneSubtaskBreakdownArtifactPayload,
  ControlPlaneTaskNode,
  ControlPlaneTransition,
  ControlPlaneValidationState,
  ControlPlaneWorkPacket,
  FactoryRunState,
  Phase,
  PhaseExecutionState,
  SpecialistAgentDefinition,
  SpecialistAgentTypeId,
  Task,
  TeamSkillId,
  UserStory,
  ValidationGateResult
} from "./types";
import {
  createSpecialistAgentRegistry,
  getSpecialistDefinition,
  resolveSpecialistAgentType
} from "./agentRegistry";
import { findFactoryDelegationBrief, findFactoryPhaseContract } from "./factoryDelegation";
import type { TraceValue } from "../observability/types";
import { getActiveTraceScope } from "../observability/traceScope";

const ORCHESTRATOR_ID = "agent:orchestrator";
const PRODUCTION_LEAD_ID = "agent:production-lead";
const TRACE_ARRAY_PREVIEW_LIMIT = 6;

const ALLOWED_STATUS_TRANSITIONS: Record<
  ControlPlaneEntityStatus,
  ControlPlaneEntityStatus[]
> = {
  pending: ["in_progress", "blocked", "failed"],
  in_progress: ["completed", "failed", "blocked", "pending"],
  blocked: ["in_progress", "failed", "pending"],
  completed: ["pending"],
  failed: ["pending", "in_progress"]
};

export function createControlPlaneState(phaseExecution: PhaseExecutionState): ControlPlaneState {
  const updatedAt = new Date().toISOString();
  const specialistAgentRegistry = createSpecialistAgentRegistry();
  const controlPlane: ControlPlaneState = {
    version: 1,
    status: mapStatus(phaseExecution.status),
    runOwnerId: ORCHESTRATOR_ID,
    agents: buildAgents(phaseExecution, specialistAgentRegistry),
    specialistAgentRegistry,
    activeApprovalGateId: phaseExecution.activeApprovalGateId,
    current: {
      ...phaseExecution.current
    },
    progress: {
      ...phaseExecution.progress
    },
    retryPolicy: {
      ...phaseExecution.retryPolicy
    },
    phases: phaseExecution.phases.map((phase) =>
      createPhaseNode(phase, updatedAt, specialistAgentRegistry)
    ),
    approvalGates: buildApprovalGates(phaseExecution),
    artifacts: [],
    handoffs: [],
    conflicts: [],
    mergeDecisions: [],
    interventions: [],
    blockers: [],
    lastFailureReason: phaseExecution.lastFailureReason,
    updatedAt
  };

  upsertArtifact(controlPlane, {
    id: "artifact:delivery-plan",
    kind: "plan",
    entityKind: "phase",
    entityId: phaseExecution.phases[0]?.id ?? "phase-plan",
    summary: renderPlanSummary(phaseExecution),
    createdAt: updatedAt,
    producerRole: "orchestrator",
    producerId: ORCHESTRATOR_ID,
    payload: buildPlanArtifactPayload(phaseExecution)
  });

  updateAgentStatuses(controlPlane);
  return controlPlane;
}

export function normalizeControlPlaneState(
  value: ControlPlaneState | null | undefined,
  phaseExecution?: PhaseExecutionState | null
): ControlPlaneState | null {
  if (!value) {
    return phaseExecution ? createControlPlaneState(phaseExecution) : null;
  }

  const normalized: ControlPlaneState = structuredClone(value);

  normalized.version = 1;
  normalized.runOwnerId = normalized.runOwnerId || ORCHESTRATOR_ID;
  normalized.specialistAgentRegistry =
    normalized.specialistAgentRegistry ?? createSpecialistAgentRegistry();
  normalized.activeApprovalGateId = normalized.activeApprovalGateId ?? null;
  normalized.agents = Array.isArray(normalized.agents)
    ? normalized.agents.map((agent) => ({
        ...agent,
        agentTypeId: agent.agentTypeId ?? inferAgentTypeId(agent.id),
        skillIds: Array.isArray(agent.skillIds) ? uniqueSkillIds(agent.skillIds) : [],
        allowedToolNames: Array.isArray(agent.allowedToolNames) ? agent.allowedToolNames : [],
        allowedHandoffTargets: Array.isArray(agent.allowedHandoffTargets)
          ? agent.allowedHandoffTargets
          : [],
        specialtyTags: Array.isArray(agent.specialtyTags) ? agent.specialtyTags : [],
        parentAgentId: agent.parentAgentId ?? null
      }))
    : [];
  normalized.artifacts = Array.isArray(normalized.artifacts)
    ? normalized.artifacts.map((artifact) => ({
        ...artifact,
        path: artifact.path ?? null,
        payload: normalizeArtifactPayload(artifact.payload)
      }))
    : [];
  normalized.handoffs = Array.isArray(normalized.handoffs)
    ? normalized.handoffs.map((handoff) => ({
        ...handoff,
        fromAgentTypeId:
          handoff.fromAgentTypeId ?? inferAgentTypeId(handoff.fromId),
        toAgentTypeId: handoff.toAgentTypeId ?? inferAgentTypeId(handoff.toId),
        correlationId:
          handoff.correlationId || correlationId(handoff.entityKind, handoff.entityId),
        artifactIds: Array.isArray(handoff.artifactIds) ? handoff.artifactIds : [],
        dependencyIds: Array.isArray(handoff.dependencyIds) ? handoff.dependencyIds : [],
        acceptanceCriteria: Array.isArray(handoff.acceptanceCriteria)
          ? handoff.acceptanceCriteria
          : [],
        acceptanceTargetIds: Array.isArray(handoff.acceptanceTargetIds)
          ? handoff.acceptanceTargetIds
          : [],
        verificationTargetIds: Array.isArray(handoff.verificationTargetIds)
          ? handoff.verificationTargetIds
          : [],
        validationTargets: Array.isArray(handoff.validationTargets)
          ? handoff.validationTargets
          : [],
        workPacket: normalizeWorkPacket(handoff.workPacket)
      }))
    : [];
  normalized.conflicts = Array.isArray(normalized.conflicts)
    ? normalized.conflicts.map((conflict) => ({
        ...conflict,
        stepId: conflict.stepId ?? null,
        resolvedAt: conflict.resolvedAt ?? null,
        ownerAgentTypeId: conflict.ownerAgentTypeId ?? inferAgentTypeId(conflict.ownerId),
        sourceHandoffId: conflict.sourceHandoffId ?? null,
        relatedHandoffIds: Array.isArray(conflict.relatedHandoffIds)
          ? conflict.relatedHandoffIds
          : [],
        conflictingPaths: Array.isArray(conflict.conflictingPaths)
          ? conflict.conflictingPaths
          : [],
        expectedPaths: Array.isArray(conflict.expectedPaths) ? conflict.expectedPaths : [],
        conflictingAgentTypeIds: Array.isArray(conflict.conflictingAgentTypeIds)
          ? uniqueSkillIds(conflict.conflictingAgentTypeIds)
          : [],
        resolutionDecisionId: conflict.resolutionDecisionId ?? null,
        metadata: conflict.metadata ?? null
      }))
    : [];
  normalized.mergeDecisions = Array.isArray(normalized.mergeDecisions)
    ? normalized.mergeDecisions.map((decision) => ({
        ...decision,
        conflictIds: Array.isArray(decision.conflictIds) ? decision.conflictIds : [],
        ownerAgentTypeId: decision.ownerAgentTypeId ?? inferAgentTypeId(decision.ownerId),
        targetHandoffId: decision.targetHandoffId ?? null,
        reassignedToAgentTypeId: decision.reassignedToAgentTypeId ?? null,
        notes: decision.notes ?? null
      }))
    : [];
  normalized.interventions = Array.isArray(normalized.interventions)
    ? normalized.interventions
    : [];
  normalized.blockers = Array.isArray(normalized.blockers) ? normalized.blockers : [];
  normalized.phases = Array.isArray(normalized.phases) ? normalized.phases : [];
  for (const phase of normalized.phases) {
    phase.conflictIds = Array.isArray(phase.conflictIds) ? phase.conflictIds : [];
    phase.mergeDecisionIds = Array.isArray(phase.mergeDecisionIds) ? phase.mergeDecisionIds : [];
    for (const story of phase.userStories) {
      story.conflictIds = Array.isArray(story.conflictIds) ? story.conflictIds : [];
      story.mergeDecisionIds = Array.isArray(story.mergeDecisionIds) ? story.mergeDecisionIds : [];
      for (const task of story.tasks) {
        task.conflictIds = Array.isArray(task.conflictIds) ? task.conflictIds : [];
        task.mergeDecisionIds = Array.isArray(task.mergeDecisionIds) ? task.mergeDecisionIds : [];
      }
    }
  }
  normalized.approvalGates = Array.isArray(normalized.approvalGates)
    ? normalized.approvalGates.map((gate) => ({
        ...gate,
        instructions: gate.instructions ?? null,
        waitingAt: gate.waitingAt ?? null,
        resolvedAt: gate.resolvedAt ?? null,
        ownerAgentTypeId: gate.ownerAgentTypeId ?? inferAgentTypeId(gate.ownerId),
        decisions: Array.isArray(gate.decisions) ? gate.decisions : []
      }))
    : [];

  if (phaseExecution) {
    return syncControlPlaneState(normalized, phaseExecution);
  }

  updateAgentStatuses(normalized);
  return normalized;
}

export function syncControlPlaneState(
  controlPlane: ControlPlaneState | null | undefined,
  phaseExecution: PhaseExecutionState
): ControlPlaneState {
  const next = controlPlane ?? createControlPlaneState(phaseExecution);
  const updatedAt = new Date().toISOString();

  next.status = mapStatus(phaseExecution.status);
  next.activeApprovalGateId = phaseExecution.activeApprovalGateId;
  next.current = {
    ...phaseExecution.current
  };
  next.progress = {
    ...phaseExecution.progress
  };
  next.retryPolicy = {
    ...phaseExecution.retryPolicy
  };
  next.lastFailureReason = phaseExecution.lastFailureReason;
  next.updatedAt = updatedAt;

  ensureNodes(next, phaseExecution, updatedAt);
  next.approvalGates = buildApprovalGates(phaseExecution);

  for (const phase of phaseExecution.phases) {
    const phaseNode = findPhaseNode(next, phase.id);

    if (!phaseNode) {
      continue;
    }

    syncNodeState({
      node: phaseNode,
      entityKind: "phase",
      entityId: phase.id,
      nextStatus: mapStatus(phase.status),
      nextFailureReason: phase.failureReason,
      nextValidationResults: phase.lastValidationResults,
      updatedAt
    });

    for (const story of phase.userStories) {
      const storyNode = findStoryNode(next, story.id);

      if (!storyNode) {
        continue;
      }

      storyNode.retryCount = story.retryCount;
      syncNodeState({
        node: storyNode,
        entityKind: "story",
        entityId: story.id,
        nextStatus: mapStatus(story.status),
        nextFailureReason: story.failureReason,
        nextValidationResults: story.lastValidationResults,
        updatedAt
      });

      for (const task of story.tasks) {
        const taskNode = findTaskNode(next, task.id);

        if (!taskNode) {
          continue;
        }

        taskNode.retryCount = task.retryCount;
        syncNodeState({
          node: taskNode,
          entityKind: "task",
          entityId: task.id,
          nextStatus: mapStatus(task.status),
          nextFailureReason: task.failureReason,
          nextValidationResults: task.lastValidationResults,
          updatedAt
        });
      }
    }
  }

  updateAgentStatuses(next);
  return next;
}

export function recordApprovalGateWaiting(
  controlPlane: ControlPlaneState | null,
  phase: Phase,
  gate: ApprovalGateState
) {
  if (!controlPlane) {
    return;
  }

  upsertIntervention(controlPlane, {
    id: approvalInterventionId(gate.id),
    kind: "manual_review",
    entityKind: "phase",
    entityId: phase.id,
    summary: `Waiting for ${gate.title.toLowerCase()} before ${phase.name}.`,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID
  });
}

export function recordApprovalGateDecision(
  controlPlane: ControlPlaneState | null,
  phase: Phase,
  gate: ApprovalGateState,
  decision: ApprovalDecision,
  summary: string
) {
  if (!controlPlane) {
    return;
  }

  if (decision === "reject") {
    upsertIntervention(controlPlane, {
      id: approvalInterventionId(gate.id),
      kind: "manual_review",
      entityKind: "phase",
      entityId: phase.id,
      summary,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID
    });
    upsertBlocker(controlPlane, {
      id: approvalBlockerId(gate.id),
      entityKind: "phase",
      entityId: phase.id,
      summary,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID
    });
    return;
  }

  resolveBlockerById(controlPlane, approvalBlockerId(gate.id));
  resolveInterventionById(controlPlane, approvalInterventionId(gate.id));
}

export function recordMergeGovernanceDecision(
  controlPlane: ControlPlaneState | null,
  input: {
    conflicts: Array<{
      type: string;
      stepId: string | null;
      reason: string;
      detectedAt: number;
      metadata?: TraceValue;
    }>;
    entityKind?: ControlPlaneEntityKind | null;
    entityId?: string | null;
    outcome: ControlPlaneMergeResolution;
    summary: string;
    targetHandoffId?: string | null;
    reassignedToAgentTypeId?: TeamSkillId | null;
    notes?: string | null;
  }
) {
  if (!controlPlane || input.conflicts.length === 0) {
    return;
  }

  const entity = resolveGovernanceEntity(controlPlane, input.entityKind, input.entityId);

  if (!entity) {
    return;
  }

  const sourceHandoffId = defaultHandoffId(entity.entityKind, entity.entityId);
  const conflictIds = input.conflicts.map((conflict) =>
    upsertConflict(
      controlPlane,
      buildGovernanceConflict(controlPlane, entity.entityKind, entity.entityId, sourceHandoffId, conflict)
    ).id
  );

  const decision = upsertMergeDecision(controlPlane, {
    id: `decision:${entity.entityKind}:${entity.entityId}:${input.outcome}`,
    entityKind: entity.entityKind,
    entityId: entity.entityId,
    conflictIds,
    outcome: input.outcome,
    summary: input.summary,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID,
    targetHandoffId: input.targetHandoffId ?? sourceHandoffId,
    reassignedToAgentTypeId: input.reassignedToAgentTypeId ?? null,
    notes: input.notes ?? null
  });

  for (const conflictId of conflictIds) {
    const conflict = controlPlane.conflicts.find((candidate) => candidate.id === conflictId);

    if (conflict) {
      conflict.resolutionDecisionId = decision.id;
    }
  }

  if (input.outcome === "retry") {
    upsertIntervention(controlPlane, {
      id: governanceInterventionId(entity.entityKind, entity.entityId, "retry"),
      kind: "retry",
      entityKind: entity.entityKind,
      entityId: entity.entityId,
      summary: input.summary,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID
    });
    return;
  }

  if (input.outcome === "accept") {
    resolveConflicts(controlPlane, entity.entityKind, entity.entityId);
    resolveInterventions(controlPlane, entity.entityKind, entity.entityId);
    resolveBlockers(controlPlane, entity.entityKind, entity.entityId);
    return;
  }

  upsertIntervention(controlPlane, {
    id: governanceInterventionId(entity.entityKind, entity.entityId, input.outcome),
    kind: "manual_review",
    entityKind: entity.entityKind,
    entityId: entity.entityId,
    summary: input.summary,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID
  });
  upsertBlocker(controlPlane, {
    id: governanceBlockerId(entity.entityKind, entity.entityId),
    entityKind: entity.entityKind,
    entityId: entity.entityId,
    summary: input.summary,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID
  });
}

export function recordPhaseStarted(
  controlPlane: ControlPlaneState | null,
  phase: Phase,
  factory?: FactoryRunState | null
) {
  if (!controlPlane) {
    return;
  }

  const node = findPhaseNode(controlPlane, phase.id);

  if (!node) {
    return;
  }

  const phaseContract = findFactoryPhaseContract(factory ?? null, phase.id);
  const { artifactIds, workPacket } = ensurePhaseDelegationArtifacts(
    controlPlane,
    phase,
    phaseContract
  );
  upsertHandoff(controlPlane, {
    id: `handoff:phase:${phase.id}`,
    fromRole: "orchestrator",
    fromId: ORCHESTRATOR_ID,
    toRole: node.ownerRole,
    toId: node.ownerId,
    entityKind: "phase",
    entityId: phase.id,
    correlationId: correlationId("phase", phase.id),
    artifactIds,
    dependencyIds: [],
    acceptanceCriteria: phase.userStories.map((story) => story.title),
    acceptanceTargetIds: phaseContract?.completionCriteria.map((criterion) => criterion.id) ?? [],
    verificationTargetIds:
      phaseContract?.verificationCriteria.map((criterion) => criterion.id) ?? [],
    validationTargets: phase.userStories.flatMap((story) => story.acceptanceCriteria),
    purpose: `Coordinate phase delivery for ${phase.name}.`,
    workPacket,
    status: "accepted"
  });

  for (const story of phase.userStories) {
    prepareStoryDelegation(controlPlane, story, factory ?? null);
  }
}

export function recordStoryStarted(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  factory?: FactoryRunState | null
) {
  if (!controlPlane) {
    return;
  }

  const node = findStoryNode(controlPlane, story.id);

  if (!node) {
    return;
  }

  const delegationBrief = findFactoryDelegationBrief(factory ?? null, "story", story.id);
  const { artifactIds, workPacket } = ensureStoryDelegationArtifacts(
    controlPlane,
    story,
    delegationBrief
  );
  prepareTaskDelegations(controlPlane, story, factory ?? null);
  upsertHandoff(controlPlane, {
    id: `handoff:story:${story.id}`,
    fromRole: "production_lead",
    fromId: PRODUCTION_LEAD_ID,
    toRole: node.ownerRole,
    toId: node.ownerId,
    entityKind: "story",
    entityId: story.id,
    correlationId: correlationId("story", story.id),
    artifactIds,
    dependencyIds: delegationBrief?.dependencyIds ?? [],
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [...story.acceptanceCriteria],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: deriveStoryValidationTargets(story),
    purpose: `Own delivery for story ${story.title}.`,
    workPacket,
    status: "accepted"
  });
}

export function recordTaskStarted(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  task: Task,
  factory?: FactoryRunState | null
) {
  if (!controlPlane) {
    return;
  }

  const storyNode = findStoryNode(controlPlane, story.id);
  const taskNode = findTaskNode(controlPlane, task.id);

  if (!storyNode || !taskNode) {
    return;
  }

  const delegationBrief = findFactoryDelegationBrief(factory ?? null, "task", task.id);
  const { artifactIds, workPacket } = ensureTaskDelegationArtifacts(
    controlPlane,
    story,
    task,
    delegationBrief
  );
  upsertHandoff(controlPlane, {
    id: `handoff:task:${task.id}`,
    fromRole: storyNode.ownerRole,
    fromId: storyNode.ownerId,
    toRole: taskNode.ownerRole,
    toId: taskNode.ownerId,
    entityKind: "task",
    entityId: task.id,
    correlationId: correlationId("task", task.id),
    artifactIds,
    dependencyIds: delegationBrief?.dependencyIds ?? findTaskDependencyIds(story, task.id),
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [task.expectedOutcome],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: delegationBrief?.validationTargets ?? deriveTaskValidationTargets(task),
    purpose: `Execute task ${task.id}.`,
    workPacket,
    status: "accepted"
  });
}

export function recordTaskCompleted(
  controlPlane: ControlPlaneState | null,
  task: Task,
  result: AgentRunResult,
  validationResults: ValidationGateResult[]
) {
  if (!controlPlane) {
    return;
  }

  const taskNode = findTaskNode(controlPlane, task.id);

  if (!taskNode) {
    return;
  }

  completeHandoff(controlPlane, `handoff:task:${task.id}`);
  resolveBlockers(controlPlane, "task", task.id);
  resolveConflicts(controlPlane, "task", task.id);
  upsertArtifact(controlPlane, {
    id: `artifact:task-result:${task.id}`,
    kind: "task_result",
    entityKind: "task",
    entityId: task.id,
    summary: result.summary,
    createdAt: new Date().toISOString(),
    producerRole: taskNode.ownerRole,
    producerId: taskNode.ownerId
  });
  upsertArtifact(controlPlane, {
    id: `artifact:task-validation:${task.id}`,
    kind: "validation_report",
    entityKind: "task",
    entityId: task.id,
    summary: renderValidationSummary(validationResults),
    createdAt: new Date().toISOString(),
    producerRole: "execution_subagent",
    producerId: taskNode.ownerId
  });
  upsertArtifact(controlPlane, {
    id: `artifact:task-summary:${task.id}`,
    kind: "delivery_summary",
    entityKind: "task",
    entityId: task.id,
    summary: result.summary,
    createdAt: new Date().toISOString(),
    producerRole: taskNode.ownerRole,
    producerId: taskNode.ownerId,
    payload: buildDeliverySummaryPayload({
      controlPlane,
      entityKind: "task",
      entityId: task.id,
      headline: result.summary,
      outputs: [task.expectedOutcome, renderValidationSummary(validationResults)],
      links: [],
      followUps:
        task.retryCount > 0
          ? [`Watch for regression because ${task.id} required ${task.retryCount} retries.`]
          : []
    })
  });

  if (task.retryCount > 0) {
    upsertIntervention(controlPlane, {
      id: `intervention:task-retry:${task.id}:${task.retryCount}`,
      kind: "retry",
      entityKind: "task",
      entityId: task.id,
      summary: `Task ${task.id} required ${task.retryCount} retry attempt(s) before completion.`,
      ownerRole: taskNode.ownerRole,
      ownerId: taskNode.ownerId
    });
  }

  resolveInterventions(controlPlane, "task", task.id);
}

export function recordTaskFailed(
  controlPlane: ControlPlaneState | null,
  task: Task,
  failureMessage: string,
  validationResults: ValidationGateResult[] | null
) {
  if (!controlPlane) {
    return;
  }

  const taskNode = findTaskNode(controlPlane, task.id);

  if (!taskNode) {
    return;
  }

  upsertBlocker(controlPlane, {
    id: `blocker:task:${task.id}`,
    entityKind: "task",
    entityId: task.id,
    summary: failureMessage,
    ownerRole: taskNode.ownerRole,
    ownerId: taskNode.ownerId
  });
  upsertArtifact(controlPlane, {
    id: `artifact:task-failure:${task.id}`,
    kind: "failure_report",
    entityKind: "task",
    entityId: task.id,
    summary: failureMessage,
    createdAt: new Date().toISOString(),
    producerRole: taskNode.ownerRole,
    producerId: taskNode.ownerId,
    payload: buildFailureReportPayload({
      controlPlane,
      entityKind: "task",
      entityId: task.id,
      headline: failureMessage,
      validationResults
    })
  });

  if (validationResults && validationResults.length > 0) {
    upsertArtifact(controlPlane, {
      id: `artifact:task-validation:${task.id}`,
      kind: "validation_report",
      entityKind: "task",
      entityId: task.id,
      summary: renderValidationSummary(validationResults),
      createdAt: new Date().toISOString(),
      producerRole: taskNode.ownerRole,
      producerId: taskNode.ownerId
    });
  }
}

export function recordStoryCompleted(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  validationResults: ValidationGateResult[]
) {
  if (!controlPlane) {
    return;
  }

  const storyNode = findStoryNode(controlPlane, story.id);

  if (!storyNode) {
    return;
  }

  completeHandoff(controlPlane, `handoff:story:${story.id}`);
  resolveBlockers(controlPlane, "story", story.id);
  resolveConflicts(controlPlane, "story", story.id);
  resolveInterventions(controlPlane, "story", story.id);
  upsertArtifact(controlPlane, {
    id: `artifact:story-summary:${story.id}`,
    kind: "delivery_summary",
    entityKind: "story",
    entityId: story.id,
    summary: `Story ${story.title} completed.`,
    createdAt: new Date().toISOString(),
    producerRole: storyNode.ownerRole,
    producerId: storyNode.ownerId,
    payload: buildDeliverySummaryPayload({
      controlPlane,
      entityKind: "story",
      entityId: story.id,
      headline: `Story ${story.title} completed.`,
      outputs: [...story.acceptanceCriteria, renderValidationSummary(validationResults)],
      links: [],
      followUps:
        story.retryCount > 0
          ? [`Review retry history for story ${story.id} before shipping adjacent work.`]
          : []
    })
  });
  upsertArtifact(controlPlane, {
    id: `artifact:story-validation:${story.id}`,
    kind: "validation_report",
    entityKind: "story",
    entityId: story.id,
    summary: renderValidationSummary(validationResults),
    createdAt: new Date().toISOString(),
    producerRole: storyNode.ownerRole,
    producerId: storyNode.ownerId
  });
}

export function recordStoryRetry(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  retryCount: number,
  summary: string
) {
  if (!controlPlane) {
    return;
  }

  const storyNode = findStoryNode(controlPlane, story.id);

  if (!storyNode) {
    return;
  }

  upsertIntervention(controlPlane, {
    id: `intervention:story-retry:${story.id}:${retryCount}`,
    kind: "retry",
    entityKind: "story",
    entityId: story.id,
    summary,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID
  });
}

export function recordStoryFailed(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  summary: string,
  validationResults: ValidationGateResult[]
) {
  if (!controlPlane) {
    return;
  }

  const storyNode = findStoryNode(controlPlane, story.id);

  if (!storyNode) {
    return;
  }

  upsertBlocker(controlPlane, {
    id: `blocker:story:${story.id}`,
    entityKind: "story",
    entityId: story.id,
    summary,
    ownerRole: storyNode.ownerRole,
    ownerId: storyNode.ownerId
  });
  upsertIntervention(controlPlane, {
    id: `intervention:story-manual-review:${story.id}`,
    kind: "manual_review",
    entityKind: "story",
    entityId: story.id,
    summary,
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID
  });
  upsertArtifact(controlPlane, {
    id: `artifact:story-failure:${story.id}`,
    kind: "failure_report",
    entityKind: "story",
    entityId: story.id,
    summary,
    createdAt: new Date().toISOString(),
    producerRole: storyNode.ownerRole,
    producerId: storyNode.ownerId,
    payload: buildFailureReportPayload({
      controlPlane,
      entityKind: "story",
      entityId: story.id,
      headline: summary,
      validationResults
    })
  });
  upsertArtifact(controlPlane, {
    id: `artifact:story-validation:${story.id}`,
    kind: "validation_report",
    entityKind: "story",
    entityId: story.id,
    summary: renderValidationSummary(validationResults),
    createdAt: new Date().toISOString(),
    producerRole: storyNode.ownerRole,
    producerId: storyNode.ownerId
  });
}

export function recordPhaseCompleted(
  controlPlane: ControlPlaneState | null,
  phase: Phase,
  validationResults: ValidationGateResult[]
) {
  if (!controlPlane) {
    return;
  }

  const phaseNode = findPhaseNode(controlPlane, phase.id);

  if (!phaseNode) {
    return;
  }

  completeHandoff(controlPlane, `handoff:phase:${phase.id}`);
  resolveBlockers(controlPlane, "phase", phase.id);
  resolveConflicts(controlPlane, "phase", phase.id);
  resolveInterventions(controlPlane, "phase", phase.id);
  upsertArtifact(controlPlane, {
    id: `artifact:phase-summary:${phase.id}`,
    kind: "delivery_summary",
    entityKind: "phase",
    entityId: phase.id,
    summary: `Phase ${phase.name} completed.`,
    createdAt: new Date().toISOString(),
    producerRole: phaseNode.ownerRole,
    producerId: phaseNode.ownerId,
    payload: buildDeliverySummaryPayload({
      controlPlane,
      entityKind: "phase",
      entityId: phase.id,
      headline: `Phase ${phase.name} completed.`,
      outputs: [phase.description, renderValidationSummary(validationResults)],
      links: [],
      followUps: []
    })
  });
  upsertArtifact(controlPlane, {
    id: `artifact:phase-validation:${phase.id}`,
    kind: "validation_report",
    entityKind: "phase",
    entityId: phase.id,
    summary: renderValidationSummary(validationResults),
    createdAt: new Date().toISOString(),
    producerRole: phaseNode.ownerRole,
    producerId: phaseNode.ownerId
  });
}

export function recordPhaseFailed(
  controlPlane: ControlPlaneState | null,
  phase: Phase,
  summary: string,
  validationResults: ValidationGateResult[]
) {
  if (!controlPlane) {
    return;
  }

  const phaseNode = findPhaseNode(controlPlane, phase.id);

  if (!phaseNode) {
    return;
  }

  upsertBlocker(controlPlane, {
    id: `blocker:phase:${phase.id}`,
    entityKind: "phase",
    entityId: phase.id,
    summary,
    ownerRole: phaseNode.ownerRole,
    ownerId: phaseNode.ownerId
  });
  upsertIntervention(controlPlane, {
    id: `intervention:phase-manual-review:${phase.id}`,
    kind: "manual_review",
    entityKind: "phase",
    entityId: phase.id,
    summary,
    ownerRole: "orchestrator",
    ownerId: ORCHESTRATOR_ID
  });
  upsertArtifact(controlPlane, {
    id: `artifact:phase-failure:${phase.id}`,
    kind: "failure_report",
    entityKind: "phase",
    entityId: phase.id,
    summary,
    createdAt: new Date().toISOString(),
    producerRole: phaseNode.ownerRole,
    producerId: phaseNode.ownerId,
    payload: buildFailureReportPayload({
      controlPlane,
      entityKind: "phase",
      entityId: phase.id,
      headline: summary,
      validationResults
    })
  });
  upsertArtifact(controlPlane, {
    id: `artifact:phase-validation:${phase.id}`,
    kind: "validation_report",
    entityKind: "phase",
    entityId: phase.id,
    summary: renderValidationSummary(validationResults),
    createdAt: new Date().toISOString(),
    producerRole: phaseNode.ownerRole,
    producerId: phaseNode.ownerId
  });
}

function buildDeliverySummaryPayload(input: {
  controlPlane: ControlPlaneState;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  headline: string;
  outputs: string[];
  links: ControlPlaneDeliverySummaryLink[];
  followUps: string[];
}): ControlPlaneDeliverySummaryArtifactPayload {
  return {
    kind: "delivery_summary",
    version: 1,
    headline: input.headline,
    outputs: uniqueStrings(input.outputs.filter((value) => value.trim().length > 0)).slice(0, 6),
    links: dedupeDeliveryLinks(input.links).slice(0, 6),
    risks: collectEntityRisks(input.controlPlane, input.entityKind, input.entityId),
    followUps: uniqueStrings(input.followUps.filter((value) => value.trim().length > 0)).slice(0, 6)
  };
}

function buildFailureReportPayload(input: {
  controlPlane: ControlPlaneState;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  headline: string;
  validationResults: ValidationGateResult[] | null | undefined;
}): ControlPlaneFailureReportArtifactPayload {
  return {
    kind: "failure_report",
    version: 1,
    headline: input.headline,
    risks: collectEntityRisks(input.controlPlane, input.entityKind, input.entityId),
    followUps: collectEntityFollowUps(input.controlPlane, input.entityKind, input.entityId),
    validationFailures: (input.validationResults ?? [])
      .filter((result) => !result.success)
      .map((result) => result.message)
      .slice(0, 6)
  };
}

function collectEntityRisks(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  return uniqueStrings(
    [
      ...controlPlane.blockers
        .filter(
          (blocker) =>
            blocker.entityKind === entityKind &&
            blocker.entityId === entityId &&
            blocker.status === "open"
        )
        .map((blocker) => blocker.summary),
      ...controlPlane.conflicts
        .filter(
          (conflict) =>
            conflict.entityKind === entityKind &&
            conflict.entityId === entityId &&
            conflict.status === "open"
        )
        .map((conflict) => conflict.summary)
    ].filter((value) => value.trim().length > 0)
  ).slice(0, 6);
}

function collectEntityFollowUps(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  return uniqueStrings(
    controlPlane.interventions
      .filter(
        (intervention) =>
          intervention.entityKind === entityKind &&
          intervention.entityId === entityId &&
          intervention.resolvedAt === null
      )
      .map((intervention) => intervention.summary)
      .filter((value) => value.trim().length > 0)
  ).slice(0, 6);
}

function dedupeDeliveryLinks(links: ControlPlaneDeliverySummaryLink[]) {
  const seen = new Set<string>();

  return links.filter((link) => {
    const key = `${link.kind}:${link.url}`;

    if (!link.url.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildAgents(
  phaseExecution: PhaseExecutionState,
  specialistAgentRegistry = createSpecialistAgentRegistry()
): ControlPlaneAgent[] {
  const agents: ControlPlaneAgent[] = [
    {
      id: ORCHESTRATOR_ID,
      role: "orchestrator",
      label: "Orchestrator",
      status: "active",
      assignedEntityIds: ["run"],
      agentTypeId: null,
      skillIds: [],
      allowedToolNames: [],
      allowedHandoffTargets: ["production_lead"],
      specialtyTags: ["coordination", "planning"],
      parentAgentId: null
    },
    {
      id: PRODUCTION_LEAD_ID,
      role: "production_lead",
      label: "Production Lead",
      status: "assigned",
      assignedEntityIds: phaseExecution.phases.map((phase) => phase.id),
      agentTypeId: "production_lead",
      skillIds: ["production_lead"],
      allowedToolNames: [],
      allowedHandoffTargets: ["specialist_dev"],
      specialtyTags: ["routing", "delivery", "validation"],
      parentAgentId: null
    }
  ];

  for (const phase of phaseExecution.phases) {
    for (const story of phase.userStories) {
      const specialistDefinition = resolveStoryDefinition(story, null, specialistAgentRegistry);
      agents.push({
        id: storyOwnerId(specialistDefinition.agentTypeId, story.id),
        role: "specialist_dev",
        label: `${specialistDefinition.label} (${story.title})`,
        status: "assigned",
        assignedEntityIds: [story.id],
        agentTypeId: specialistDefinition.agentTypeId,
        skillIds: specialistDefinition.skillRefs.map((skillRef) => skillRef.id),
        allowedToolNames: [...specialistDefinition.toolScope.allowedToolNames],
        allowedHandoffTargets: [...specialistDefinition.allowedHandoffTargets],
        specialtyTags: [...specialistDefinition.domainTags],
        parentAgentId: PRODUCTION_LEAD_ID
      });

      for (const task of story.tasks) {
        const taskDefinition = resolveStoryDefinition(story, task, specialistAgentRegistry);
        agents.push({
          id: taskOwnerId(taskDefinition.agentTypeId, task.id),
          role: "execution_subagent",
          label: `Execution Subagent (${task.id})`,
          status: "available",
          assignedEntityIds: [task.id],
          agentTypeId: "execution_subagent",
          skillIds: uniqueSkillIds(["execution_subagent", ...taskDefinition.skillRefs.map((skillRef) => skillRef.id)]),
          allowedToolNames: task.allowedToolNames
            ? [...task.allowedToolNames]
            : [...taskDefinition.toolScope.allowedToolNames],
          allowedHandoffTargets: ["specialist_dev"],
          specialtyTags: [...taskDefinition.domainTags],
          parentAgentId: storyOwnerId(taskDefinition.agentTypeId, story.id)
        });
      }
    }
  }

  return agents;
}

function buildApprovalGates(phaseExecution: PhaseExecutionState): ControlPlaneApprovalGate[] {
  return phaseExecution.phases.flatMap((phase) =>
    phase.approvalGate
      ? [
          {
            id: phase.approvalGate.id,
            kind: phase.approvalGate.kind,
            phaseId: phase.id,
            phaseName: phase.name,
            title: phase.approvalGate.title,
            instructions: phase.approvalGate.instructions,
            status: phase.approvalGate.status,
            waitingAt: phase.approvalGate.waitingAt,
            resolvedAt: phase.approvalGate.resolvedAt,
            ownerRole: "production_lead" as const,
            ownerId: PRODUCTION_LEAD_ID,
            ownerAgentTypeId: "production_lead" as const,
            decisions: phase.approvalGate.decisions.map((decision) => ({ ...decision }))
          }
        ]
      : []
  );
}

function ensurePhaseDelegationArtifacts(
  controlPlane: ControlPlaneState,
  phase: Phase,
  phaseContract?: ReturnType<typeof findFactoryPhaseContract> | null
) {
  const requirementsArtifactId = `artifact:phase-requirements:${phase.id}`;
  const delegationArtifactId = `artifact:phase-delegation:${phase.id}`;
  const requirementsPayload = buildPhaseRequirementsPayload(
    phase,
    controlPlane.specialistAgentRegistry
  );
  const delegationPayload = buildPhaseDelegationBriefPayload(phase, phaseContract ?? null);
  const artifactIds = [requirementsArtifactId, delegationArtifactId];

  upsertArtifact(controlPlane, {
    id: requirementsArtifactId,
    kind: "requirements",
    entityKind: "phase",
    entityId: phase.id,
    summary: renderPhaseRequirementsSummary(phase),
    createdAt: new Date().toISOString(),
    producerRole: "orchestrator",
    producerId: ORCHESTRATOR_ID,
    payload: requirementsPayload
  });
  upsertArtifact(controlPlane, {
    id: delegationArtifactId,
    kind: "delegation_brief",
    entityKind: "phase",
    entityId: phase.id,
    summary: renderPhaseDelegationSummary(phase),
    createdAt: new Date().toISOString(),
    producerRole: "orchestrator",
    producerId: ORCHESTRATOR_ID,
    payload: delegationPayload
  });

  return {
    artifactIds,
    workPacket: buildPhaseWorkPacket(phase, requirementsPayload, artifactIds, phaseContract ?? null)
  };
}

function ensureStoryDelegationArtifacts(
  controlPlane: ControlPlaneState,
  story: UserStory,
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
) {
  const architectureArtifactId = `artifact:story-architecture:${story.id}`;
  const breakdownArtifactId = `artifact:story-breakdown:${story.id}`;
  const delegationArtifactId = `artifact:story-delegation:${story.id}`;
  const architecturePayload = buildStoryArchitectureDecisionPayload(
    story,
    controlPlane.specialistAgentRegistry
  );
  const breakdownPayload = buildStorySubtaskBreakdownPayload(
    story,
    controlPlane.specialistAgentRegistry
  );
  const delegationPayload = buildStoryDelegationBriefPayload(story, delegationBrief ?? null);
  const artifactIds = [architectureArtifactId, breakdownArtifactId, delegationArtifactId];

  upsertArtifact(controlPlane, {
    id: architectureArtifactId,
    kind: "architecture_decision",
    entityKind: "story",
    entityId: story.id,
    summary: renderStoryArchitectureDecisionSummary(story, architecturePayload),
    createdAt: new Date().toISOString(),
    producerRole: "orchestrator",
    producerId: ORCHESTRATOR_ID,
    payload: architecturePayload
  });
  upsertArtifact(controlPlane, {
    id: breakdownArtifactId,
    kind: "subtask_breakdown",
    entityKind: "story",
    entityId: story.id,
    summary: renderStorySubtaskBreakdownSummary(story),
    createdAt: new Date().toISOString(),
    producerRole: "orchestrator",
    producerId: ORCHESTRATOR_ID,
    payload: breakdownPayload
  });
  upsertArtifact(controlPlane, {
    id: delegationArtifactId,
    kind: "delegation_brief",
    entityKind: "story",
    entityId: story.id,
    summary: renderStoryDelegationSummary(story),
    createdAt: new Date().toISOString(),
    producerRole: "production_lead",
    producerId: PRODUCTION_LEAD_ID,
    payload: delegationPayload
  });

  return {
    artifactIds,
    workPacket: buildStoryWorkPacket(
      story,
      architecturePayload,
      breakdownPayload,
      artifactIds,
      delegationBrief ?? null
    )
  };
}

function ensureTaskDelegationArtifacts(
  controlPlane: ControlPlaneState,
  story: UserStory,
  task: Task,
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
) {
  const storyBreakdownArtifactId = `artifact:story-breakdown:${story.id}`;
  const delegationArtifactId = `artifact:task-delegation:${task.id}`;
  const taskDefinition = resolveStoryDefinition(story, task, controlPlane.specialistAgentRegistry);
  const delegationPayload = buildTaskDelegationBriefPayload(story, task, delegationBrief ?? null);
  const artifactIds = [storyBreakdownArtifactId, delegationArtifactId];

  // Keep the story breakdown artifact fresh so task routing always points at the latest
  // deterministic decomposition contract.
  ensureStoryDelegationArtifacts(controlPlane, story);
  upsertArtifact(controlPlane, {
    id: delegationArtifactId,
    kind: "delegation_brief",
    entityKind: "task",
    entityId: task.id,
    summary: renderTaskDelegationSummary(story, task),
    createdAt: new Date().toISOString(),
    producerRole: "specialist_dev",
    producerId: storyOwnerId(taskDefinition.agentTypeId, story.id),
    payload: delegationPayload
  });

  return {
    artifactIds,
    workPacket: buildTaskWorkPacket(
      story,
      task,
      taskDefinition.agentTypeId,
      artifactIds,
      delegationBrief ?? null
    )
  };
}

function buildPlanArtifactPayload(phaseExecution: PhaseExecutionState): ControlPlanePlanArtifactPayload {
  return {
    kind: "plan",
    version: 1,
    phaseIds: phaseExecution.phases.map((phase) => phase.id),
    storyIds: phaseExecution.phases.flatMap((phase) => phase.userStories.map((story) => story.id)),
    taskIds: phaseExecution.phases.flatMap((phase) =>
      phase.userStories.flatMap((story) => story.tasks.map((task) => task.id))
    ),
    validationTargets: uniqueStrings(
      phaseExecution.phases.flatMap((phase) =>
        phase.userStories.flatMap((story) => deriveStoryValidationTargets(story))
      )
    )
  };
}

function buildPhaseRequirementsPayload(
  phase: Phase,
  registry = createSpecialistAgentRegistry()
): ControlPlaneRequirementsArtifactPayload {
  return {
    kind: "requirements",
    version: 1,
    scopeSummary: phase.description,
    constraints: derivePhaseConstraints(phase),
    fileTargets: derivePhaseFileTargets(phase),
    domainTargets: derivePhaseDomainTargets(phase, registry),
    validationTargets: uniqueStrings(
      phase.userStories.flatMap((story) => deriveStoryValidationTargets(story))
    ),
    storyIds: phase.userStories.map((story) => story.id),
    taskIds: derivePhaseTaskIds(phase),
    approvalGateKind: phase.approvalGate?.kind ?? null
  };
}

function buildStoryArchitectureDecisionPayload(
  story: UserStory,
  registry = createSpecialistAgentRegistry()
): ControlPlaneArchitectureDecisionArtifactPayload {
  const routingDecision = resolveStoryRoutingDecision(story, registry);

  return {
    kind: "architecture_decision",
    version: 1,
    storyId: story.id,
    selectedSpecialistAgentTypeId: routingDecision.definition.agentTypeId,
    decisionSource: routingDecision.decisionSource,
    rationale: routingDecision.rationale,
    domainTargets: [...routingDecision.definition.domainTags],
    fileTargets: deriveStoryFileTargets(story),
    allowedToolNames: uniqueStrings(
      story.tasks.flatMap((task) => deriveAllowedToolNames(task))
    ) as ControlPlaneArchitectureDecisionArtifactPayload["allowedToolNames"],
    validationTargets: deriveStoryValidationTargets(story),
    taskIds: story.tasks.map((task) => task.id)
  };
}

function buildStorySubtaskBreakdownPayload(
  story: UserStory,
  registry = createSpecialistAgentRegistry()
): ControlPlaneSubtaskBreakdownArtifactPayload {
  const tasks: ControlPlaneDecomposedTask[] = story.tasks.map((task) => {
    const definition = resolveStoryDefinition(story, task, registry);

    return {
      taskId: task.id,
      instruction: task.instruction,
      expectedOutcome: task.expectedOutcome,
      dependencyIds: findTaskDependencyIds(story, task.id),
      specialistAgentTypeId: definition.agentTypeId,
      allowedToolNames: deriveAllowedToolNames(task),
      validationTargets: deriveTaskValidationTargets(task),
      relevantFiles: deriveTaskFileTargets(task),
      constraints: deriveTaskConstraints(task)
    };
  });

  return {
    kind: "subtask_breakdown",
    version: 1,
    storyId: story.id,
    dependencyStrategy: "sequential",
    tasks
  };
}

function buildPhaseDelegationBriefPayload(
  phase: Phase,
  phaseContract?: ReturnType<typeof findFactoryPhaseContract> | null
): ControlPlaneDelegationBriefArtifactPayload {
  return {
    kind: "delegation_brief",
    version: 1,
    scopeSummary: phase.description,
    acceptanceCriteria: phase.userStories.map((story) => story.title),
    acceptanceTargetIds: phaseContract?.completionCriteria.map((criterion) => criterion.id) ?? [],
    verificationTargetIds:
      phaseContract?.verificationCriteria.map((criterion) => criterion.id) ?? [],
    validationTargets: uniqueStrings(
      phase.userStories.flatMap((story) => deriveStoryValidationTargets(story))
    ),
    dependencyIds: [],
    backlogItemIds: [],
    delegationPath: "orchestrator_to_production_lead",
    specialistAgentTypeId: null
  };
}

function buildStoryDelegationBriefPayload(
  story: UserStory,
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
): ControlPlaneDelegationBriefArtifactPayload {
  return {
    kind: "delegation_brief",
    version: 1,
    scopeSummary: delegationBrief?.scopeSummary ?? story.description,
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [...story.acceptanceCriteria],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: delegationBrief?.validationTargets ?? deriveStoryValidationTargets(story),
    dependencyIds: delegationBrief?.dependencyIds ?? [],
    backlogItemIds: delegationBrief?.backlogItemIds ?? [],
    delegationPath: delegationBrief?.delegationPath ?? "production_lead_to_specialist",
    specialistAgentTypeId: delegationBrief?.specialistAgentTypeId ?? null
  };
}

function buildTaskDelegationBriefPayload(
  story: UserStory,
  task: Task,
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
): ControlPlaneDelegationBriefArtifactPayload {
  return {
    kind: "delegation_brief",
    version: 1,
    scopeSummary: delegationBrief?.scopeSummary ?? `Execute ${task.id} for ${story.title}.`,
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [task.expectedOutcome],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: delegationBrief?.validationTargets ?? deriveTaskValidationTargets(task),
    dependencyIds: delegationBrief?.dependencyIds ?? findTaskDependencyIds(story, task.id),
    backlogItemIds: delegationBrief?.backlogItemIds ?? [],
    delegationPath: delegationBrief?.delegationPath ?? "specialist_to_execution",
    specialistAgentTypeId: delegationBrief?.specialistAgentTypeId ?? null
  };
}

function buildPhaseWorkPacket(
  phase: Phase,
  requirements: ControlPlaneRequirementsArtifactPayload,
  sourceArtifactIds: string[],
  phaseContract?: ReturnType<typeof findFactoryPhaseContract> | null
): ControlPlaneWorkPacket {
  return {
    version: 1,
    sourceArtifactIds: [...sourceArtifactIds],
    scopeSummary: requirements.scopeSummary,
    constraints: [...requirements.constraints],
    fileTargets: [...requirements.fileTargets],
    domainTargets: [...requirements.domainTargets],
    acceptanceCriteria: phase.userStories.map((story) => story.title),
    acceptanceTargetIds: phaseContract?.completionCriteria.map((criterion) => criterion.id) ?? [],
    verificationTargetIds:
      phaseContract?.verificationCriteria.map((criterion) => criterion.id) ?? [],
    validationTargets: [...requirements.validationTargets],
    dependencyIds: [],
    taskIds: [...requirements.taskIds],
    ownerAgentTypeId: "production_lead"
  };
}

function buildStoryWorkPacket(
  story: UserStory,
  architecture: ControlPlaneArchitectureDecisionArtifactPayload,
  breakdown: ControlPlaneSubtaskBreakdownArtifactPayload,
  sourceArtifactIds: string[],
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
): ControlPlaneWorkPacket {
  return {
    version: 1,
    sourceArtifactIds: [...sourceArtifactIds],
    scopeSummary: delegationBrief?.scopeSummary ?? story.description,
    constraints: deriveStoryConstraints(story),
    fileTargets: [...architecture.fileTargets],
    domainTargets: [...architecture.domainTargets],
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [...story.acceptanceCriteria],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: delegationBrief?.validationTargets ?? deriveStoryValidationTargets(story),
    dependencyIds: delegationBrief?.dependencyIds ?? [],
    taskIds: breakdown.tasks.map((task) => task.taskId),
    ownerAgentTypeId: architecture.selectedSpecialistAgentTypeId
  };
}

function buildTaskWorkPacket(
  story: UserStory,
  task: Task,
  ownerAgentTypeId: SpecialistAgentTypeId,
  sourceArtifactIds: string[],
  delegationBrief?: ReturnType<typeof findFactoryDelegationBrief> | null
): ControlPlaneWorkPacket {
  return {
    version: 1,
    sourceArtifactIds: [...sourceArtifactIds],
    scopeSummary: delegationBrief?.scopeSummary ?? task.instruction,
    constraints: deriveTaskConstraints(task),
    fileTargets: deriveTaskFileTargets(task),
    domainTargets: deriveTaskDomainTargets(story, task),
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [task.expectedOutcome],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: delegationBrief?.validationTargets ?? deriveTaskValidationTargets(task),
    dependencyIds: delegationBrief?.dependencyIds ?? findTaskDependencyIds(story, task.id),
    taskIds: [task.id],
    ownerAgentTypeId
  };
}

function prepareStoryDelegation(
  controlPlane: ControlPlaneState,
  story: UserStory,
  factory?: FactoryRunState | null
) {
  const storyNode = findStoryNode(controlPlane, story.id);

  if (!storyNode) {
    return;
  }

  const delegationBrief = findFactoryDelegationBrief(factory ?? null, "story", story.id);
  const { artifactIds, workPacket } = ensureStoryDelegationArtifacts(
    controlPlane,
    story,
    delegationBrief
  );
  const existing = findHandoff(controlPlane, `handoff:story:${story.id}`);
  upsertHandoff(controlPlane, {
    id: `handoff:story:${story.id}`,
    fromRole: "production_lead",
    fromId: PRODUCTION_LEAD_ID,
    toRole: storyNode.ownerRole,
    toId: storyNode.ownerId,
    entityKind: "story",
    entityId: story.id,
    correlationId: correlationId("story", story.id),
    artifactIds,
    dependencyIds: delegationBrief?.dependencyIds ?? [],
    acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [...story.acceptanceCriteria],
    acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
    verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
    validationTargets: deriveStoryValidationTargets(story),
    purpose: `Own delivery for story ${story.title}.`,
    workPacket,
    status: existing?.status ?? "created"
  });
}

function prepareTaskDelegations(
  controlPlane: ControlPlaneState,
  story: UserStory,
  factory?: FactoryRunState | null
) {
  const storyNode = findStoryNode(controlPlane, story.id);

  if (!storyNode) {
    return;
  }

  for (const task of story.tasks) {
    const taskNode = findTaskNode(controlPlane, task.id);

    if (!taskNode) {
      continue;
    }

    const delegationBrief = findFactoryDelegationBrief(factory ?? null, "task", task.id);
    const { artifactIds, workPacket } = ensureTaskDelegationArtifacts(
      controlPlane,
      story,
      task,
      delegationBrief
    );
    const existing = findHandoff(controlPlane, `handoff:task:${task.id}`);
    upsertHandoff(controlPlane, {
      id: `handoff:task:${task.id}`,
      fromRole: storyNode.ownerRole,
      fromId: storyNode.ownerId,
      toRole: taskNode.ownerRole,
      toId: taskNode.ownerId,
      entityKind: "task",
      entityId: task.id,
      correlationId: correlationId("task", task.id),
      artifactIds,
      dependencyIds: delegationBrief?.dependencyIds ?? findTaskDependencyIds(story, task.id),
      acceptanceCriteria: delegationBrief?.acceptanceCriteria ?? [task.expectedOutcome],
      acceptanceTargetIds: delegationBrief?.acceptanceTargetIds ?? [],
      verificationTargetIds: delegationBrief?.verificationTargetIds ?? [],
      validationTargets: deriveTaskValidationTargets(task),
      purpose: `Execute task ${task.id}.`,
      workPacket,
      status: existing?.status ?? "created"
    });
  }
}

function createPhaseNode(
  phase: Phase,
  updatedAt: string,
  specialistAgentRegistry = createSpecialistAgentRegistry()
): ControlPlanePhaseNode {
  return {
    id: phase.id,
    name: phase.name,
    description: phase.description,
    status: mapStatus(phase.status),
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID,
    ownerAgentTypeId: "production_lead",
    failureReason: phase.failureReason,
    validation: createValidationState(phase.lastValidationResults, updatedAt),
    blockerIds: [],
    artifactIds: [],
    handoffIds: [],
    conflictIds: [],
    mergeDecisionIds: [],
    interventionIds: [],
    transitionLog: [],
    userStories: phase.userStories.map((story) =>
      createStoryNode(story, updatedAt, specialistAgentRegistry)
    )
  };
}

function createStoryNode(
  story: UserStory,
  updatedAt: string,
  specialistAgentRegistry = createSpecialistAgentRegistry()
): ControlPlaneStoryNode {
  const specialistDefinition = resolveStoryDefinition(story, null, specialistAgentRegistry);
  return {
    id: story.id,
    title: story.title,
    description: story.description,
    acceptanceCriteria: [...story.acceptanceCriteria],
    status: mapStatus(story.status),
    ownerRole: "specialist_dev",
    ownerId: storyOwnerId(specialistDefinition.agentTypeId, story.id),
    ownerAgentTypeId: specialistDefinition.agentTypeId,
    retryCount: story.retryCount,
    failureReason: story.failureReason,
    validation: createValidationState(story.lastValidationResults, updatedAt),
    blockerIds: [],
    artifactIds: [],
    handoffIds: [],
    conflictIds: [],
    mergeDecisionIds: [],
    interventionIds: [],
    transitionLog: [],
    tasks: story.tasks.map((task) => createTaskNode(story, task, updatedAt, specialistAgentRegistry))
  };
}

function createTaskNode(
  story: UserStory,
  task: Task,
  updatedAt: string,
  specialistAgentRegistry = createSpecialistAgentRegistry()
): ControlPlaneTaskNode {
  const specialistDefinition = resolveStoryDefinition(story, task, specialistAgentRegistry);
  return {
    id: task.id,
    title: task.id,
    instruction: task.instruction,
    expectedOutcome: task.expectedOutcome,
    status: mapStatus(task.status),
    ownerRole: "execution_subagent",
    ownerId: taskOwnerId(specialistDefinition.agentTypeId, task.id),
    ownerAgentTypeId: "execution_subagent",
    retryCount: task.retryCount,
    failureReason: task.failureReason,
    validation: createValidationState(task.lastValidationResults, updatedAt),
    blockerIds: [],
    artifactIds: [],
    handoffIds: [],
    conflictIds: [],
    mergeDecisionIds: [],
    interventionIds: [],
    transitionLog: []
  };
}

function ensureNodes(
  controlPlane: ControlPlaneState,
  phaseExecution: PhaseExecutionState,
  updatedAt: string
) {
  for (const phase of phaseExecution.phases) {
    if (!findPhaseNode(controlPlane, phase.id)) {
      controlPlane.phases.push(
        createPhaseNode(phase, updatedAt, controlPlane.specialistAgentRegistry)
      );
    }

    const phaseNode = findPhaseNode(controlPlane, phase.id);

    if (!phaseNode) {
      continue;
    }

    for (const story of phase.userStories) {
      if (!phaseNode.userStories.some((candidate) => candidate.id === story.id)) {
        phaseNode.userStories.push(
          createStoryNode(story, updatedAt, controlPlane.specialistAgentRegistry)
        );
      }

      const storyNode = phaseNode.userStories.find((candidate) => candidate.id === story.id);

      if (!storyNode) {
        continue;
      }

      for (const task of story.tasks) {
        if (!storyNode.tasks.some((candidate) => candidate.id === task.id)) {
          storyNode.tasks.push(
            createTaskNode(story, task, updatedAt, controlPlane.specialistAgentRegistry)
          );
        }
      }
    }
  }
}

function syncNodeState(input: {
  node: {
    status: ControlPlaneEntityStatus;
    failureReason: string | null;
    validation: ControlPlaneValidationState;
    transitionLog: ControlPlaneTransition[];
  };
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  nextStatus: ControlPlaneEntityStatus;
  nextFailureReason: string | null;
  nextValidationResults: ValidationGateResult[] | null;
  updatedAt: string;
}) {
  if (input.node.status !== input.nextStatus) {
    assertAllowedTransition(
      input.node.status,
      input.nextStatus,
      `${input.entityKind}:${input.entityId}`
    );
    input.node.transitionLog.push({
      entityKind: input.entityKind,
      entityId: input.entityId,
      fromStatus: input.node.status,
      toStatus: input.nextStatus,
      at: input.updatedAt,
      reason: transitionReason(input.nextStatus, input.nextFailureReason)
    });
    input.node.status = input.nextStatus;
  }

  input.node.failureReason = input.nextFailureReason;
  input.node.validation = mergeValidationState(
    input.node.validation,
    input.nextValidationResults,
    input.updatedAt
  );
}

function assertAllowedTransition(
  current: ControlPlaneEntityStatus,
  next: ControlPlaneEntityStatus,
  entityLabel: string
) {
  if (current === next) {
    return;
  }

  if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
    throw new Error(`Unsupported control-plane transition for ${entityLabel}: ${current} -> ${next}`);
  }
}

function transitionReason(status: ControlPlaneEntityStatus, failureReason: string | null) {
  switch (status) {
    case "pending":
      return "Entity reset to pending for another attempt.";
    case "in_progress":
      return "Entity entered active execution.";
    case "completed":
      return "Entity completed successfully.";
    case "failed":
      return failureReason || "Entity failed during execution.";
    case "blocked":
      return failureReason || "Entity is blocked.";
  }
}

function createValidationState(
  results: ValidationGateResult[] | null | undefined,
  updatedAt: string
): ControlPlaneValidationState {
  if (!results || results.length === 0) {
    return {
      status: "not_run",
      lastResults: null,
      updatedAt: null
    };
  }

  return {
    status: results.every((gate) => gate.success) ? "passed" : "failed",
    lastResults: results.map((gate) => ({ ...gate })),
    updatedAt
  };
}

function mergeValidationState(
  current: ControlPlaneValidationState,
  results: ValidationGateResult[] | null | undefined,
  updatedAt: string
) {
  const next = createValidationState(results, updatedAt);

  if (
    current.status === next.status &&
    JSON.stringify(current.lastResults) === JSON.stringify(next.lastResults)
  ) {
    return current;
  }

  return next;
}

function mapStatus(
  status: PhaseExecutionState["status"] | Phase["status"] | UserStory["status"] | Task["status"]
): ControlPlaneEntityStatus {
  if (status === "running") {
    return "in_progress";
  }

  return status === "pending" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "completed" ||
    status === "failed"
    ? status
    : "pending";
}

function upsertArtifact(
  controlPlane: ControlPlaneState,
  artifact: Omit<ControlPlaneArtifact, "producerAgentTypeId" | "payload"> & {
    producerAgentTypeId?: TeamSkillId | null;
    payload?: ControlPlaneArtifact["payload"];
  }
) {
  const existing = controlPlane.artifacts.find((candidate) => candidate.id === artifact.id);
  const producerAgentTypeId =
    artifact.producerAgentTypeId ?? resolveAgentTypeId(controlPlane, artifact.producerId);
  const normalizedArtifact: ControlPlaneArtifact = {
    ...artifact,
    producerAgentTypeId,
    path: artifact.path ?? null,
    payload: artifact.payload ?? null
  };

  if (existing) {
    existing.summary = normalizedArtifact.summary;
    existing.createdAt = normalizedArtifact.createdAt;
    existing.producerAgentTypeId = producerAgentTypeId;
    existing.path = normalizedArtifact.path;
    existing.payload = normalizedArtifact.payload;
  } else {
    controlPlane.artifacts.push(normalizedArtifact);
  }

  attachEntityId(controlPlane, artifact.entityKind, artifact.entityId, "artifactIds", artifact.id);
  traceControlPlaneArtifact(controlPlane, normalizedArtifact);
}

function upsertHandoff(
  controlPlane: ControlPlaneState,
  handoff: Omit<
    ControlPlaneHandoff,
    | "createdAt"
    | "acceptedAt"
    | "completedAt"
    | "fromAgentTypeId"
    | "toAgentTypeId"
    | "workPacket"
  > & {
    fromAgentTypeId?: TeamSkillId | null;
    toAgentTypeId?: TeamSkillId | null;
    workPacket?: ControlPlaneHandoff["workPacket"];
    status: ControlPlaneHandoff["status"];
  }
) {
  const now = new Date().toISOString();
  const existing = controlPlane.handoffs.find((candidate) => candidate.id === handoff.id);
  const fromAgentTypeId =
    handoff.fromAgentTypeId ?? resolveAgentTypeId(controlPlane, handoff.fromId);
  const toAgentTypeId = handoff.toAgentTypeId ?? resolveAgentTypeId(controlPlane, handoff.toId);
  const normalizedHandoff: ControlPlaneHandoff = {
    ...handoff,
    fromAgentTypeId,
    toAgentTypeId,
    workPacket: handoff.workPacket ?? null,
    createdAt: existing?.createdAt ?? now,
    acceptedAt:
      handoff.status === "created"
        ? null
        : existing?.acceptedAt ?? now,
    completedAt: handoff.status === "completed" ? existing?.completedAt ?? now : existing?.completedAt ?? null
  };

  assertAllowedHandoff(controlPlane, handoff.fromId, handoff.toRole);

  if (existing) {
    existing.fromRole = normalizedHandoff.fromRole;
    existing.fromId = normalizedHandoff.fromId;
    existing.fromAgentTypeId = fromAgentTypeId;
    existing.toRole = normalizedHandoff.toRole;
    existing.toId = normalizedHandoff.toId;
    existing.toAgentTypeId = toAgentTypeId;
    existing.correlationId = normalizedHandoff.correlationId;
    existing.artifactIds = uniqueStrings([...existing.artifactIds, ...normalizedHandoff.artifactIds]);
    existing.dependencyIds = uniqueStrings([
      ...existing.dependencyIds,
      ...normalizedHandoff.dependencyIds
    ]);
    existing.acceptanceCriteria = [...normalizedHandoff.acceptanceCriteria];
    existing.acceptanceTargetIds = [...normalizedHandoff.acceptanceTargetIds];
    existing.verificationTargetIds = [...normalizedHandoff.verificationTargetIds];
    existing.validationTargets = [...normalizedHandoff.validationTargets];
    existing.purpose = normalizedHandoff.purpose;
    existing.workPacket = normalizedHandoff.workPacket;
    existing.status = normalizedHandoff.status;
    existing.acceptedAt = normalizedHandoff.acceptedAt;
    existing.completedAt = normalizedHandoff.completedAt;
  } else {
    controlPlane.handoffs.push(normalizedHandoff);
  }

  attachEntityId(controlPlane, handoff.entityKind, handoff.entityId, "handoffIds", handoff.id);
  traceControlPlaneHandoff(controlPlane, normalizedHandoff);
  detectHandoffScopeConflicts(controlPlane, normalizedHandoff);
}

function upsertConflict(
  controlPlane: ControlPlaneState,
  conflict: Omit<ControlPlaneConflict, "ownerAgentTypeId" | "resolvedAt" | "resolutionDecisionId" | "metadata"> & {
    ownerAgentTypeId?: TeamSkillId | null;
    resolvedAt?: string | null;
    resolutionDecisionId?: string | null;
    metadata?: TraceValue;
  }
) {
  const existing = controlPlane.conflicts.find((candidate) => candidate.id === conflict.id);
  const ownerAgentTypeId =
    conflict.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, conflict.ownerId);
  const normalizedConflict: ControlPlaneConflict = {
    ...conflict,
    ownerAgentTypeId,
    resolvedAt: conflict.resolvedAt ?? null,
    resolutionDecisionId: conflict.resolutionDecisionId ?? existing?.resolutionDecisionId ?? null,
    metadata: conflict.metadata ?? null
  };

  if (existing) {
    existing.kind = normalizedConflict.kind;
    existing.summary = normalizedConflict.summary;
    existing.status = normalizedConflict.status;
    existing.detectedAt = normalizedConflict.detectedAt;
    existing.resolvedAt = normalizedConflict.resolvedAt;
    existing.ownerRole = normalizedConflict.ownerRole;
    existing.ownerId = normalizedConflict.ownerId;
    existing.ownerAgentTypeId = ownerAgentTypeId;
    existing.sourceHandoffId = normalizedConflict.sourceHandoffId;
    existing.relatedHandoffIds = uniqueStrings(normalizedConflict.relatedHandoffIds);
    existing.conflictingPaths = uniqueStrings(normalizedConflict.conflictingPaths);
    existing.expectedPaths = uniqueStrings(normalizedConflict.expectedPaths);
    existing.conflictingAgentTypeIds = uniqueSkillIds(normalizedConflict.conflictingAgentTypeIds);
    existing.resolutionDecisionId = normalizedConflict.resolutionDecisionId;
    existing.metadata = normalizedConflict.metadata;
  } else {
    controlPlane.conflicts.push({
      ...normalizedConflict,
      relatedHandoffIds: uniqueStrings(normalizedConflict.relatedHandoffIds),
      conflictingPaths: uniqueStrings(normalizedConflict.conflictingPaths),
      expectedPaths: uniqueStrings(normalizedConflict.expectedPaths),
      conflictingAgentTypeIds: uniqueSkillIds(normalizedConflict.conflictingAgentTypeIds)
    });
  }

  attachEntityId(controlPlane, conflict.entityKind, conflict.entityId, "conflictIds", conflict.id);
  const stored = controlPlane.conflicts.find((candidate) => candidate.id === conflict.id)!;
  traceControlPlaneConflict(controlPlane, stored);
  return stored;
}

function upsertMergeDecision(
  controlPlane: ControlPlaneState,
  decision: Omit<ControlPlaneMergeDecision, "decidedAt" | "ownerAgentTypeId"> & {
    ownerAgentTypeId?: TeamSkillId | null;
  }
) {
  const existing = controlPlane.mergeDecisions.find((candidate) => candidate.id === decision.id);
  const ownerAgentTypeId =
    decision.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, decision.ownerId);
  const normalizedDecision: ControlPlaneMergeDecision = {
    ...decision,
    ownerAgentTypeId,
    decidedAt: existing?.decidedAt ?? new Date().toISOString()
  };

  if (existing) {
    existing.conflictIds = uniqueStrings([
      ...existing.conflictIds,
      ...normalizedDecision.conflictIds
    ]);
    existing.outcome = normalizedDecision.outcome;
    existing.summary = normalizedDecision.summary;
    existing.ownerRole = normalizedDecision.ownerRole;
    existing.ownerId = normalizedDecision.ownerId;
    existing.ownerAgentTypeId = ownerAgentTypeId;
    existing.targetHandoffId = normalizedDecision.targetHandoffId;
    existing.reassignedToAgentTypeId = normalizedDecision.reassignedToAgentTypeId;
    existing.notes = normalizedDecision.notes;
  } else {
    controlPlane.mergeDecisions.push({
      ...normalizedDecision,
      conflictIds: uniqueStrings(normalizedDecision.conflictIds)
    });
  }

  attachEntityId(
    controlPlane,
    decision.entityKind,
    decision.entityId,
    "mergeDecisionIds",
    decision.id
  );
  const stored = controlPlane.mergeDecisions.find((candidate) => candidate.id === decision.id)!;
  traceControlPlaneMergeDecision(controlPlane, stored);
  return stored;
}

function traceControlPlaneArtifact(controlPlane: ControlPlaneState, artifact: ControlPlaneArtifact) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("control_plane_artifact_recorded", {
    message: `${artifact.kind} artifact recorded for ${artifact.entityKind} ${artifact.entityId}.`,
    metadata: {
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      entityKind: artifact.entityKind,
      entityId: artifact.entityId,
      producerRole: artifact.producerRole,
      producerId: artifact.producerId,
      producerAgentTypeId: artifact.producerAgentTypeId,
      artifactPath: artifact.path ?? null,
      artifactSummary: artifact.summary,
      artifactPayload: summarizeArtifactPayloadForTrace(artifact.payload),
      controlPlaneStatus: controlPlane.status
    }
  });
}

function traceControlPlaneHandoff(controlPlane: ControlPlaneState, handoff: ControlPlaneHandoff) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("control_plane_handoff_recorded", {
    message: `${handoff.entityKind} handoff ${handoff.fromRole} -> ${handoff.toRole} recorded.`,
    metadata: {
      handoffId: handoff.id,
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      handoffStatus: handoff.status,
      fromRole: handoff.fromRole,
      fromId: handoff.fromId,
      fromAgentTypeId: handoff.fromAgentTypeId,
      toRole: handoff.toRole,
      toId: handoff.toId,
      toAgentTypeId: handoff.toAgentTypeId,
      correlationId: handoff.correlationId,
      purpose: handoff.purpose,
      artifactIds: previewStrings(handoff.artifactIds),
      artifactCount: handoff.artifactIds.length,
      dependencyIds: previewStrings(handoff.dependencyIds),
      dependencyCount: handoff.dependencyIds.length,
      acceptanceCriteria: previewStrings(handoff.acceptanceCriteria),
      acceptanceCriteriaCount: handoff.acceptanceCriteria.length,
      validationTargets: previewStrings(handoff.validationTargets),
      validationTargetCount: handoff.validationTargets.length,
      workPacketOwnerAgentTypeId: handoff.workPacket?.ownerAgentTypeId ?? null,
      workPacket: summarizeWorkPacketForTrace(handoff.workPacket),
      controlPlaneStatus: controlPlane.status
    }
  });
}

function traceControlPlaneConflict(controlPlane: ControlPlaneState, conflict: ControlPlaneConflict) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("control_plane_conflict_recorded", {
    message: `${conflict.kind} conflict recorded for ${conflict.entityKind} ${conflict.entityId}.`,
    metadata: {
      conflictId: conflict.id,
      conflictKind: conflict.kind,
      entityKind: conflict.entityKind,
      entityId: conflict.entityId,
      stepId: conflict.stepId,
      conflictStatus: conflict.status,
      ownerRole: conflict.ownerRole,
      ownerId: conflict.ownerId,
      ownerAgentTypeId: conflict.ownerAgentTypeId,
      sourceHandoffId: conflict.sourceHandoffId,
      relatedHandoffIds: previewStrings(conflict.relatedHandoffIds),
      conflictingPaths: previewStrings(conflict.conflictingPaths),
      expectedPaths: previewStrings(conflict.expectedPaths),
      conflictingAgentTypeIds: previewStrings(conflict.conflictingAgentTypeIds),
      resolutionDecisionId: conflict.resolutionDecisionId,
      conflictMetadata: conflict.metadata,
      controlPlaneStatus: controlPlane.status
    }
  });
}

function traceControlPlaneMergeDecision(
  controlPlane: ControlPlaneState,
  decision: ControlPlaneMergeDecision
) {
  const traceScope = getActiveTraceScope();

  if (!traceScope) {
    return;
  }

  traceScope.activeSpan.addEvent("control_plane_merge_decision_recorded", {
    message: `${decision.outcome} decision recorded for ${decision.entityKind} ${decision.entityId}.`,
    metadata: {
      decisionId: decision.id,
      entityKind: decision.entityKind,
      entityId: decision.entityId,
      mergeOutcome: decision.outcome,
      conflictIds: previewStrings(decision.conflictIds),
      conflictCount: decision.conflictIds.length,
      ownerRole: decision.ownerRole,
      ownerId: decision.ownerId,
      ownerAgentTypeId: decision.ownerAgentTypeId,
      targetHandoffId: decision.targetHandoffId,
      reassignedToAgentTypeId: decision.reassignedToAgentTypeId,
      decisionNotes: decision.notes,
      decisionSummary: decision.summary,
      controlPlaneStatus: controlPlane.status
    }
  });
}

function detectHandoffScopeConflicts(controlPlane: ControlPlaneState, handoff: ControlPlaneHandoff) {
  if (
    handoff.status === "completed" ||
    handoff.workPacket === null ||
    handoff.entityKind === "phase"
  ) {
    return;
  }

  for (const other of controlPlane.handoffs) {
    if (
      other.id === handoff.id ||
      other.status === "completed" ||
      other.workPacket === null ||
      other.entityKind !== handoff.entityKind
    ) {
      continue;
    }

    if (
      handoff.workPacket.ownerAgentTypeId === other.workPacket.ownerAgentTypeId &&
      handoff.toId === other.toId
    ) {
      continue;
    }

    if (sharesDependency(handoff, other)) {
      continue;
    }

    const overlappingPaths = intersection(
      handoff.workPacket.fileTargets,
      other.workPacket.fileTargets
    );
    const overlappingDomains = intersection(
      handoff.workPacket.domainTargets,
      other.workPacket.domainTargets
    );

    if (overlappingPaths.length === 0 && overlappingDomains.length === 0) {
      continue;
    }

    const conflict = upsertConflict(controlPlane, {
      id: scopeConflictId(handoff.id, other.id),
      kind: "scope_overlap",
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      stepId: null,
      summary: `Parallel ${handoff.entityKind} handoffs overlap on ${renderScopeOverlapSummary(
        overlappingPaths,
        overlappingDomains
      )}.`,
      status: "open",
      detectedAt: new Date().toISOString(),
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID,
      sourceHandoffId: handoff.id,
      relatedHandoffIds: [handoff.id, other.id],
      conflictingPaths: overlappingPaths,
      expectedPaths: uniqueStrings([
        ...handoff.workPacket.fileTargets,
        ...other.workPacket.fileTargets
      ]),
      conflictingAgentTypeIds: uniqueSkillIds(
        [
          handoff.workPacket.ownerAgentTypeId,
          other.workPacket.ownerAgentTypeId
        ].filter((value): value is TeamSkillId => value !== null)
      ),
      metadata: {
        overlappingDomains: overlappingDomains,
        leftHandoffId: handoff.id,
        rightHandoffId: other.id
      }
    });
    const preferredAgentTypeId =
      other.status === "accepted"
        ? other.workPacket.ownerAgentTypeId
        : handoff.workPacket.ownerAgentTypeId;
    const decision = upsertMergeDecision(controlPlane, {
      id: `decision:scope-overlap:${sortedPairId(handoff.id, other.id)}`,
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      conflictIds: [conflict.id],
      outcome: "reassign",
      summary: `Production lead should consolidate overlapping ${handoff.entityKind} scope before both handoffs proceed.`,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID,
      targetHandoffId: handoff.id,
      reassignedToAgentTypeId: preferredAgentTypeId ?? null,
      notes:
        preferredAgentTypeId && preferredAgentTypeId !== handoff.workPacket.ownerAgentTypeId
          ? `Prefer ${humanizeSpecialistAgentType(preferredAgentTypeId)} because it already owns the accepted overlapping scope.`
          : null
    });

    conflict.resolutionDecisionId = decision.id;
    upsertIntervention(controlPlane, {
      id: governanceInterventionId(handoff.entityKind, handoff.entityId, "reassign"),
      kind: "manual_review",
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      summary: decision.summary,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID
    });
    upsertBlocker(controlPlane, {
      id: governanceBlockerId(handoff.entityKind, handoff.entityId),
      entityKind: handoff.entityKind,
      entityId: handoff.entityId,
      summary: decision.summary,
      ownerRole: "production_lead",
      ownerId: PRODUCTION_LEAD_ID
    });
  }
}

function summarizeArtifactPayloadForTrace(payload: ControlPlaneArtifact["payload"]): TraceValue {
  if (!payload) {
    return null;
  }

  switch (payload.kind) {
    case "plan":
      return {
        kind: payload.kind,
        version: payload.version,
        phaseIds: previewStrings(payload.phaseIds),
        phaseCount: payload.phaseIds.length,
        storyIds: previewStrings(payload.storyIds),
        storyCount: payload.storyIds.length,
        taskIds: previewStrings(payload.taskIds),
        taskCount: payload.taskIds.length,
        validationTargets: previewStrings(payload.validationTargets),
        validationTargetCount: payload.validationTargets.length
      } as TraceValue;
    case "requirements":
      return {
        kind: payload.kind,
        version: payload.version,
        scopeSummary: payload.scopeSummary,
        constraints: previewStrings(payload.constraints),
        constraintCount: payload.constraints.length,
        fileTargets: previewStrings(payload.fileTargets),
        fileTargetCount: payload.fileTargets.length,
        domainTargets: previewStrings(payload.domainTargets),
        domainTargetCount: payload.domainTargets.length,
        validationTargets: previewStrings(payload.validationTargets),
        validationTargetCount: payload.validationTargets.length,
        storyIds: previewStrings(payload.storyIds),
        taskIds: previewStrings(payload.taskIds),
        approvalGateKind: payload.approvalGateKind
      } as TraceValue;
    case "architecture_decision":
      return {
        kind: payload.kind,
        version: payload.version,
        storyId: payload.storyId,
        selectedSpecialistAgentTypeId: payload.selectedSpecialistAgentTypeId,
        decisionSource: payload.decisionSource,
        rationale: payload.rationale,
        domainTargets: previewStrings(payload.domainTargets),
        fileTargets: previewStrings(payload.fileTargets),
        allowedToolNames: previewStrings(payload.allowedToolNames),
        validationTargets: previewStrings(payload.validationTargets),
        taskIds: previewStrings(payload.taskIds)
      } as TraceValue;
    case "subtask_breakdown":
      return {
        kind: payload.kind,
        version: payload.version,
        storyId: payload.storyId,
        dependencyStrategy: payload.dependencyStrategy,
        taskCount: payload.tasks.length,
        tasks: payload.tasks.slice(0, TRACE_ARRAY_PREVIEW_LIMIT).map((task) => ({
          taskId: task.taskId,
          specialistAgentTypeId: task.specialistAgentTypeId,
          dependencyIds: previewStrings(task.dependencyIds),
          allowedToolNames: previewStrings(task.allowedToolNames),
          validationTargets: previewStrings(task.validationTargets),
          relevantFiles: previewStrings(task.relevantFiles),
          constraints: previewStrings(task.constraints)
        }))
      } as TraceValue;
    case "delegation_brief":
      return {
        kind: payload.kind,
        version: payload.version,
        scopeSummary: payload.scopeSummary,
        acceptanceCriteria: previewStrings(payload.acceptanceCriteria),
        validationTargets: previewStrings(payload.validationTargets),
        dependencyIds: previewStrings(payload.dependencyIds)
      } as TraceValue;
    case "delivery_summary":
      return {
        kind: payload.kind,
        version: payload.version,
        headline: payload.headline,
        outputs: previewStrings(payload.outputs),
        links: payload.links.slice(0, TRACE_ARRAY_PREVIEW_LIMIT).map((link) => ({
          kind: link.kind,
          label: link.label,
          provider: link.provider
        })),
        riskCount: payload.risks.length,
        risks: previewStrings(payload.risks),
        followUpCount: payload.followUps.length,
        followUps: previewStrings(payload.followUps)
      } as TraceValue;
    case "failure_report":
      return {
        kind: payload.kind,
        version: payload.version,
        headline: payload.headline,
        riskCount: payload.risks.length,
        risks: previewStrings(payload.risks),
        followUpCount: payload.followUps.length,
        followUps: previewStrings(payload.followUps),
        validationFailureCount: payload.validationFailures.length,
        validationFailures: previewStrings(payload.validationFailures)
      } as TraceValue;
  }
}

function summarizeWorkPacketForTrace(workPacket: ControlPlaneWorkPacket | null): TraceValue {
  if (!workPacket) {
    return null;
  }

  return {
    version: workPacket.version,
    scopeSummary: workPacket.scopeSummary,
    sourceArtifactIds: previewStrings(workPacket.sourceArtifactIds),
    sourceArtifactCount: workPacket.sourceArtifactIds.length,
    constraints: previewStrings(workPacket.constraints),
    constraintCount: workPacket.constraints.length,
    fileTargets: previewStrings(workPacket.fileTargets),
    fileTargetCount: workPacket.fileTargets.length,
    domainTargets: previewStrings(workPacket.domainTargets),
    domainTargetCount: workPacket.domainTargets.length,
    acceptanceCriteria: previewStrings(workPacket.acceptanceCriteria),
    acceptanceCriteriaCount: workPacket.acceptanceCriteria.length,
    validationTargets: previewStrings(workPacket.validationTargets),
    validationTargetCount: workPacket.validationTargets.length,
    dependencyIds: previewStrings(workPacket.dependencyIds),
    dependencyCount: workPacket.dependencyIds.length,
    taskIds: previewStrings(workPacket.taskIds),
    taskCount: workPacket.taskIds.length,
    ownerAgentTypeId: workPacket.ownerAgentTypeId
  } as TraceValue;
}

function upsertIntervention(
  controlPlane: ControlPlaneState,
  intervention: Omit<ControlPlaneIntervention, "createdAt" | "resolvedAt" | "ownerAgentTypeId"> & {
    ownerAgentTypeId?: TeamSkillId | null;
  }
) {
  const existing = controlPlane.interventions.find((candidate) => candidate.id === intervention.id);

  if (existing) {
    existing.summary = intervention.summary;
    existing.ownerRole = intervention.ownerRole;
    existing.ownerId = intervention.ownerId;
    existing.ownerAgentTypeId =
      intervention.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, intervention.ownerId);
    existing.resolvedAt = null;
    return;
  }

  controlPlane.interventions.push({
    ...intervention,
    ownerAgentTypeId:
      intervention.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, intervention.ownerId),
    createdAt: new Date().toISOString(),
    resolvedAt: null
  });
  attachEntityId(
    controlPlane,
    intervention.entityKind,
    intervention.entityId,
    "interventionIds",
    intervention.id
  );
}

function upsertBlocker(
  controlPlane: ControlPlaneState,
  blocker: Omit<
    ControlPlaneBlocker,
    "createdAt" | "resolvedAt" | "status" | "ownerAgentTypeId"
  > & {
    ownerAgentTypeId?: TeamSkillId | null;
  }
) {
  const existing = controlPlane.blockers.find((candidate) => candidate.id === blocker.id);

  if (existing) {
    existing.summary = blocker.summary;
    existing.status = "open";
    existing.resolvedAt = null;
    existing.ownerAgentTypeId =
      blocker.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, blocker.ownerId);
    return;
  }

  controlPlane.blockers.push({
    ...blocker,
    ownerAgentTypeId: blocker.ownerAgentTypeId ?? resolveAgentTypeId(controlPlane, blocker.ownerId),
    status: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null
  });
  attachEntityId(controlPlane, blocker.entityKind, blocker.entityId, "blockerIds", blocker.id);
}

function resolveBlockers(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  const resolvedAt = new Date().toISOString();

  for (const blocker of controlPlane.blockers) {
    if (blocker.entityKind === entityKind && blocker.entityId === entityId && blocker.status === "open") {
      blocker.status = "resolved";
      blocker.resolvedAt = resolvedAt;
    }
  }
}

function resolveConflicts(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  const resolvedAt = new Date().toISOString();

  for (const conflict of controlPlane.conflicts) {
    if (conflict.entityKind === entityKind && conflict.entityId === entityId && conflict.status === "open") {
      conflict.status = "resolved";
      conflict.resolvedAt = resolvedAt;
    }
  }
}

function resolveInterventions(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  const resolvedAt = new Date().toISOString();

  for (const intervention of controlPlane.interventions) {
    if (
      intervention.entityKind === entityKind &&
      intervention.entityId === entityId &&
      intervention.resolvedAt === null
    ) {
      intervention.resolvedAt = resolvedAt;
    }
  }
}

function resolveInterventionById(controlPlane: ControlPlaneState, interventionId: string) {
  const resolvedAt = new Date().toISOString();
  const intervention = controlPlane.interventions.find((candidate) => candidate.id === interventionId);

  if (intervention) {
    intervention.resolvedAt = resolvedAt;
  }
}

function resolveBlockerById(controlPlane: ControlPlaneState, blockerId: string) {
  const resolvedAt = new Date().toISOString();
  const blocker = controlPlane.blockers.find((candidate) => candidate.id === blockerId);

  if (blocker && blocker.status === "open") {
    blocker.status = "resolved";
    blocker.resolvedAt = resolvedAt;
  }
}

function attachEntityId(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string,
  key:
    | "artifactIds"
    | "handoffIds"
    | "interventionIds"
    | "blockerIds"
    | "conflictIds"
    | "mergeDecisionIds",
  value: string
) {
  const entity = findEntityNode(controlPlane, entityKind, entityId);

  if (!entity) {
    return;
  }

  if (!entity[key].includes(value)) {
    entity[key].push(value);
  }
}

function findEntityNode(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string
) {
  switch (entityKind) {
    case "phase":
      return findPhaseNode(controlPlane, entityId);
    case "story":
      return findStoryNode(controlPlane, entityId);
    case "task":
      return findTaskNode(controlPlane, entityId);
  }
}

function findPhaseNode(controlPlane: ControlPlaneState, phaseId: string) {
  return controlPlane.phases.find((phase) => phase.id === phaseId) ?? null;
}

function findHandoff(controlPlane: ControlPlaneState, handoffId: string) {
  return controlPlane.handoffs.find((handoff) => handoff.id === handoffId) ?? null;
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

function resolveGovernanceEntity(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind | null | undefined,
  entityId: string | null | undefined
) {
  if (entityKind && entityId) {
    return {
      entityKind,
      entityId
    };
  }

  if (controlPlane.current.taskId) {
    return {
      entityKind: "task" as const,
      entityId: controlPlane.current.taskId
    };
  }

  if (controlPlane.current.storyId) {
    return {
      entityKind: "story" as const,
      entityId: controlPlane.current.storyId
    };
  }

  if (controlPlane.current.phaseId) {
    return {
      entityKind: "phase" as const,
      entityId: controlPlane.current.phaseId
    };
  }

  return null;
}

function buildGovernanceConflict(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string,
  sourceHandoffId: string | null,
  conflict: {
    type: string;
    stepId: string | null;
    reason: string;
    detectedAt: number;
    metadata?: TraceValue;
  }
): Omit<ControlPlaneConflict, "ownerAgentTypeId" | "resolvedAt" | "resolutionDecisionId"> & {
  metadata?: TraceValue | null;
} {
  const metadataObject = toRecord(conflict.metadata);
  const conflictingPaths = readStringArray(metadataObject.changedFiles);
  const expectedPaths = uniqueStrings([
    ...readStringArray(metadataObject.expectedPath),
    ...readStringArray(metadataObject.expectedPaths)
  ]);
  const conflictingAgentTypeIds = uniqueSkillIds(
    [
      readSkillId(metadataObject.ownerAgentTypeId),
      readSkillId(metadataObject.expectedAgentTypeId)
    ].filter((value): value is TeamSkillId => value !== null)
  );

  return {
    id: governanceConflictId(entityKind, entityId, conflict.stepId, conflict.type),
    kind: mapConflictKind(conflict.type),
    entityKind,
    entityId,
    stepId: conflict.stepId,
    summary: conflict.reason,
    status: "open",
    detectedAt: new Date(conflict.detectedAt).toISOString(),
    ownerRole: "production_lead",
    ownerId: PRODUCTION_LEAD_ID,
    sourceHandoffId,
    relatedHandoffIds: sourceHandoffId ? [sourceHandoffId] : [],
    conflictingPaths,
    expectedPaths,
    conflictingAgentTypeIds,
    metadata: conflict.metadata ?? null
  };
}

function mapConflictKind(type: string): ControlPlaneConflictKind {
  switch (type) {
    case "unexpected_side_effects":
    case "verifier_target_mismatch":
      return "boundary_violation";
    case "verifier_intent_mismatch":
      return "intent_mismatch";
    case "retry_cap_exceeded":
      return "retry_cap_exceeded";
    case "replan_cap_exceeded":
      return "replan_cap_exceeded";
    default:
      return "validation_failure";
  }
}

function sharesDependency(left: ControlPlaneHandoff, right: ControlPlaneHandoff) {
  if (left.entityKind !== "task" || right.entityKind !== "task") {
    return false;
  }

  return (
    left.dependencyIds.includes(right.entityId) ||
    right.dependencyIds.includes(left.entityId)
  );
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((value) => rightSet.has(value)));
}

function renderScopeOverlapSummary(paths: string[], domains: string[]) {
  if (paths.length > 0) {
    return paths.slice(0, 2).join(", ");
  }

  return domains.slice(0, 2).join(", ");
}

function sortedPairId(left: string, right: string) {
  return [left, right].sort((a, b) => a.localeCompare(b)).join(":");
}

function scopeConflictId(leftHandoffId: string, rightHandoffId: string) {
  return `conflict:scope-overlap:${sortedPairId(leftHandoffId, rightHandoffId)}`;
}

function governanceConflictId(
  entityKind: ControlPlaneEntityKind,
  entityId: string,
  stepId: string | null,
  type: string
) {
  return `conflict:${entityKind}:${entityId}:${stepId ?? "run"}:${type}`;
}

function defaultHandoffId(entityKind: ControlPlaneEntityKind, entityId: string) {
  return `handoff:${entityKind}:${entityId}`;
}

function governanceInterventionId(
  entityKind: ControlPlaneEntityKind,
  entityId: string,
  outcome: ControlPlaneMergeResolution
) {
  return `intervention:governance:${entityKind}:${entityId}:${outcome}`;
}

function governanceBlockerId(entityKind: ControlPlaneEntityKind, entityId: string) {
  return `blocker:governance:${entityKind}:${entityId}`;
}

function toRecord(value: TraceValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, TraceValue>)
    : {};
}

function readStringArray(value: TraceValue | undefined) {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  );
}

function readSkillId(value: TraceValue | undefined): TeamSkillId | null {
  return typeof value === "string" && isTeamSkillId(value) ? value : null;
}

function isTeamSkillId(value: string): value is TeamSkillId {
  return [
    "production_lead",
    "execution_subagent",
    "frontend_dev",
    "backend_dev",
    "repo_tools_dev",
    "observability_dev",
    "rebuild_dev"
  ].includes(value);
}

function humanizeSpecialistAgentType(value: TeamSkillId) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function storyOwnerId(agentTypeId: TeamSkillId, storyId: string) {
  return `agent:specialist-dev:${agentTypeId}:${storyId}`;
}

function taskOwnerId(agentTypeId: TeamSkillId, taskId: string) {
  return `agent:execution-subagent:${agentTypeId}:${taskId}`;
}

function correlationId(entityKind: ControlPlaneEntityKind, entityId: string) {
  return `corr:${entityKind}:${entityId}`;
}

function approvalInterventionId(gateId: string) {
  return `intervention:approval-gate:${gateId}`;
}

function approvalBlockerId(gateId: string) {
  return `blocker:approval-gate:${gateId}`;
}

function derivePhaseConstraints(phase: Phase) {
  return uniqueStrings([
    ...(phase.approvalGate?.instructions ? [phase.approvalGate.instructions] : []),
    ...phase.userStories.flatMap((story) => deriveStoryConstraints(story))
  ]);
}

function deriveStoryConstraints(story: UserStory) {
  return uniqueStrings(story.tasks.flatMap((task) => deriveTaskConstraints(task)));
}

function deriveTaskConstraints(task: Task) {
  return uniqueStrings([
    ...(task.context?.constraints ?? []),
    ...(task.allowedToolNames?.length
      ? [`Allowed tools: ${task.allowedToolNames.join(", ")}`]
      : []),
    ...(task.toolRequest ? [`Seed tool request: ${task.toolRequest.toolName}`] : [])
  ]);
}

function derivePhaseTaskIds(phase: Phase) {
  return phase.userStories.flatMap((story) => story.tasks.map((task) => task.id));
}

function derivePhaseFileTargets(phase: Phase) {
  return uniqueStrings(phase.userStories.flatMap((story) => deriveStoryFileTargets(story)));
}

function deriveStoryFileTargets(story: UserStory) {
  return uniqueStrings(story.tasks.flatMap((task) => deriveTaskFileTargets(task)));
}

function deriveTaskFileTargets(task: Task) {
  return uniqueStrings([
    ...(task.context?.relevantFiles.map((file) => file.path) ?? []),
    ...deriveToolRequestPaths(task)
  ]);
}

function deriveToolRequestPaths(task: Task) {
  if (!task.toolRequest) {
    return [];
  }

  const input = task.toolRequest.input as Record<string, unknown>;

  return typeof input.path === "string" && input.path.trim() ? [input.path.trim()] : [];
}

function derivePhaseDomainTargets(
  phase: Phase,
  registry = createSpecialistAgentRegistry()
) {
  return uniqueStrings(
    phase.userStories.flatMap((story) => deriveStoryDomainTargets(story, registry))
  );
}

function deriveStoryDomainTargets(
  story: UserStory,
  registry = createSpecialistAgentRegistry()
) {
  return [...resolveStoryDefinition(story, null, registry).domainTags];
}

function deriveTaskDomainTargets(
  story: UserStory,
  task: Task,
  registry = createSpecialistAgentRegistry()
) {
  return [...resolveStoryDefinition(story, task, registry).domainTags];
}

function deriveAllowedToolNames(task: Task) {
  return uniqueStrings([
    ...(task.allowedToolNames ?? []),
    ...(task.toolRequest ? [task.toolRequest.toolName] : [])
  ]) as ControlPlaneDecomposedTask["allowedToolNames"];
}

function deriveStoryValidationTargets(story: UserStory) {
  return story.validationGates.length > 0
    ? story.validationGates.map((gate) => gate.description)
    : [...story.acceptanceCriteria];
}

function deriveTaskValidationTargets(task: Task) {
  return task.validationGates.length > 0
    ? task.validationGates.map((gate) => gate.description)
    : [task.expectedOutcome];
}

function findTaskDependencyIds(story: UserStory, taskId: string) {
  const taskIndex = story.tasks.findIndex((task) => task.id === taskId);

  return taskIndex > 0 ? [story.tasks[taskIndex - 1]!.id] : [];
}

function resolveStoryDefinition(
  story: UserStory,
  task: Task | null,
  registry = createSpecialistAgentRegistry()
): SpecialistAgentDefinition {
  return getSpecialistDefinition(resolveSpecialistAgentType({ story, task }), registry);
}

function resolveStoryRoutingDecision(
  story: UserStory,
  registry = createSpecialistAgentRegistry()
): {
  definition: SpecialistAgentDefinition;
  decisionSource: ControlPlaneRoutingDecisionSource;
  rationale: string;
} {
  const definition = resolveStoryDefinition(story, null, registry);
  const requiredTaskAgentTypes = uniqueStrings(
    story.tasks
      .map((task) => task.requiredSpecialistAgentTypeId)
      .filter((agentTypeId): agentTypeId is SpecialistAgentTypeId => agentTypeId !== null)
  );

  if (story.preferredSpecialistAgentTypeId) {
    return {
      definition,
      decisionSource: "story_preference",
      rationale: `Story preference selected ${definition.label} for ${story.title}.`
    };
  }

  if (requiredTaskAgentTypes.length > 0) {
    return {
      definition,
      decisionSource: "task_requirement",
      rationale: `Task requirements routed ${story.title} to ${definition.label}.`
    };
  }

  return {
    definition,
    decisionSource: "registry_default",
    rationale: `No explicit specialist preference was set, so ${story.title} defaulted to ${definition.label}.`
  };
}

function normalizeArtifactPayload(payload: ControlPlaneArtifact["payload"] | undefined) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return structuredClone(payload);
}

function normalizeWorkPacket(workPacket: ControlPlaneHandoff["workPacket"] | undefined) {
  if (!workPacket || typeof workPacket !== "object") {
    return null;
  }

  return {
    version: 1,
    sourceArtifactIds: Array.isArray(workPacket.sourceArtifactIds)
      ? uniqueStrings(workPacket.sourceArtifactIds)
      : [],
    scopeSummary: workPacket.scopeSummary,
    constraints: Array.isArray(workPacket.constraints) ? uniqueStrings(workPacket.constraints) : [],
    fileTargets: Array.isArray(workPacket.fileTargets) ? uniqueStrings(workPacket.fileTargets) : [],
    domainTargets: Array.isArray(workPacket.domainTargets)
      ? uniqueStrings(workPacket.domainTargets)
      : [],
    acceptanceCriteria: Array.isArray(workPacket.acceptanceCriteria)
      ? [...workPacket.acceptanceCriteria]
      : [],
    acceptanceTargetIds: Array.isArray(workPacket.acceptanceTargetIds)
      ? uniqueStrings(workPacket.acceptanceTargetIds)
      : [],
    verificationTargetIds: Array.isArray(workPacket.verificationTargetIds)
      ? uniqueStrings(workPacket.verificationTargetIds)
      : [],
    validationTargets: Array.isArray(workPacket.validationTargets)
      ? [...workPacket.validationTargets]
      : [],
    dependencyIds: Array.isArray(workPacket.dependencyIds)
      ? uniqueStrings(workPacket.dependencyIds)
      : [],
    taskIds: Array.isArray(workPacket.taskIds) ? uniqueStrings(workPacket.taskIds) : [],
    ownerAgentTypeId: workPacket.ownerAgentTypeId ?? null
  } satisfies ControlPlaneWorkPacket;
}

function uniqueSkillIds(skillIds: TeamSkillId[]) {
  return [...new Set(skillIds)];
}

function resolveAgentTypeId(controlPlane: ControlPlaneState, agentId: string) {
  return controlPlane.agents.find((agent) => agent.id === agentId)?.agentTypeId ?? inferAgentTypeId(agentId);
}

function inferAgentTypeId(agentId: string): TeamSkillId | null {
  if (agentId === PRODUCTION_LEAD_ID) {
    return "production_lead";
  }

  if (agentId.startsWith("agent:execution-subagent:")) {
    return "execution_subagent";
  }

  if (agentId.startsWith("agent:specialist-dev:frontend_dev:")) {
    return "frontend_dev";
  }

  if (agentId.startsWith("agent:specialist-dev:backend_dev:")) {
    return "backend_dev";
  }

  if (agentId.startsWith("agent:specialist-dev:repo_tools_dev:")) {
    return "repo_tools_dev";
  }

  if (agentId.startsWith("agent:specialist-dev:observability_dev:")) {
    return "observability_dev";
  }

  if (agentId.startsWith("agent:specialist-dev:rebuild_dev:")) {
    return "rebuild_dev";
  }

  return null;
}

function assertAllowedHandoff(
  controlPlane: ControlPlaneState,
  fromId: string,
  toRole: ControlPlaneRole
) {
  const agent = controlPlane.agents.find((candidate) => candidate.id === fromId);

  if (!agent) {
    return;
  }

  if (!agent.allowedHandoffTargets.includes(toRole)) {
    throw new Error(
      `Control-plane handoff not allowed for ${agent.id}: ${agent.role} -> ${toRole}`
    );
  }
}

function renderPlanSummary(phaseExecution: PhaseExecutionState) {
  return `Typed delivery plan with ${phaseExecution.progress.totalPhases} phase(s), ${phaseExecution.progress.totalStories} storie(s), and ${phaseExecution.progress.totalTasks} task(s).`;
}

function renderPhaseRequirementsSummary(phase: Phase) {
  return `Requirements packet for ${phase.name} spanning ${phase.userStories.length} story delegation(s).`;
}

function renderPhaseDelegationSummary(phase: Phase) {
  return `Production lead owns ${phase.name} with ${phase.userStories.length} story delegation(s).`;
}

function renderStoryArchitectureDecisionSummary(
  story: UserStory,
  payload: ControlPlaneArchitectureDecisionArtifactPayload
) {
  return `Architecture routing for ${story.title} selects ${payload.selectedSpecialistAgentTypeId}.`;
}

function renderStorySubtaskBreakdownSummary(story: UserStory) {
  return `Structured subtask breakdown for ${story.title} across ${story.tasks.length} task(s).`;
}

function renderStoryDelegationSummary(story: UserStory) {
  return `Deliver ${story.title} by satisfying ${story.acceptanceCriteria.length} acceptance criteria across ${story.tasks.length} task(s).`;
}

function renderTaskDelegationSummary(story: UserStory, task: Task) {
  return `Execute ${task.id} for story ${story.title}. Expected outcome: ${task.expectedOutcome}`;
}

function renderValidationSummary(results: ValidationGateResult[]) {
  if (results.length === 0) {
    return "No validation gates were recorded.";
  }

  const passed = results.filter((gate) => gate.success).length;
  const failed = results.length - passed;

  return `${passed}/${results.length} validation gates passed${failed > 0 ? `, ${failed} failed` : ""}.`;
}

function updateAgentStatuses(controlPlane: ControlPlaneState) {
  const openBlockersByOwner = new Set(
    controlPlane.blockers.filter((blocker) => blocker.status === "open").map((blocker) => blocker.ownerId)
  );

  for (const agent of controlPlane.agents) {
    if (openBlockersByOwner.has(agent.id)) {
      agent.status = "blocked";
      continue;
    }

    if (agent.id === ORCHESTRATOR_ID) {
      agent.status =
        controlPlane.status === "completed" || controlPlane.status === "failed" ? "available" : "active";
      continue;
    }

    if (agent.id === PRODUCTION_LEAD_ID) {
      agent.status =
        controlPlane.current.phaseId !== null ? "active" : hasAssignedOpenWork(controlPlane, agent) ? "assigned" : "available";
      continue;
    }

    if (agent.role === "specialist_dev") {
      agent.status =
        agent.assignedEntityIds.includes(controlPlane.current.storyId ?? "")
          ? "active"
          : hasAssignedOpenWork(controlPlane, agent)
            ? "assigned"
            : "available";
      continue;
    }

    agent.status =
      agent.assignedEntityIds.includes(controlPlane.current.taskId ?? "")
        ? "active"
        : hasAssignedOpenWork(controlPlane, agent)
          ? "assigned"
          : "available";
  }
}

function hasAssignedOpenWork(controlPlane: ControlPlaneState, agent: ControlPlaneAgent) {
  return agent.assignedEntityIds.some((entityId) => {
    const entity =
      findTaskNode(controlPlane, entityId) ??
      findStoryNode(controlPlane, entityId) ??
      findPhaseNode(controlPlane, entityId);

    return entity ? entity.status === "pending" || entity.status === "in_progress" : false;
  });
}

function completeHandoff(controlPlane: ControlPlaneState, handoffId: string) {
  const handoff = findHandoff(controlPlane, handoffId);

  if (!handoff) {
    return;
  }

  upsertHandoff(controlPlane, {
    id: handoff.id,
    fromRole: handoff.fromRole,
    fromId: handoff.fromId,
    fromAgentTypeId: handoff.fromAgentTypeId,
    toRole: handoff.toRole,
    toId: handoff.toId,
    toAgentTypeId: handoff.toAgentTypeId,
    entityKind: handoff.entityKind,
    entityId: handoff.entityId,
    correlationId: handoff.correlationId,
    artifactIds: [...handoff.artifactIds],
    dependencyIds: [...handoff.dependencyIds],
    acceptanceCriteria: [...handoff.acceptanceCriteria],
    acceptanceTargetIds: [...handoff.acceptanceTargetIds],
    verificationTargetIds: [...handoff.verificationTargetIds],
    validationTargets: [...handoff.validationTargets],
    purpose: handoff.purpose,
    workPacket: handoff.workPacket,
    status: "completed"
  });
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function previewStrings(values: string[]) {
  return uniqueStrings(values).slice(0, TRACE_ARRAY_PREVIEW_LIMIT);
}
