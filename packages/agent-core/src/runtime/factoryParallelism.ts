import type {
  ControlPlaneState,
  FactoryRunState,
  FactoryWorkPacket,
  ParallelExecutionWindow,
  Phase,
  PhaseExecutionState,
  ScopeLock
} from "./types";
import {
  findControlPlaneHandoff,
  findOpenScopeConflictsForHandoff
} from "./controlPlane";

const MAX_PARALLEL_PACKETS = 3;

export function syncFactoryParallelismState(options: {
  factory: FactoryRunState;
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  updatedAt: string;
}): Pick<FactoryRunState, "workPackets" | "scopeLocks" | "parallelExecutionWindows"> {
  const parallelExecutionWindows = normalizeParallelExecutionWindows(
    options.factory.parallelExecutionWindows
  );
  const scopeLocks = normalizeScopeLocks(options.factory.scopeLocks);
  const workPackets = buildFactoryWorkPackets({
    factory: options.factory,
    phaseExecution: options.phaseExecution ?? null,
    controlPlane: options.controlPlane ?? null,
    parallelExecutionWindows,
    scopeLocks,
    updatedAt: options.updatedAt
  });

  return {
    workPackets,
    scopeLocks,
    parallelExecutionWindows
  };
}

export function openFactoryParallelExecutionWindow(options: {
  factory: FactoryRunState;
  phase: Phase;
  phaseExecution: PhaseExecutionState;
  controlPlane: ControlPlaneState | null;
  updatedAt: string;
}) {
  const baseFactory = {
    ...options.factory,
    ...syncFactoryParallelismState({
      factory: options.factory,
      phaseExecution: options.phaseExecution,
      controlPlane: options.controlPlane,
      updatedAt: options.updatedAt
    })
  };
  const packets = orderPhasePackets(baseFactory, options.phase.id, options.phase.userStories.map(
    (story) => story.id
  ));
  const selectedPackets: FactoryWorkPacket[] = [];
  const blockedPacketIds = new Set<string>();
  const blockedByPacketIds = new Map<string, string[]>();
  const conflictIds = new Set<string>();
  let forceSequential = false;

  for (const packet of packets) {
    if (packet.status === "completed" || hasIncompleteDependencies(options.phaseExecution, packet)) {
      continue;
    }

    if (!isPacketSafeForParallel(packet)) {
      if (selectedPackets.length === 0) {
        selectedPackets.push(packet);
        forceSequential = true;
      } else {
        blockedPacketIds.add(packet.id);
      }

      continue;
    }

    const overlappingPackets = selectedPackets.filter((candidate) => packetsOverlap(packet, candidate));

    if (forceSequential || overlappingPackets.length > 0) {
      blockedPacketIds.add(packet.id);
      blockedByPacketIds.set(
        packet.id,
        overlappingPackets.map((candidate) => candidate.id)
      );

      for (const overlappingPacket of overlappingPackets) {
        for (const conflictId of findConflictIdsForPacketPair(
          options.controlPlane,
          packet.handoffId,
          overlappingPacket.handoffId
        )) {
          conflictIds.add(conflictId);
        }
      }

      continue;
    }

    if (selectedPackets.length >= MAX_PARALLEL_PACKETS) {
      continue;
    }

    selectedPackets.push(packet);
  }

  if (selectedPackets.length === 0) {
    const fallbackPacket = packets.find(
      (packet) =>
        packet.status !== "completed" && !hasIncompleteDependencies(options.phaseExecution, packet)
    );

    if (!fallbackPacket) {
      return {
        factory: baseFactory,
        selectedPackets: [] as FactoryWorkPacket[],
        window: null as ParallelExecutionWindow | null
      };
    }

    selectedPackets.push(fallbackPacket);
    forceSequential = true;
  }

  const windowId = `factory-parallel-window:${options.phase.id}:${baseFactory.parallelExecutionWindows.length + 1}`;
  const scopeLocks = buildScopeLocks({
    packets: selectedPackets,
    phaseId: options.phase.id,
    stageId: resolveStageId(baseFactory, options.phase.id),
    updatedAt: options.updatedAt
  });
  const window: ParallelExecutionWindow = {
    id: windowId,
    phaseId: options.phase.id,
    stageId: resolveStageId(baseFactory, options.phase.id),
    packetIds: selectedPackets.map((packet) => packet.id),
    blockedPacketIds: uniqueStrings([...blockedPacketIds]),
    scopeLockIds: scopeLocks.map((lock) => lock.id),
    conflictIds: uniqueStrings([...conflictIds]),
    executionMode:
      forceSequential || selectedPackets.length === 1 ? "sequential" : "parallel",
    status: "running",
    startedAt: options.updatedAt,
    completedAt: null
  };
  const selectedPacketIds = new Set(selectedPackets.map((packet) => packet.id));
  const nextFactory: FactoryRunState = {
    ...baseFactory,
    scopeLocks: [...baseFactory.scopeLocks, ...scopeLocks],
    parallelExecutionWindows: [...baseFactory.parallelExecutionWindows, window],
    workPackets: baseFactory.workPackets.map((packet) => {
      if (selectedPacketIds.has(packet.id)) {
        return {
          ...packet,
          blockedByPacketIds: [],
          conflictIds: uniqueStrings([
            ...packet.conflictIds,
            ...window.conflictIds
          ]),
          scopeLockIds: scopeLocks
            .filter((lock) => lock.packetId === packet.id)
            .map((lock) => lock.id),
          status: "running",
          statusSummary:
            window.executionMode === "parallel"
              ? "Running inside a parallel execution window."
              : "Running in a serialized execution window.",
          updatedAt: options.updatedAt
        };
      }

      if (blockedPacketIds.has(packet.id)) {
        return {
          ...packet,
          blockedByPacketIds: blockedByPacketIds.get(packet.id) ?? [],
          conflictIds: uniqueStrings([
            ...packet.conflictIds,
            ...window.conflictIds
          ]),
          status: "blocked",
          statusSummary: "Blocked until the current execution window releases overlapping scope.",
          updatedAt: options.updatedAt
        };
      }

      return packet;
    })
  };

  return {
    factory: nextFactory,
    selectedPackets: selectedPackets.map(
      (packet) => nextFactory.workPackets.find((candidate) => candidate.id === packet.id) ?? packet
    ),
    window
  };
}

