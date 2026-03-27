import type {
  ControlPlaneHandoff,
  ControlPlaneState,
  FactoryBacklogItem,
  FactoryDelegationBrief,
  FactoryDependencyGraph,
  FactoryDependencyGraphEdge,
  FactoryDependencyGraphNode,
  FactoryOwnershipAssignment,
  FactoryOwnershipPlan,
  FactoryRunState,
  Phase,
  PhaseExecutionState,
  RunContextInput,
  SpecialistAgentTypeId,
  Task,
  TeamSkillId,
  UserStory
} from "./types";

const PRODUCTION_LEAD_ID = "agent:production-lead";
const DEFAULT_SPECIALIST_AGENT_TYPE_ID: SpecialistAgentTypeId = "backend_dev";

export function syncFactoryDelegationState(options: {
  factory: FactoryRunState;
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  updatedAt: string;
}): Pick<FactoryRunState, "ownershipPlans" | "dependencyGraphs" | "delegationBriefs"> {
  const ownershipPlans = options.factory.stagePlans.map((stagePlan) =>
    buildFactoryOwnershipPlan({
      stagePlan,
      phaseExecution: options.phaseExecution ?? null,
      updatedAt: options.updatedAt
    })
  );
  const dependencyGraphs = options.factory.stagePlans.map((stagePlan) =>
    buildFactoryDependencyGraph({
      stagePlan,
      phaseExecution: options.phaseExecution ?? null,
      updatedAt: options.updatedAt
    })
  );
  const delegationBriefs = options.factory.stagePlans.flatMap((stagePlan) =>
    buildFactoryDelegationBriefs({
      stagePlan,
      phaseExecution: options.phaseExecution ?? null,
      controlPlane: options.controlPlane ?? null,
      updatedAt: options.updatedAt
    })
  );

  return {
    ownershipPlans,
    dependencyGraphs,
    delegationBriefs
  };
}

export function findFactoryDelegationBrief(
  factory: FactoryRunState | null | undefined,
  entityKind: FactoryDelegationBrief["entityKind"],
  entityId: string
) {
  return (
    factory?.delegationBriefs.find(
      (brief) => brief.entityKind === entityKind && brief.entityId === entityId
    ) ?? null
  );
}

export function findFactoryOwnershipPlan(
  factory: FactoryRunState | null | undefined,
  stageId: FactoryOwnershipPlan["stageId"]
) {
  return factory?.ownershipPlans.find((plan) => plan.stageId === stageId) ?? null;
}

export function findFactoryDependencyGraph(
  factory: FactoryRunState | null | undefined,
  stageId: FactoryDependencyGraph["stageId"]
) {
  return factory?.dependencyGraphs.find((graph) => graph.stageId === stageId) ?? null;
}

export function findFactoryPhaseContract(
  factory: FactoryRunState | null | undefined,
  phaseId: string
) {
  return factory?.completionContract.phases.find((phase) => phase.phaseId === phaseId) ?? null;
}

export function buildFactoryTaskDelegationRuntimeContext(options: {
  factory: FactoryRunState | null | undefined;
  phase: Phase;
  story: UserStory;
  task: Task;
}): Pick<
  RunContextInput,
  "constraints" | "externalContext" | "validationTargets" | "specialistAgentTypeId"
