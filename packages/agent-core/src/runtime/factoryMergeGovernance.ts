import type {
  ControlPlaneBlocker,
  ControlPlaneConflict,
  ControlPlaneMergeDecision,
  ControlPlaneState,
  FactoryIntegrationBlocker,
  FactoryMergeDecision,
  FactoryReassignmentDecision,
  FactoryRunState,
  FactoryWorkPacket,
  ParallelExecutionWindow
} from "./types";

const PRODUCTION_LEAD_ID = "agent:production-lead";

export function syncFactoryMergeGovernanceState(options: {
  factory: FactoryRunState;
  controlPlane?: ControlPlaneState | null;
  updatedAt: string;
}): Pick<FactoryRunState, "mergeDecisions" | "integrationBlockers" | "reassignmentDecisions"> {
  if (!options.controlPlane) {
    return {
      mergeDecisions: normalizeFactoryMergeDecisions(options.factory.mergeDecisions),
      integrationBlockers: normalizeFactoryIntegrationBlockers(options.factory.integrationBlockers),
      reassignmentDecisions: normalizeFactoryReassignmentDecisions(
        options.factory.reassignmentDecisions
      )
    };
  }

  const mergeDecisions = buildFactoryMergeDecisions({
    factory: options.factory,
    controlPlane: options.controlPlane,
    updatedAt: options.updatedAt
  });
  const integrationBlockers = buildFactoryIntegrationBlockers({
    factory: options.factory,
    controlPlane: options.controlPlane,
    mergeDecisions,
    updatedAt: options.updatedAt
  });
  const reassignmentDecisions = buildFactoryReassignmentDecisions(
    options.factory,
    mergeDecisions
  );

  return {
    mergeDecisions,
    integrationBlockers,
    reassignmentDecisions
  };
}

function buildFactoryMergeDecisions(options: {
  factory: FactoryRunState;
  controlPlane: ControlPlaneState;
  updatedAt: string;
}): FactoryMergeDecision[] {
  const decisions: FactoryMergeDecision[] = [];

  for (const packet of options.factory.workPackets) {
    const relatedDecisions = options.controlPlane.mergeDecisions
      .filter((decision) => packetMatchesEntity(packet, decision.entityKind, decision.entityId))
      .sort((left, right) => left.decidedAt.localeCompare(right.decidedAt));
    const relatedConflicts = options.controlPlane.conflicts.filter((conflict) =>
      packetMatchesEntity(packet, conflict.entityKind, conflict.entityId)
    );
    const relatedBlockers = options.controlPlane.blockers.filter((blocker) =>
      packetMatchesEntity(packet, blocker.entityKind, blocker.entityId)
    );

    for (const decision of relatedDecisions) {
      decisions.push(
        mapControlPlaneDecisionToFactoryDecision(packet, decision, relatedBlockers)
      );
    }

    const hasAcceptDecision = relatedDecisions.some((decision) => decision.outcome === "accept");
    const hasOpenConflict = relatedConflicts.some((conflict) => conflict.status === "open");
    const hasOpenBlocker = relatedBlockers.some((blocker) => blocker.status === "open");

    if (packet.status === "completed" && !hasAcceptDecision && !hasOpenConflict && !hasOpenBlocker) {
      decisions.push({
        id: `factory-merge-decision:${packet.id}:accept`,
        phaseId: packet.phaseId,
        stageId: packet.stageId,
        storyId: packet.storyId,
        packetId: packet.id,
        handoffId: packet.handoffId,
        sourceDecisionId: null,
        conflictIds: uniqueStrings(relatedConflicts.map((conflict) => conflict.id)),
        blockerIds: uniqueStrings(relatedBlockers.map((blocker) => blocker.id)),
        dependencyIds: [...packet.dependencyIds],
        acceptanceTargetIds: [...packet.acceptanceTargetIds],
        verificationTargetIds: [...packet.verificationTargetIds],
        outcome: "accept",
        summary: `Production lead accepted the integrated output for ${packet.storyId}.`,
        ownerRole: "production_lead",
        ownerId: PRODUCTION_LEAD_ID,
        ownerAgentTypeId: "production_lead",
        targetHandoffId: packet.handoffId,
        reassignedToAgentTypeId: null,
        notes:
          packet.dependencyIds.length > 0
            ? `Integrated after dependencies completed: ${packet.dependencyIds.join(", ")}.`
            : null,
        decidedAt: resolvePacketDecisionTimestamp(packet, options.factory, options.updatedAt)
      });
    }
  }

  return decisions.sort((left, right) => left.decidedAt.localeCompare(right.decidedAt));
}