export function completeFactoryParallelExecutionWindow(options: {
  factory: FactoryRunState;
  windowId: string;
  phaseExecution: PhaseExecutionState;
  controlPlane: ControlPlaneState | null;
  updatedAt: string;
}) {
  const parallelExecutionWindows = options.factory.parallelExecutionWindows.map((window) =>
    window.id === options.windowId
      ? {
          ...window,
          status: "completed" as const,
          completedAt: options.updatedAt
        }
      : window
  );
  const scopeLocks = options.factory.scopeLocks.map((lock) =>
    lock.status === "held" &&
    parallelExecutionWindows.some(
      (window) => window.id === options.windowId && window.scopeLockIds.includes(lock.id)
    )
      ? {
          ...lock,
          status: "released" as const,
          releasedAt: options.updatedAt
        }
      : lock
  );
  const baseFactory: FactoryRunState = {
    ...options.factory,
    parallelExecutionWindows,
    scopeLocks
  };

  return {
    ...baseFactory,
    ...syncFactoryParallelismState({
      factory: baseFactory,
      phaseExecution: options.phaseExecution,
      controlPlane: options.controlPlane,
      updatedAt: options.updatedAt
    })
  };
}

function buildFactoryWorkPackets(options: {
  factory: FactoryRunState;
  phaseExecution: PhaseExecutionState | null;
  controlPlane: ControlPlaneState | null;
  parallelExecutionWindows: ParallelExecutionWindow[];
  scopeLocks: ScopeLock[];
  updatedAt: string;
}): FactoryWorkPacket[] {
  if (!options.phaseExecution || !options.controlPlane) {
    return Array.isArray(options.factory.workPackets)
      ? options.factory.workPackets.map((packet) => ({ ...packet }))
      : [];
  }

  const phaseExecution = options.phaseExecution;
  const controlPlane = options.controlPlane;
  const runningPacketIds = new Set(
    options.parallelExecutionWindows
      .filter((window) => window.status === "running")
      .flatMap((window) => window.packetIds)
  );
  const phaseStageIds = new Map(
    options.factory.completionContract.phases.map((phase) => [phase.phaseId, phase.stageId])
  );

  return options.phaseExecution.phases
    .filter((phase) => phaseStageIds.has(phase.id))
    .flatMap((phase) =>
      phase.userStories.map((story) => {
        const handoffId = `handoff:story:${story.id}`;
        const handoff = findControlPlaneHandoff(controlPlane, handoffId);
        const conflictIds = findOpenConflictIdsForHandoff(controlPlane, handoffId);
        const blockedByPacketIds = uniqueStrings(
          (controlPlane.conflicts ?? [])
            .filter(
              (conflict) =>
                conflict.status === "open" && conflict.relatedHandoffIds.includes(handoffId)
            )
            .flatMap((conflict) =>
              conflict.relatedHandoffIds
                .filter((candidate) => candidate !== handoffId)
                .map(packetIdForHandoffId)
            )
        );
        const scopeLockIds = options.scopeLocks
          .filter((lock) => lock.packetId === packetIdForStoryId(story.id) && lock.status === "held")
          .map((lock) => lock.id);

        return {
          id: packetIdForStoryId(story.id),
          phaseId: phase.id,
          stageId: phaseStageIds.get(phase.id) ?? "implementation",
          storyId: story.id,
          handoffId,
          ownerRole: "specialist_dev" as const,
          ownerAgentId:
            handoff?.toId ??
            controlPlane.phases
              .flatMap((phaseNode) => phaseNode.userStories)
              .find((candidate) => candidate.id === story.id)?.ownerId ??
            `agent:story:${story.id}`,
          ownerAgentTypeId:
            handoff?.toAgentTypeId ??
            controlPlane.phases
              .flatMap((phaseNode) => phaseNode.userStories)
              .find((candidate) => candidate.id === story.id)?.ownerAgentTypeId ??
            story.preferredSpecialistAgentTypeId ??
            null,
          taskIds: handoff?.workPacket?.taskIds ?? story.tasks.map((task) => task.id),
          dependencyIds: handoff?.workPacket?.dependencyIds ?? [],
          acceptanceTargetIds: handoff?.workPacket?.acceptanceTargetIds ?? [],
          verificationTargetIds: handoff?.workPacket?.verificationTargetIds ?? [],
          fileTargets: handoff?.workPacket?.fileTargets ?? [],
          domainTargets: handoff?.workPacket?.domainTargets ?? [],
          conflictIds,
          blockedByPacketIds,
          scopeLockIds,
          status: derivePacketStatus({
            storyStatus: story.status,
            hasIncompleteDependencies: hasIncompleteTaskDependencies(
              phaseExecution,
              handoff?.workPacket?.dependencyIds ?? []
            ),
            isRunning: runningPacketIds.has(packetIdForStoryId(story.id)),
            isBlockedByRunningPacket:
              blockedByPacketIds.some((packetId) => runningPacketIds.has(packetId)) ||
              story.status === "blocked",
            isCompleted: handoff?.status === "completed"
          }),
          statusSummary: derivePacketStatusSummary({
            storyStatus: story.status,
            hasIncompleteDependencies: hasIncompleteTaskDependencies(
              phaseExecution,
              handoff?.workPacket?.dependencyIds ?? []
            ),
            isRunning: runningPacketIds.has(packetIdForStoryId(story.id)),
            isBlockedByRunningPacket:
              blockedByPacketIds.some((packetId) => runningPacketIds.has(packetId)) ||
              story.status === "blocked",
            hasScope: isPacketSafeForParallel({
              fileTargets: handoff?.workPacket?.fileTargets ?? [],
              domainTargets: handoff?.workPacket?.domainTargets ?? []
            })
          }),
          updatedAt: options.updatedAt
        } satisfies FactoryWorkPacket;
      })
    );
}