> {
  const stagePlan =
    options.factory?.stagePlans.find((candidate) => candidate.phaseId === options.phase.id) ?? null;
  const storyBrief = findFactoryDelegationBrief(options.factory, "story", options.story.id);
  const taskBrief = findFactoryDelegationBrief(options.factory, "task", options.task.id);
  const ownershipPlan = stagePlan
    ? findFactoryOwnershipPlan(options.factory, stagePlan.stageId)
    : null;
  const dependencyGraph = stagePlan
    ? findFactoryDependencyGraph(options.factory, stagePlan.stageId)
    : null;

  if (!taskBrief && !storyBrief && !ownershipPlan && !dependencyGraph) {
    return {
      constraints: [],
      externalContext: [],
      validationTargets: [],
      specialistAgentTypeId:
        options.task.requiredSpecialistAgentTypeId ??
        options.story.preferredSpecialistAgentTypeId ??
        null
    };
  }

  const externalContext: NonNullable<RunContextInput["externalContext"]> = [];

  if (storyBrief) {
    externalContext.push({
      id: `factory-delegation-brief:story:${options.story.id}`,
      kind: "spec",
      title: "Factory story delegation brief",
      content: summarizeDelegationBrief(storyBrief),
      source: "factory-delegation",
      format: "markdown"
    });
  }

  if (taskBrief) {
    externalContext.push({
      id: `factory-delegation-brief:task:${options.task.id}`,
      kind: "spec",
      title: "Factory task delegation brief",
      content: summarizeDelegationBrief(taskBrief),
      source: "factory-delegation",
      format: "markdown"
    });
  }

  if (ownershipPlan) {
    externalContext.push({
      id: `factory-ownership-plan:${ownershipPlan.stageId}`,
      kind: "spec",
      title: "Factory ownership plan",
      content: summarizeOwnershipPlan(ownershipPlan, options.story.id, options.task.id),
      source: "factory-delegation",
      format: "markdown"
    });
  }

  if (dependencyGraph) {
    externalContext.push({
      id: `factory-dependency-graph:${dependencyGraph.stageId}`,
      kind: "spec",
      title: "Factory dependency graph",
      content: summarizeDependencyGraph(dependencyGraph, options.task.id),
      source: "factory-delegation",
      format: "markdown"
    });
  }

  return {
    constraints: uniqueStrings([
      "Execute this Factory task through the explicit production_lead -> specialist_dev -> execution_subagent delegation chain.",
      taskBrief
        ? `Acceptance targets: ${taskBrief.acceptanceTargetIds.join(", ") || "none"}.`
        : null,
      taskBrief?.dependencyIds.length
        ? `Do not close this handoff until dependencies are satisfied: ${taskBrief.dependencyIds.join(", ")}.`
        : null,
      storyBrief
        ? `Story owner: ${humanizeIdentifier(storyBrief.specialistAgentTypeId ?? DEFAULT_SPECIALIST_AGENT_TYPE_ID)} specialist.`
        : null
    ]),
    externalContext,
    validationTargets: uniqueStrings([
      ...(storyBrief?.validationTargets ?? []),
      ...(taskBrief?.validationTargets ?? []),
      ...(taskBrief?.acceptanceCriteria ?? [])
    ]),
    specialistAgentTypeId:
      taskBrief?.specialistAgentTypeId ??
      storyBrief?.specialistAgentTypeId ??
      options.task.requiredSpecialistAgentTypeId ??
      options.story.preferredSpecialistAgentTypeId ??
      null
  };
}

function buildFactoryOwnershipPlan(options: {
  stagePlan: FactoryRunState["stagePlans"][number];
  phaseExecution: PhaseExecutionState | null;
  updatedAt: string;
}): FactoryOwnershipPlan {
  const phase =
    options.phaseExecution?.phases.find((candidate) => candidate.id === options.stagePlan.phaseId) ??
    null;
  const storyAssignments = getStoryGroups(options.stagePlan.backlog).map((group) =>
    createStoryOwnershipAssignment({
      backlogItems: group.backlogItems,
      story: group.storyId
        ? phase?.userStories.find((candidate) => candidate.id === group.storyId) ?? null
        : null
    })
  );
  const taskAssignments = options.stagePlan.backlog
    .filter((item) => item.taskId)
    .map((item) =>
      createTaskOwnershipAssignment({
        backlogItem: item,
        phase,
        stageBacklog: options.stagePlan.backlog
      })
    );

  return {
    stageId: options.stagePlan.stageId,
    phaseId: options.stagePlan.phaseId,
    summary: options.stagePlan.summary,
    productionLeadAgentId: PRODUCTION_LEAD_ID,
    productionLeadAgentTypeId: "production_lead",
    storyAssignments,
    taskAssignments,
    updatedAt: options.updatedAt
  };
}