function buildFactoryIntegrationBlockers(options: {
  factory: FactoryRunState;
  controlPlane: ControlPlaneState;
  mergeDecisions: FactoryMergeDecision[];
  updatedAt: string;
}): FactoryIntegrationBlocker[] {
  const blockers: FactoryIntegrationBlocker[] = [];

  for (const packet of options.factory.workPackets) {
    const window = findWindowForPacket(options.factory.parallelExecutionWindows, packet.id);
    const relatedConflicts = options.controlPlane.conflicts.filter((conflict) =>
      packetMatchesEntity(packet, conflict.entityKind, conflict.entityId)
    );
    const relatedBlockers = options.controlPlane.blockers.filter((blocker) =>
      packetMatchesEntity(packet, blocker.entityKind, blocker.entityId)
    );
    const relatedDecisions = options.mergeDecisions.filter((decision) => decision.packetId === packet.id);
    const relatedScopeConflicts = relatedConflicts.filter((conflict) => conflict.kind === "scope_overlap");
    const relatedOpenBlockers = relatedBlockers.filter((blocker) => blocker.status === "open");

    if (packet.status === "blocked" || relatedScopeConflicts.some((conflict) => conflict.status === "open")) {
      blockers.push({
        id: `factory-integration-blocker:${packet.id}:scope-overlap`,
        phaseId: packet.phaseId,
        stageId: packet.stageId,
        storyId: packet.storyId,
        packetId: packet.id,
        handoffId: packet.handoffId,
        windowId: window?.id ?? null,
        sourceDecisionId:
          relatedDecisions.find((decision) => decision.outcome === "reassign")?.id ?? null,
        sourceConflictIds: uniqueStrings(relatedScopeConflicts.map((conflict) => conflict.id)),
        sourceBlockerIds: uniqueStrings(relatedOpenBlockers.map((blocker) => blocker.id)),
        kind: "scope_overlap",
        summary:
          relatedScopeConflicts[0]?.summary ??
          "Production lead must consolidate overlapping specialist output before integration continues.",
        status:
          packet.status === "blocked" || relatedOpenBlockers.length > 0 || relatedScopeConflicts.some((conflict) => conflict.status === "open")
            ? "open"
            : "resolved",
        blockingPacketIds: [...packet.blockedByPacketIds],
        scopeLockIds: [...packet.scopeLockIds],
        ownerRole: "production_lead",
        ownerId: PRODUCTION_LEAD_ID,
        ownerAgentTypeId: "production_lead",
        createdAt: relatedScopeConflicts[0]?.detectedAt ?? window?.startedAt ?? options.updatedAt,
        resolvedAt:
          packet.status === "blocked" || relatedOpenBlockers.length > 0 || relatedScopeConflicts.some((conflict) => conflict.status === "open")
            ? null
            : options.updatedAt
      });
    }

    for (const decision of relatedDecisions.filter((candidate) => candidate.outcome !== "accept")) {
      blockers.push({
        id: `factory-integration-blocker:${packet.id}:${decision.outcome}`,
        phaseId: packet.phaseId,
        stageId: packet.stageId,
        storyId: packet.storyId,
        packetId: packet.id,
        handoffId: packet.handoffId,
        windowId: window?.id ?? null,
        sourceDecisionId: decision.id,
        sourceConflictIds: [...decision.conflictIds],
        sourceBlockerIds: uniqueStrings(relatedBlockers.map((blocker) => blocker.id)),
        kind: mapDecisionOutcomeToBlockerKind(decision.outcome),
        summary: decision.summary,
        status:
          relatedOpenBlockers.length > 0 || packet.status !== "completed"
            ? "open"
            : "resolved",
        blockingPacketIds: [...packet.blockedByPacketIds],
        scopeLockIds: [...packet.scopeLockIds],
        ownerRole: decision.ownerRole,
        ownerId: decision.ownerId,
        ownerAgentTypeId: decision.ownerAgentTypeId,
        createdAt: decision.decidedAt,
        resolvedAt:
          relatedOpenBlockers.length > 0 || packet.status !== "completed"
            ? null
            : options.updatedAt
      });
    }
  }

  return blockers.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildFactoryReassignmentDecisions(
  factory: FactoryRunState,
  mergeDecisions: FactoryMergeDecision[]
): FactoryReassignmentDecision[] {
  return mergeDecisions
    .filter(
      (decision): decision is FactoryMergeDecision & { reassignedToAgentTypeId: NonNullable<FactoryMergeDecision["reassignedToAgentTypeId"]> } =>
        decision.outcome === "reassign" && decision.reassignedToAgentTypeId !== null
    )
    .map((decision) => ({
      id: `factory-reassignment:${decision.packetId}:${decision.reassignedToAgentTypeId}`,
      mergeDecisionId: decision.id,
      phaseId: decision.phaseId,
      stageId: decision.stageId,
      storyId: decision.storyId,
      packetId: decision.packetId,
      handoffId: decision.handoffId,
      fromAgentTypeId:
        factory.workPackets.find((packet) => packet.id === decision.packetId)?.ownerAgentTypeId ?? null,
      toAgentTypeId: decision.reassignedToAgentTypeId,
      reason: decision.summary,
      createdAt: decision.decidedAt
    }));
}

function mapControlPlaneDecisionToFactoryDecision(
  packet: FactoryWorkPacket,
  decision: ControlPlaneMergeDecision,
  relatedBlockers: ControlPlaneBlocker[]
): FactoryMergeDecision {
  return {
    id: `factory-merge-decision:${packet.id}:${decision.id}`,
    phaseId: packet.phaseId,
    stageId: packet.stageId,
    storyId: packet.storyId,
    packetId: packet.id,
    handoffId: packet.handoffId,
    sourceDecisionId: decision.id,
    conflictIds: [...decision.conflictIds],
    blockerIds: uniqueStrings(relatedBlockers.map((blocker) => blocker.id)),
    dependencyIds: [...packet.dependencyIds],
    acceptanceTargetIds: [...packet.acceptanceTargetIds],
    verificationTargetIds: [...packet.verificationTargetIds],
    outcome: decision.outcome,
    summary: decision.summary,
    ownerRole: "production_lead",
    ownerId: decision.ownerId,
    ownerAgentTypeId: decision.ownerAgentTypeId ?? "production_lead",
    targetHandoffId: decision.targetHandoffId,
    reassignedToAgentTypeId: decision.reassignedToAgentTypeId,
    notes: decision.notes,
    decidedAt: decision.decidedAt
  };
}

function findWindowForPacket(
  windows: ParallelExecutionWindow[],
  packetId: string
) {
  return windows.find((window) => window.packetIds.includes(packetId)) ?? null;
}

function resolvePacketDecisionTimestamp(
  packet: FactoryWorkPacket,
  factory: FactoryRunState,
  fallback: string
) {
  const window = findWindowForPacket(factory.parallelExecutionWindows, packet.id);

  return window?.completedAt ?? packet.updatedAt ?? fallback;
}

function packetMatchesEntity(
  packet: FactoryWorkPacket,
  entityKind: "phase" | "story" | "task",
  entityId: string
) {
  if (entityKind === "story") {
    return packet.storyId === entityId;
  }

  if (entityKind === "task") {
    return packet.taskIds.includes(entityId);
  }

  return packet.phaseId === entityId;
}

function mapDecisionOutcomeToBlockerKind(
  outcome: FactoryMergeDecision["outcome"]
): FactoryIntegrationBlocker["kind"] {
  switch (outcome) {
    case "retry":
      return "retry_required";
    case "reassign":
      return "reassignment_required";
    case "reject":
      return "rejected_output";
    default:
      return "scope_overlap";
  }
}

function normalizeFactoryMergeDecisions(
  value: FactoryRunState["mergeDecisions"]
): FactoryMergeDecision[] {
  return Array.isArray(value) ? value.map((decision) => ({ ...decision })) : [];
}

function normalizeFactoryIntegrationBlockers(
  value: FactoryRunState["integrationBlockers"]
): FactoryIntegrationBlocker[] {
  return Array.isArray(value) ? value.map((blocker) => ({ ...blocker })) : [];
}

function normalizeFactoryReassignmentDecisions(
  value: FactoryRunState["reassignmentDecisions"]
): FactoryReassignmentDecision[] {
  return Array.isArray(value) ? value.map((decision) => ({ ...decision })) : [];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