function normalizeParallelExecutionWindows(
  value: FactoryRunState["parallelExecutionWindows"]
): ParallelExecutionWindow[] {
  return Array.isArray(value)
    ? value.map((window) => ({
        ...window,
        packetIds: uniqueStrings(window.packetIds ?? []),
        blockedPacketIds: uniqueStrings(window.blockedPacketIds ?? []),
        scopeLockIds: uniqueStrings(window.scopeLockIds ?? []),
        conflictIds: uniqueStrings(window.conflictIds ?? []),
        executionMode: window.executionMode === "parallel" ? "parallel" : "sequential",
        status: window.status === "completed" ? "completed" : "running",
        completedAt: window.completedAt ?? null
      }))
    : [];
}

function normalizeScopeLocks(value: FactoryRunState["scopeLocks"]): ScopeLock[] {
  return Array.isArray(value)
    ? value.map((lock) => ({
        ...lock,
        targetKind: lock.targetKind === "file" ? "file" : "domain",
        status: lock.status === "released" ? "released" : "held",
        conflictIds: uniqueStrings(lock.conflictIds ?? []),
        releasedAt: lock.releasedAt ?? null
      }))
    : [];
}

function buildScopeLocks(options: {
  packets: FactoryWorkPacket[];
  phaseId: string;
  stageId: FactoryRunState["currentStage"];
  updatedAt: string;
}) {
  return options.packets.flatMap((packet) => [
    ...packet.fileTargets.map((target) => ({
      id: `factory-scope-lock:file:${packet.id}:${target}`,
      phaseId: options.phaseId,
      stageId: options.stageId,
      packetId: packet.id,
      targetKind: "file" as const,
      target,
      status: "held" as const,
      reason: `Exclusive file scope reserved for ${packet.storyId}.`,
      conflictIds: [],
      createdAt: options.updatedAt,
      releasedAt: null
    })),
    ...packet.domainTargets.map((target) => ({
      id: `factory-scope-lock:domain:${packet.id}:${target}`,
      phaseId: options.phaseId,
      stageId: options.stageId,
      packetId: packet.id,
      targetKind: "domain" as const,
      target,
      status: "held" as const,
      reason: `Exclusive domain scope reserved for ${packet.storyId}.`,
      conflictIds: [],
      createdAt: options.updatedAt,
      releasedAt: null
    }))
  ]) satisfies ScopeLock[];
}