function buildFactoryDependencyGraph(options: {
  stagePlan: FactoryRunState["stagePlans"][number];
  phaseExecution: PhaseExecutionState | null;
  updatedAt: string;
}): FactoryDependencyGraph {
  const phase =
    options.phaseExecution?.phases.find((candidate) => candidate.id === options.stagePlan.phaseId) ??
    null;
  const storyNodes = getStoryGroups(options.stagePlan.backlog).map((group) =>
    createStoryGraphNode({
      backlogItems: group.backlogItems,
      story: group.storyId
        ? phase?.userStories.find((candidate) => candidate.id === group.storyId) ?? null
        : null
    })
  );
  const taskNodes = options.stagePlan.backlog
    .filter((item) => item.taskId)
    .map((item) =>
      createTaskGraphNode({
        backlogItem: item,
        phase
      })
    );
  const edges = options.stagePlan.backlog
    .filter((item) => item.taskId)
    .flatMap((item) =>
      createTaskDependencyEdges({
        backlogItem: item,
        phase,
        stageBacklog: options.stagePlan.backlog
      })
    );

  return {
    stageId: options.stagePlan.stageId,
    phaseId: options.stagePlan.phaseId,
    nodes: [...storyNodes, ...taskNodes],
    edges,
    updatedAt: options.updatedAt
  };
}

function buildFactoryDelegationBriefs(options: {
  stagePlan: FactoryRunState["stagePlans"][number];
  phaseExecution: PhaseExecutionState | null;
  controlPlane: ControlPlaneState | null;
  updatedAt: string;
}) {
  const phase =
    options.phaseExecution?.phases.find((candidate) => candidate.id === options.stagePlan.phaseId) ??
    null;
  const storyBriefs = getStoryGroups(options.stagePlan.backlog).map((group) =>
    createStoryDelegationBrief({
      stageId: options.stagePlan.stageId,
      phaseId: options.stagePlan.phaseId,
      backlogItems: group.backlogItems,
      story: group.storyId
        ? phase?.userStories.find((candidate) => candidate.id === group.storyId) ?? null
        : null,
      controlPlane: options.controlPlane,
      updatedAt: options.updatedAt
    })
  );
  const taskBriefs = options.stagePlan.backlog
    .filter((item) => item.taskId)
    .map((item) =>
      createTaskDelegationBrief({
        stageId: options.stagePlan.stageId,
        phaseId: options.stagePlan.phaseId,
        backlogItem: item,
        phase,
        controlPlane: options.controlPlane,
        stageBacklog: options.stagePlan.backlog,
        updatedAt: options.updatedAt
      })
    );

  return [...storyBriefs, ...taskBriefs];
}

function createStoryOwnershipAssignment(options: {
  backlogItems: FactoryBacklogItem[];
  story: UserStory | null;
}): FactoryOwnershipAssignment {
  const specialistAgentTypeId = resolveSpecialistAgentTypeId(options.backlogItems, options.story, null);
  const storyId = options.story?.id ?? options.backlogItems[0]?.storyId ?? "";

  return {
    entityKind: "story",
    entityId: storyId,
    storyId,
    taskId: null,
    backlogItemIds: options.backlogItems.map((item) => item.id),
    ownerRole: "specialist_dev",
    ownerAgentId: storyOwnerId(specialistAgentTypeId, storyId),
    ownerAgentTypeId: specialistAgentTypeId,
    specialistAgentTypeId,
    acceptanceCriteria: resolveStoryAcceptanceCriteria(options.backlogItems, options.story),
    acceptanceTargetIds: uniqueStrings(
      options.backlogItems.flatMap((item) => item.completionCriterionIds)
    ),
    verificationTargetIds: uniqueStrings(
      options.backlogItems.flatMap((item) => item.verificationCriterionIds)
    ),
    validationTargets: resolveStoryValidationTargets(options.backlogItems, options.story),
    dependencyIds: []
  };
}

