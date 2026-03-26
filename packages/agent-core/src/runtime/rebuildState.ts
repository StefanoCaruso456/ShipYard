import type {
  AgentRunStatus,
  ControlPlaneState,
  PhaseExecutionProgress,
  PhaseExecutionRetryPolicy,
  PhaseExecutionState,
  RebuildArtifactRecord,
  RebuildInput,
  RebuildInterventionRecord,
  RebuildScope,
  RebuildState,
  RebuildStatus,
  RebuildTarget,
  RebuildTargetInput
} from "./types";
import type { ValidationStatus } from "../validation/types";

type NormalizeRebuildStateOptions = {
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  runStatus?: AgentRunStatus | null;
  validationStatus?: ValidationStatus | null;
  updatedAt?: string | null;
  lastFailureReason?: string | null;
};

const EMPTY_POINTER = {
  phaseId: null,
  storyId: null,
  taskId: null
} as const;

export function createRebuildState(
  input: RebuildInput,
  options: NormalizeRebuildStateOptions = {}
): RebuildState {
  const rebuild = normalizeRebuildState(input, options);

  if (!rebuild) {
    throw new Error("Rebuild target metadata is required.");
  }

  return rebuild;
}

export function normalizeRebuildState(
  value: RebuildInput | RebuildState | null | undefined,
  options: NormalizeRebuildStateOptions = {}
): RebuildState | null {
  if (!value) {
    return null;
  }

  const existing = isRebuildState(value) ? value : null;
  const target = normalizeTarget(value.target);

  if (!target) {
    return null;
  }

  const artifactLog = options.controlPlane
    ? mapArtifactLog(options.controlPlane)
    : normalizeArtifactLog(existing?.artifactLog);
  const interventionLog = options.controlPlane
    ? mapInterventionLog(options.controlPlane)
    : normalizeInterventionLog(existing?.interventionLog);
  const progress = cloneProgress(options.phaseExecution?.progress ?? existing?.progress ?? null);
  const retryPolicy = cloneRetryPolicy(
    options.phaseExecution?.retryPolicy ?? existing?.retryPolicy ?? null
  );
  const status = deriveStatus(
    options.runStatus,
    options.phaseExecution?.status ?? null,
    existing?.status ?? null
  );
  const updatedAt = trimOrNull(options.updatedAt) ?? existing?.updatedAt ?? new Date().toISOString();

  return {
    version: 1,
    status,
    target,
    current: options.phaseExecution?.current
      ? {
          ...options.phaseExecution.current
        }
      : {
          ...EMPTY_POINTER
        },
    progress,
    retryPolicy,
    artifactLog,
    interventionLog,
    validationStatus: options.validationStatus ?? existing?.validationStatus ?? null,
    lastArtifactAt: artifactLog[artifactLog.length - 1]?.createdAt ?? null,
    lastInterventionAt: interventionLog[interventionLog.length - 1]?.createdAt ?? null,
    lastFailureReason:
      trimOrNull(options.lastFailureReason) ??
      trimOrNull(options.phaseExecution?.lastFailureReason) ??
      trimOrNull(options.controlPlane?.lastFailureReason) ??
      trimOrNull(existing?.lastFailureReason),
    updatedAt
  };
}

function isRebuildState(value: RebuildInput | RebuildState): value is RebuildState {
  return "status" in value && "artifactLog" in value && "interventionLog" in value;
}

function normalizeTarget(input: RebuildTargetInput): RebuildTarget | null {
  const shipId = trimOrNull(input.shipId);

  if (!shipId) {
    return null;
  }

  return {
    scope: normalizeScope(input.scope),
    shipId,
    label: trimOrNull(input.label),
    objective: trimOrNull(input.objective),
    projectId: trimOrNull(input.projectId),
    rootPath: trimOrNull(input.rootPath),
    baseBranch: trimOrNull(input.baseBranch),
    entryPaths: normalizeStringArray(input.entryPaths),
    acceptanceSummary: trimOrNull(input.acceptanceSummary)
  };
}

function normalizeScope(scope: RebuildTargetInput["scope"]): RebuildScope {
  return scope === "project" || scope === "workspace" ? scope : "ship";
}