function orderPhasePackets(factory: FactoryRunState, phaseId: string, storyIds: string[]) {
  const packetByStoryId = new Map(
    factory.workPackets
      .filter((packet) => packet.phaseId === phaseId)
      .map((packet) => [packet.storyId, packet])
  );

  return storyIds
    .map((storyId) => packetByStoryId.get(storyId))
    .filter((packet): packet is FactoryWorkPacket => Boolean(packet));
}

function resolveStageId(factory: FactoryRunState, phaseId: string) {
  return (
    factory.completionContract.phases.find((phase) => phase.phaseId === phaseId)?.stageId ??
    factory.currentStage
  );
}

function isPacketSafeForParallel(packet: Pick<FactoryWorkPacket, "fileTargets" | "domainTargets">) {
  return packet.fileTargets.length > 0 || packet.domainTargets.length > 0;
}

function hasIncompleteDependencies(
  phaseExecution: PhaseExecutionState,
  packet: Pick<FactoryWorkPacket, "dependencyIds">
) {
  return hasIncompleteTaskDependencies(phaseExecution, packet.dependencyIds);
}

function hasIncompleteTaskDependencies(
  phaseExecution: PhaseExecutionState,
  dependencyIds: string[]
) {
  return dependencyIds.some((dependencyId) => !isTaskCompleted(phaseExecution, dependencyId));
}

function isTaskCompleted(phaseExecution: PhaseExecutionState, taskId: string) {
  return phaseExecution.phases.some((phase) =>
    phase.userStories.some((story) =>
      story.tasks.some((task) => task.id === taskId && task.status === "completed")
    )
  );
}

function packetsOverlap(left: FactoryWorkPacket, right: FactoryWorkPacket) {
  return (
    intersection(left.fileTargets, right.fileTargets).length > 0 ||
    intersection(left.domainTargets, right.domainTargets).length > 0
  );
}

function findOpenConflictIdsForHandoff(
  controlPlane: ControlPlaneState | null,
  handoffId: string
) {
  return uniqueStrings(
    findOpenScopeConflictsForHandoff(controlPlane, handoffId).map((conflict) => conflict.id)
  );
}

function findConflictIdsForPacketPair(
  controlPlane: ControlPlaneState | null,
  leftHandoffId: string,
  rightHandoffId: string
) {
  return uniqueStrings(
    (controlPlane?.conflicts ?? [])
      .filter(
        (conflict) =>
          conflict.relatedHandoffIds.includes(leftHandoffId) &&
          conflict.relatedHandoffIds.includes(rightHandoffId)
      )
      .map((conflict) => conflict.id)
  );
}

function derivePacketStatus(input: {
  storyStatus: Phase["status"];
  hasIncompleteDependencies: boolean;
  isRunning: boolean;
  isBlockedByRunningPacket: boolean;
  isCompleted: boolean;
}): FactoryWorkPacket["status"] {
  if (input.isCompleted || input.storyStatus === "completed") {
    return "completed";
  }

  if (input.isRunning || input.storyStatus === "in_progress") {
    return "running";
  }

  if (input.hasIncompleteDependencies || input.isBlockedByRunningPacket) {
    return "blocked";
  }

  return "ready";
}

function derivePacketStatusSummary(input: {
  storyStatus: Phase["status"];
  hasIncompleteDependencies: boolean;
  isRunning: boolean;
  isBlockedByRunningPacket: boolean;
  hasScope: boolean;
}) {
  if (input.isRunning || input.storyStatus === "in_progress") {
    return "Packet is actively executing.";
  }

  if (input.hasIncompleteDependencies) {
    return "Packet is waiting for upstream dependencies to complete.";
  }

  if (input.isBlockedByRunningPacket) {
    return "Packet is serialized behind an overlapping packet.";
  }

  if (!input.hasScope) {
    return "Packet lacks isolated file or domain scope and must run sequentially.";
  }

  return "Packet is ready for safe execution.";
}

function packetIdForStoryId(storyId: string) {
  return `factory-work-packet:${storyId}`;
}

function packetIdForHandoffId(handoffId: string) {
  return handoffId.startsWith("handoff:story:")
    ? packetIdForStoryId(handoffId.slice("handoff:story:".length))
    : `factory-work-packet:${handoffId}`;
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((value) => rightSet.has(value)));
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