function createTaskOwnershipAssignment(options: {
  backlogItem: FactoryBacklogItem;
  phase: Phase | null;
  stageBacklog: FactoryBacklogItem[];
}): FactoryOwnershipAssignment {
  const taskMatch = findTaskMatch(options.phase, options.backlogItem.taskId);
  const specialistAgentTypeId = resolveSpecialistAgentTypeId(
    [options.backlogItem],
    taskMatch?.story ?? null,
    taskMatch?.task ?? null
  );
  const taskId = options.backlogItem.taskId ?? "";
  const storyId = taskMatch?.story.id ?? options.backlogItem.storyId ?? "";

  return {
    entityKind: "task",
    entityId: taskId,
    storyId,
    taskId,
    backlogItemIds: [options.backlogItem.id],
    ownerRole: "execution_subagent",
    ownerAgentId: taskOwnerId(specialistAgentTypeId, taskId),
    ownerAgentTypeId: "execution_subagent",
    specialistAgentTypeId,
    acceptanceCriteria: resolveTaskAcceptanceCriteria(options.backlogItem, taskMatch?.task ?? null),
    acceptanceTargetIds: [...options.backlogItem.completionCriterionIds],
    verificationTargetIds: [...options.backlogItem.verificationCriterionIds],
    validationTargets: resolveTaskValidationTargets(options.backlogItem, taskMatch?.task ?? null),
    dependencyIds: resolveTaskDependencyIds(options.backlogItem, options.phase, options.stageBacklog)
  };
}

function createStoryGraphNode(options: {
  backlogItems: FactoryBacklogItem[];
  story: UserStory | null;
}): FactoryDependencyGraphNode {
  const storyId = options.story?.id ?? options.backlogItems[0]?.storyId ?? "";

  return {
    id: graphNodeId("story", storyId),
    entityKind: "story",
    entityId: storyId,
    storyId,
    taskId: null,
    backlogItemIds: options.backlogItems.map((item) => item.id),
    label: options.story?.title ?? options.backlogItems[0]?.title ?? storyId
  };
}

function createTaskGraphNode(options: {
  backlogItem: FactoryBacklogItem;
  phase: Phase | null;
}): FactoryDependencyGraphNode {
  const taskMatch = findTaskMatch(options.phase, options.backlogItem.taskId);
  const taskId = options.backlogItem.taskId ?? "";

  return {
    id: graphNodeId("task", taskId),
    entityKind: "task",
    entityId: taskId,
    storyId: taskMatch?.story.id ?? options.backlogItem.storyId ?? "",
    taskId,
    backlogItemIds: [options.backlogItem.id],
    label:
      taskMatch?.task.expectedOutcome ??
      options.backlogItem.expectedOutcome ??
      options.backlogItem.title
  };
}

function createTaskDependencyEdges(options: {
  backlogItem: FactoryBacklogItem;
  phase: Phase | null;
  stageBacklog: FactoryBacklogItem[];
}): FactoryDependencyGraphEdge[] {
  const taskId = options.backlogItem.taskId ?? "";

  return resolveTaskDependencyIds(options.backlogItem, options.phase, options.stageBacklog).map(
    (dependencyId) => ({
      fromNodeId: graphNodeId("task", dependencyId),
      toNodeId: graphNodeId("task", taskId),
      dependencyIds: [dependencyId],
      rationale: `Task ${taskId} depends on ${dependencyId} before the handoff can complete.`
    })
  );
}

