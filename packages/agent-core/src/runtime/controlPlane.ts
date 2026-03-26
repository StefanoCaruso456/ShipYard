import type {
  AgentRunResult,
  ControlPlaneAgent,
  ControlPlaneArtifact,
  ControlPlaneBlocker,
  ControlPlaneEntityKind,
  ControlPlaneEntityStatus,
  ControlPlaneHandoff,
  ControlPlaneIntervention,
  ControlPlanePhaseNode,
  ControlPlaneRole,
  ControlPlaneState,
  ControlPlaneStoryNode,
  ControlPlaneTaskNode,
  ControlPlaneTransition,
  ControlPlaneValidationState,
  Phase,
  PhaseExecutionState,
  SpecialistAgentDefinition,
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

const ORCHESTRATOR_ID = "agent:orchestrator";
const PRODUCTION_LEAD_ID = "agent:production-lead";

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
    artifacts: [],
    handoffs: [],
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
    producerId: ORCHESTRATOR_ID
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
        path: artifact.path ?? null
      }))
    : [];
  normalized.handoffs = Array.isArray(normalized.handoffs)
    ? normalized.handoffs.map((handoff) => ({
        ...handoff,
        fromAgentTypeId:
          handoff.fromAgentTypeId ?? inferAgentTypeId(handoff.fromId),
        toAgentTypeId: handoff.toAgentTypeId ?? inferAgentTypeId(handoff.toId)
      }))
    : [];
  normalized.interventions = Array.isArray(normalized.interventions)
    ? normalized.interventions
    : [];
  normalized.blockers = Array.isArray(normalized.blockers) ? normalized.blockers : [];
  normalized.phases = Array.isArray(normalized.phases) ? normalized.phases : [];

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

export function recordPhaseStarted(controlPlane: ControlPlaneState | null, phase: Phase) {
  if (!controlPlane) {
    return;
  }

  const node = findPhaseNode(controlPlane, phase.id);

  if (!node) {
    return;
  }

  upsertHandoff(controlPlane, {
    id: `handoff:phase:${phase.id}`,
    fromRole: "orchestrator",
    fromId: ORCHESTRATOR_ID,
    toRole: node.ownerRole,
    toId: node.ownerId,
    entityKind: "phase",
    entityId: phase.id,
    purpose: `Coordinate phase delivery for ${phase.name}.`,
    status: "completed"
  });
}

export function recordStoryStarted(controlPlane: ControlPlaneState | null, story: UserStory) {
  if (!controlPlane) {
    return;
  }

  const node = findStoryNode(controlPlane, story.id);

  if (!node) {
    return;
  }

  upsertHandoff(controlPlane, {
    id: `handoff:story:${story.id}`,
    fromRole: "production_lead",
    fromId: PRODUCTION_LEAD_ID,
    toRole: node.ownerRole,
    toId: node.ownerId,
    entityKind: "story",
    entityId: story.id,
    purpose: `Own delivery for story ${story.title}.`,
    status: "completed"
  });
}