function normalizeArtifactLog(
  artifacts: RebuildState["artifactLog"] | null | undefined
): RebuildArtifactRecord[] {
  return Array.isArray(artifacts)
    ? artifacts
        .filter(
          (artifact) =>
            typeof artifact?.id === "string" &&
            artifact.id.trim() &&
            typeof artifact.sourceArtifactId === "string" &&
            artifact.sourceArtifactId.trim()
        )
        .map((artifact) => ({
          id: artifact.id.trim(),
          sourceArtifactId: artifact.sourceArtifactId.trim(),
          kind: artifact.kind,
          entityKind: artifact.entityKind,
          entityId: artifact.entityId.trim(),
          summary: artifact.summary.trim(),
          createdAt: artifact.createdAt,
          producerRole: artifact.producerRole,
          producerId: artifact.producerId.trim(),
          path: trimOrNull(artifact.path)
        }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
}

function normalizeInterventionLog(
  interventions: RebuildState["interventionLog"] | null | undefined
): RebuildInterventionRecord[] {
  return Array.isArray(interventions)
    ? interventions
        .filter(
          (intervention) =>
            typeof intervention?.id === "string" &&
            intervention.id.trim() &&
            typeof intervention.sourceInterventionId === "string" &&
            intervention.sourceInterventionId.trim()
        )
        .map((intervention) => ({
          id: intervention.id.trim(),
          sourceInterventionId: intervention.sourceInterventionId.trim(),
          kind: intervention.kind,
          entityKind: intervention.entityKind,
          entityId: intervention.entityId.trim(),
          summary: intervention.summary.trim(),
          createdAt: intervention.createdAt,
          resolvedAt: trimOrNull(intervention.resolvedAt),
          ownerRole: intervention.ownerRole,
          ownerId: intervention.ownerId.trim()
        }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
}

function mapArtifactLog(controlPlane: ControlPlaneState): RebuildArtifactRecord[] {
  return controlPlane.artifacts
    .map((artifact) => ({
      id: `rebuild-artifact:${artifact.id}`,
      sourceArtifactId: artifact.id,
      kind: artifact.kind,
      entityKind: artifact.entityKind,
      entityId: artifact.entityId,
      summary: artifact.summary,
      createdAt: artifact.createdAt,
      producerRole: artifact.producerRole,
      producerId: artifact.producerId,
      path: trimOrNull(artifact.path)
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function mapInterventionLog(controlPlane: ControlPlaneState): RebuildInterventionRecord[] {
  return controlPlane.interventions
    .map((intervention) => ({
      id: `rebuild-intervention:${intervention.id}`,
      sourceInterventionId: intervention.id,
      kind: intervention.kind,
      entityKind: intervention.entityKind,
      entityId: intervention.entityId,
      summary: intervention.summary,
      createdAt: intervention.createdAt,
      resolvedAt: trimOrNull(intervention.resolvedAt),
      ownerRole: intervention.ownerRole,
      ownerId: intervention.ownerId
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function deriveStatus(
  runStatus: AgentRunStatus | null | undefined,
  phaseStatus: PhaseExecutionState["status"] | null,
  existingStatus: RebuildStatus | null
): RebuildStatus {
  if (runStatus === "completed") {
    return "completed";
  }

  if (runStatus === "failed") {
    return "failed";
  }

  if (runStatus === "running") {
    return "rebuilding";
  }

  if (runStatus === "pending") {
    return "queued";
  }

  if (phaseStatus === "completed") {
    return "completed";
  }

  if (phaseStatus === "failed") {
    return "failed";
  }

  if (phaseStatus === "in_progress") {
    return "rebuilding";
  }

  if (phaseStatus === "pending") {
    return "queued";
  }

  return existingStatus ?? "queued";
}

function cloneProgress(progress: PhaseExecutionProgress | null | undefined) {
  return progress
    ? {
        ...progress
      }
    : null;
}

function cloneRetryPolicy(retryPolicy: PhaseExecutionRetryPolicy | null | undefined) {
  return retryPolicy
    ? {
        ...retryPolicy
      }
    : null;
}

function normalizeStringArray(values: string[] | null | undefined) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    : [];
}

function trimOrNull(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