function createStoryDelegationBrief(options: {
  stageId: FactoryOwnershipPlan["stageId"];
  phaseId: string;
  backlogItems: FactoryBacklogItem[];
  story: UserStory | null;
  controlPlane: ControlPlaneState | null;
  updatedAt: string;
}): FactoryDelegationBrief {
  const specialistAgentTypeId = resolveSpecialistAgentTypeId(options.backlogItems, options.story, null);
  const storyId = options.story?.id ?? options.backlogItems[0]?.storyId ?? "";
  const handoffId = `handoff:story:${storyId}`;

  return {
    id: `factory-delegation:story:${storyId}`,
    stageId: options.stageId,
    phaseId: options.phaseId,
    entityKind: "story",
    entityId: storyId,
    storyId,
    taskId: null,
    backlogItemIds: options.backlogItems.map((item) => item.id),
    delegationPath: "production_lead_to_specialist",
    status: deriveDelegationStatus(options.story?.status ?? "pending", findHandoffStatus(options.controlPlane, handoffId)),
    fromRole: "production_lead",
    fromAgentId: PRODUCTION_LEAD_ID,
    fromAgentTypeId: "production_lead",
    toRole: "specialist_dev",
    toAgentId: storyOwnerId(specialistAgentTypeId, storyId),
    toAgentTypeId: specialistAgentTypeId,
    specialistAgentTypeId,
    scopeSummary: options.story?.description ?? options.backlogItems[0]?.description ?? storyId,
    acceptanceCriteria: resolveStoryAcceptanceCriteria(options.backlogItems, options.story),
    acceptanceTargetIds: uniqueStrings(
      options.backlogItems.flatMap((item) => item.completionCriterionIds)
    ),
    verificationTargetIds: uniqueStrings(
      options.backlogItems.flatMap((item) => item.verificationCriterionIds)
    ),
    validationTargets: resolveStoryValidationTargets(options.backlogItems, options.story),
    dependencyIds: [],
    artifactId: `artifact:story-delegation:${storyId}`,
    handoffId,
    createdAt: options.backlogItems[0]?.createdAt ?? options.updatedAt,
    updatedAt: options.updatedAt
  };
}

function createTaskDelegationBrief(options: {
  stageId: FactoryOwnershipPlan["stageId"];
  phaseId: string;
  backlogItem: FactoryBacklogItem;
  phase: Phase | null;
  controlPlane: ControlPlaneState | null;
  stageBacklog: FactoryBacklogItem[];
  updatedAt: string;
}): FactoryDelegationBrief {
  const taskMatch = findTaskMatch(options.phase, options.backlogItem.taskId);
  const specialistAgentTypeId = resolveSpecialistAgentTypeId(
    [options.backlogItem],
    taskMatch?.story ?? null,
    taskMatch?.task ?? null
  );
  const taskId = options.backlogItem.taskId ?? "";
  const storyId = taskMatch?.story.id ?? options.backlogItem.storyId ?? "";
  const handoffId = `handoff:task:${taskId}`;

  return {
    id: `factory-delegation:task:${taskId}`,
    stageId: options.stageId,
    phaseId: options.phaseId,
    entityKind: "task",
    entityId: taskId,
    storyId,
    taskId,
    backlogItemIds: [options.backlogItem.id],
    delegationPath: "specialist_to_execution",
    status: deriveDelegationStatus(taskMatch?.task?.status ?? "pending", findHandoffStatus(options.controlPlane, handoffId)),
    fromRole: "specialist_dev",
    fromAgentId: storyOwnerId(specialistAgentTypeId, storyId),
    fromAgentTypeId: specialistAgentTypeId,
    toRole: "execution_subagent",
    toAgentId: taskOwnerId(specialistAgentTypeId, taskId),
    toAgentTypeId: "execution_subagent",
    specialistAgentTypeId,
    scopeSummary:
      taskMatch?.task?.instruction ??
      options.backlogItem.instruction ??
      options.backlogItem.description,
    acceptanceCriteria: resolveTaskAcceptanceCriteria(
      options.backlogItem,
      taskMatch?.task ?? null
    ),
    acceptanceTargetIds: [...options.backlogItem.completionCriterionIds],
    verificationTargetIds: [...options.backlogItem.verificationCriterionIds],
    validationTargets: resolveTaskValidationTargets(
      options.backlogItem,
      taskMatch?.task ?? null
    ),
    dependencyIds: resolveTaskDependencyIds(options.backlogItem, options.phase, options.stageBacklog),
    artifactId: `artifact:task-delegation:${taskId}`,
    handoffId,
    createdAt: options.backlogItem.createdAt,
    updatedAt: options.updatedAt
  };
}