export function recordTaskStarted(
  controlPlane: ControlPlaneState | null,
  story: UserStory,
  task: Task
) {
  if (!controlPlane) {
    return;
  }

  const storyNode = findStoryNode(controlPlane, story.id);
  const taskNode = findTaskNode(controlPlane, task.id);

  if (!storyNode || !taskNode) {
    return;
  }

  upsertHandoff(controlPlane, {
    id: `handoff:task:${task.id}`,
    fromRole: storyNode.ownerRole,
    fromId: storyNode.ownerId,
    toRole: taskNode.ownerRole,
    toId: taskNode.ownerId,
    entityKind: "task",
    entityId: task.id,
    purpose: `Execute task ${task.id}.`,
    status: "completed"
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

  resolveBlockers(controlPlane, "task", task.id);
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
    producerId: taskNode.ownerId
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

  resolveBlockers(controlPlane, "story", story.id);
  resolveInterventions(controlPlane, "story", story.id);
  upsertArtifact(controlPlane, {
    id: `artifact:story-summary:${story.id}`,
    kind: "delivery_summary",
    entityKind: "story",
    entityId: story.id,
    summary: `Story ${story.title} completed.`,
    createdAt: new Date().toISOString(),
    producerRole: storyNode.ownerRole,
    producerId: storyNode.ownerId
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
    producerId: storyNode.ownerId
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

  resolveBlockers(controlPlane, "phase", phase.id);
  resolveInterventions(controlPlane, "phase", phase.id);
  upsertArtifact(controlPlane, {
    id: `artifact:phase-summary:${phase.id}`,
    kind: "delivery_summary",
    entityKind: "phase",
    entityId: phase.id,
    summary: `Phase ${phase.name} completed.`,
    createdAt: new Date().toISOString(),
    producerRole: phaseNode.ownerRole,
    producerId: phaseNode.ownerId
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
    producerId: phaseNode.ownerId
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
    status === "completed" ||
    status === "failed"
    ? status
    : "pending";
}

function upsertArtifact(
  controlPlane: ControlPlaneState,
  artifact: Omit<ControlPlaneArtifact, "producerAgentTypeId"> & {
    producerAgentTypeId?: TeamSkillId | null;
  }
) {
  const existing = controlPlane.artifacts.find((candidate) => candidate.id === artifact.id);
  const producerAgentTypeId =
    artifact.producerAgentTypeId ?? resolveAgentTypeId(controlPlane, artifact.producerId);

  if (existing) {
    existing.summary = artifact.summary;
    existing.createdAt = artifact.createdAt;
    existing.producerAgentTypeId = producerAgentTypeId;
    existing.path = artifact.path ?? null;
  } else {
    controlPlane.artifacts.push({
      ...artifact,
      producerAgentTypeId,
      path: artifact.path ?? null
    });
  }

  attachEntityId(controlPlane, artifact.entityKind, artifact.entityId, "artifactIds", artifact.id);
}

function upsertHandoff(
  controlPlane: ControlPlaneState,
  handoff: Omit<
    ControlPlaneHandoff,
    "createdAt" | "acceptedAt" | "completedAt" | "fromAgentTypeId" | "toAgentTypeId"
  > & {
    fromAgentTypeId?: TeamSkillId | null;
    toAgentTypeId?: TeamSkillId | null;
    status: ControlPlaneHandoff["status"];
  }
) {
  const now = new Date().toISOString();
  const existing = controlPlane.handoffs.find((candidate) => candidate.id === handoff.id);
  const fromAgentTypeId =
    handoff.fromAgentTypeId ?? resolveAgentTypeId(controlPlane, handoff.fromId);
  const toAgentTypeId = handoff.toAgentTypeId ?? resolveAgentTypeId(controlPlane, handoff.toId);

  assertAllowedHandoff(controlPlane, handoff.fromId, handoff.toRole);

  if (existing) {
    existing.fromRole = handoff.fromRole;
    existing.fromId = handoff.fromId;
    existing.fromAgentTypeId = fromAgentTypeId;
    existing.toRole = handoff.toRole;
    existing.toId = handoff.toId;
    existing.toAgentTypeId = toAgentTypeId;
    existing.purpose = handoff.purpose;
    existing.status = handoff.status;
    existing.acceptedAt = handoff.status === "created" ? null : existing.acceptedAt ?? now;
    existing.completedAt = handoff.status === "completed" ? now : existing.completedAt;
  } else {
    controlPlane.handoffs.push({
      ...handoff,
      fromAgentTypeId,
      toAgentTypeId,
      createdAt: now,
      acceptedAt: handoff.status === "created" ? null : now,
      completedAt: handoff.status === "completed" ? now : null
    });
  }

  attachEntityId(controlPlane, handoff.entityKind, handoff.entityId, "handoffIds", handoff.id);
}

function upsertIntervention(
  controlPlane: ControlPlaneState,
  intervention: Omit<ControlPlaneIntervention, "createdAt" | "resolvedAt" | "ownerAgentTypeId"> & {
    ownerAgentTypeId?: TeamSkillId | null;
  }
) {
  if (controlPlane.interventions.some((candidate) => candidate.id === intervention.id)) {
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

function attachEntityId(
  controlPlane: ControlPlaneState,
  entityKind: ControlPlaneEntityKind,
  entityId: string,
  key: "artifactIds" | "handoffIds" | "interventionIds" | "blockerIds",
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

function storyOwnerId(agentTypeId: TeamSkillId, storyId: string) {
  return `agent:specialist-dev:${agentTypeId}:${storyId}`;
}

function taskOwnerId(agentTypeId: TeamSkillId, taskId: string) {
  return `agent:execution-subagent:${agentTypeId}:${taskId}`;
}

function resolveStoryDefinition(
  story: UserStory,
  task: Task | null,
  registry = createSpecialistAgentRegistry()
): SpecialistAgentDefinition {
  return getSpecialistDefinition(resolveSpecialistAgentType({ story, task }), registry);
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