function getStoryGroups(backlog: FactoryBacklogItem[]) {
  const groups = new Map<string, FactoryBacklogItem[]>();

  for (const item of backlog) {
    const storyId = item.storyId?.trim();

    if (!storyId) {
      continue;
    }

    const existing = groups.get(storyId) ?? [];
    existing.push(item);
    groups.set(storyId, existing);
  }

  return [...groups.entries()].map(([storyId, backlogItems]) => ({
    storyId,
    backlogItems
  }));
}

function findTaskMatch(phase: Phase | null, taskId: string | null | undefined) {
  if (!phase || !taskId?.trim()) {
    return null;
  }

  for (const story of phase.userStories) {
    const task = story.tasks.find((candidate) => candidate.id === taskId);

    if (task) {
      return { story, task };
    }
  }

  return null;
}

function resolveSpecialistAgentTypeId(
  backlogItems: FactoryBacklogItem[],
  story: UserStory | null,
  task: Task | null
) {
  for (const item of backlogItems) {
    if (item.requiredSpecialistAgentTypeId) {
      return item.requiredSpecialistAgentTypeId;
    }
  }

  for (const item of backlogItems) {
    if (item.preferredSpecialistAgentTypeId) {
      return item.preferredSpecialistAgentTypeId;
    }
  }

  return (
    task?.requiredSpecialistAgentTypeId ??
    story?.preferredSpecialistAgentTypeId ??
    task?.context?.specialistAgentTypeId ??
    DEFAULT_SPECIALIST_AGENT_TYPE_ID
  );
}

function resolveStoryAcceptanceCriteria(backlogItems: FactoryBacklogItem[], story: UserStory | null) {
  return uniqueStrings(
    story?.acceptanceCriteria?.length
      ? story.acceptanceCriteria
      : backlogItems.flatMap((item) => item.acceptanceCriteria)
  );
}

function resolveStoryValidationTargets(backlogItems: FactoryBacklogItem[], story: UserStory | null) {
  return uniqueStrings([
    ...(story?.acceptanceCriteria ?? []),
    ...(story?.tasks.flatMap((task) => resolveTaskValidationTargets(backlogItems[0]!, task)) ?? []),
    ...backlogItems.flatMap((item) => item.acceptanceCriteria)
  ]);
}

function resolveTaskAcceptanceCriteria(backlogItem: FactoryBacklogItem, task: Task | null) {
  return uniqueStrings(task ? [task.expectedOutcome] : [backlogItem.expectedOutcome]);
}

function resolveTaskValidationTargets(backlogItem: FactoryBacklogItem, task: Task | null) {
  return uniqueStrings(
    task?.validationGates.length
      ? task.validationGates.map((gate) => gate.description)
      : [task?.expectedOutcome ?? backlogItem.expectedOutcome]
  );
}

function resolveTaskDependencyIds(
  backlogItem: FactoryBacklogItem,
  phase: Phase | null,
  stageBacklog: FactoryBacklogItem[]
) {
  if (!backlogItem.taskId) {
    return [];
  }

  const taskMatch = findTaskMatch(phase, backlogItem.taskId);

  if (taskMatch) {
    const taskIndex = taskMatch.story.tasks.findIndex((task) => task.id === backlogItem.taskId);

    if (taskIndex > 0) {
      return [taskMatch.story.tasks[taskIndex - 1]!.id];
    }
  }

  const storyScopedBacklog = stageBacklog.filter(
    (item) => item.storyId && item.storyId === backlogItem.storyId && item.taskId
  );
  const taskIndex = storyScopedBacklog.findIndex((item) => item.taskId === backlogItem.taskId);

  return taskIndex > 0 && storyScopedBacklog[taskIndex - 1]?.taskId
    ? [storyScopedBacklog[taskIndex - 1]!.taskId!]
    : [];
}

function deriveDelegationStatus(
  entityStatus: string,
  handoffStatus: ControlPlaneHandoff["status"] | null
): FactoryDelegationBrief["status"] {
  if (entityStatus === "failed") {
    return "failed";
  }

  if (entityStatus === "completed" || handoffStatus === "completed") {
    return "completed";
  }

  if (handoffStatus === "accepted") {
    return "accepted";
  }

  if (handoffStatus === "created") {
    return "created";
  }

  return "planned";
}

function findHandoffStatus(
  controlPlane: ControlPlaneState | null,
  handoffId: string
): ControlPlaneHandoff["status"] | null {
  return controlPlane?.handoffs.find((handoff) => handoff.id === handoffId)?.status ?? null;
}

function summarizeDelegationBrief(brief: FactoryDelegationBrief) {
  return [
    `Delegation path: ${brief.fromRole} -> ${brief.toRole}`,
    `Entity: ${brief.entityKind} ${brief.entityId}`,
    `Status: ${brief.status}`,
    `Scope: ${brief.scopeSummary}`,
    `Backlog items: ${brief.backlogItemIds.join(", ") || "none"}`,
    `Acceptance targets: ${brief.acceptanceTargetIds.join(", ") || "none"}`,
    `Verification targets: ${brief.verificationTargetIds.join(", ") || "none"}`,
    `Acceptance criteria: ${brief.acceptanceCriteria.join(" | ") || "none"}`,
    `Validation targets: ${brief.validationTargets.join(" | ") || "none"}`,
    `Dependencies: ${brief.dependencyIds.join(", ") || "none"}`
  ].join("\n");
}

function summarizeOwnershipPlan(
  plan: FactoryOwnershipPlan,
  storyId: string,
  taskId: string
) {
  const storyAssignment =
    plan.storyAssignments.find((assignment) => assignment.storyId === storyId) ?? null;
  const taskAssignment = plan.taskAssignments.find((assignment) => assignment.taskId === taskId) ?? null;

  return [
    `Stage: ${plan.stageId}`,
    `Production lead: ${plan.productionLeadAgentId}`,
    storyAssignment
      ? `Story owner: ${storyAssignment.ownerAgentId} (${storyAssignment.specialistAgentTypeId ?? "unassigned"})`
      : null,
    storyAssignment
      ? `Story acceptance targets: ${storyAssignment.acceptanceTargetIds.join(", ") || "none"}`
      : null,
    taskAssignment
      ? `Execution owner: ${taskAssignment.ownerAgentId} (${taskAssignment.specialistAgentTypeId ?? "unassigned"})`
      : null,
    taskAssignment
      ? `Task acceptance targets: ${taskAssignment.acceptanceTargetIds.join(", ") || "none"}`
      : null,
    taskAssignment
      ? `Task dependencies: ${taskAssignment.dependencyIds.join(", ") || "none"}`
      : null
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeDependencyGraph(graph: FactoryDependencyGraph, taskId: string) {
  const focusedNodeId = graphNodeId("task", taskId);
  const focusedEdges = graph.edges.filter(
    (edge) => edge.toNodeId === focusedNodeId || edge.fromNodeId === focusedNodeId
  );

  return [
    `Stage: ${graph.stageId}`,
    `Nodes: ${graph.nodes.length}`,
    `Edges: ${graph.edges.length}`,
    focusedEdges.length
      ? focusedEdges
          .map((edge) => `${edge.fromNodeId} -> ${edge.toNodeId}: ${edge.rationale}`)
          .join("\n")
      : "Focused dependencies: none"
  ].join("\n");
}

function storyOwnerId(agentTypeId: TeamSkillId, storyId: string) {
  return `agent:specialist-dev:${agentTypeId}:${storyId}`;
}

function taskOwnerId(agentTypeId: TeamSkillId, taskId: string) {
  return `agent:execution-subagent:${agentTypeId}:${taskId}`;
}

function graphNodeId(entityKind: FactoryDependencyGraphNode["entityKind"], entityId: string) {
  return `${entityKind}:${entityId}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function humanizeIdentifier(value: string) {
  return value
    .split(/[_:-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}
