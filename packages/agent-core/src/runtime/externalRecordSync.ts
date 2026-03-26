import { createHash } from "node:crypto";

import type {
  AgentRunRecord,
  ExternalRecordEntityKind,
  ExternalRecordLink,
  ExternalRecordStatus,
  ExternalSyncAction,
  ExternalSyncActionKind,
  ExternalSyncActionPayload,
  ExternalSyncState,
  Phase,
  RunProjectLinkInput,
  Task,
  UserStory
} from "./types";
import type { RunEvent } from "../validation/types";

const EXTERNAL_SYNC_PROVIDER = "file_mirror" as const;
const EXTERNAL_SYNC_VERSION = 1 as const;

type ExternalEntityDescriptor = {
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  title: string;
  status: ExternalRecordStatus;
  summary: string;
  parentEntityKind: ExternalRecordEntityKind | null;
  parentEntityId: string | null;
};

export function normalizeExternalSyncState(
  value: AgentRunRecord["externalSync"]
): ExternalSyncState {
  if (!value) {
    return {
      version: EXTERNAL_SYNC_VERSION,
      provider: EXTERNAL_SYNC_PROVIDER,
      status: "idle",
      lastSyncedAt: null,
      lastError: null,
      actions: [],
      records: []
    };
  }

  return {
    version: EXTERNAL_SYNC_VERSION,
    provider: value.provider === EXTERNAL_SYNC_PROVIDER ? EXTERNAL_SYNC_PROVIDER : EXTERNAL_SYNC_PROVIDER,
    status:
      value.status === "ready" || value.status === "degraded" || value.status === "idle"
        ? value.status
        : "idle",
    lastSyncedAt: value.lastSyncedAt ?? null,
    lastError: value.lastError?.trim() ? value.lastError.trim() : null,
    actions: Array.isArray(value.actions)
      ? value.actions.map((action) => ({
          id: action.id,
          dedupeKey: action.dedupeKey,
          provider: EXTERNAL_SYNC_PROVIDER,
          entityKind: normalizeEntityKind(action.entityKind),
          entityId: action.entityId,
          kind: normalizeActionKind(action.kind),
          status:
            action.status === "completed" || action.status === "failed" ? action.status : "pending",
          payload: action.payload,
          attempts: typeof action.attempts === "number" ? action.attempts : 0,
          lastAttemptAt: action.lastAttemptAt ?? null,
          completedAt: action.completedAt ?? null,
          error: action.error?.trim() ? action.error.trim() : null,
          externalRecordId: action.externalRecordId ?? null
        }))
      : [],
    records: Array.isArray(value.records)
      ? value.records.map((record) => ({
          externalId: record.externalId,
          provider: EXTERNAL_SYNC_PROVIDER,
          entityKind: normalizeEntityKind(record.entityKind),
          entityId: record.entityId,
          title: record.title,
          status: record.status,
          summary: record.summary,
          parentExternalId: record.parentExternalId ?? null,
          childExternalIds: Array.isArray(record.childExternalIds) ? uniqueStrings(record.childExternalIds) : [],
          links: normalizeExternalLinks(record.links),
          lastSyncedAt: record.lastSyncedAt ?? null,
          lastUpdateSummary: record.lastUpdateSummary ?? null,
          updateCount: typeof record.updateCount === "number" ? record.updateCount : 0
        }))
      : []
  };
}

export function reconcileExternalSyncState(run: AgentRunRecord): ExternalSyncState {
  const normalized = normalizeExternalSyncState(run.externalSync);
  const existingByDedupe = new Map(normalized.actions.map((action) => [action.dedupeKey, action]));
  const desired = buildDesiredActions(run);
  const actions = [...normalized.actions];

  for (const action of desired) {
    if (!existingByDedupe.has(action.dedupeKey)) {
      actions.push(action);
      existingByDedupe.set(action.dedupeKey, action);
    }
  }

  return {
    ...normalized,
    actions: actions.sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function normalizeProjectLinks(
  links: RunProjectLinkInput[] | null | undefined
): RunProjectLinkInput[] {
  if (!Array.isArray(links)) {
    return [];
  }

  return links
    .filter((link) => typeof link?.url === "string" && link.url.trim())
    .filter((link) => link.kind === "pull_request" || link.kind === "deployment")
    .map((link) => {
      const url = link.url.trim();
      return {
        id: link.id?.trim() ? link.id.trim() : createStableId(`link:${link.kind}:${url}`),
        kind: link.kind,
        url,
        title: link.title?.trim() ? link.title.trim() : null,
        provider: link.provider?.trim() ? link.provider.trim() : null,
        entityKind: normalizeEntityKind(link.entityKind ?? "run"),
        entityId: link.entityId?.trim() ? link.entityId.trim() : null
      };
    });
}

function buildDesiredActions(run: AgentRunRecord): ExternalSyncAction[] {
  const actions: ExternalSyncAction[] = [];

  for (const entity of buildEntityDescriptors(run)) {
    actions.push(
      createAction({
        entityKind: entity.entityKind,
        entityId: entity.entityId,
        kind: "upsert_record",
        payload: {
          kind: "upsert_record",
          title: entity.title,
          status: entity.status,
          summary: entity.summary,
          parentEntityKind: entity.parentEntityKind,
          parentEntityId: entity.parentEntityId
        }
      })
    );
  }

  for (const event of run.events) {
    const descriptor = toEventDescriptor(event);

    if (!descriptor) {
      continue;
    }

    actions.push(
      createAction({
        entityKind: descriptor.entityKind,
        entityId: descriptor.entityId,
        occurredAt: descriptor.occurredAt,
        kind: "append_update",
        payload: {
          kind: "append_update",
          updateKind: descriptor.updateKind,
          summary: descriptor.summary,
          status: deriveEventStatus(event),
          occurredAt: descriptor.occurredAt
        }
      })
    );
  }

  for (const blocker of run.controlPlane?.blockers ?? []) {
    actions.push(
      createAction({
        entityKind: normalizeEntityKind(blocker.entityKind),
        entityId: blocker.entityId,
        occurredAt: blocker.createdAt,
        kind: "append_update",
        payload: {
          kind: "append_update",
          updateKind: "blocker",
          summary: blocker.summary,
          status: "blocked",
          occurredAt: blocker.createdAt
        },
        suffix: `blocker:${blocker.id}:opened`
      })
    );

    if (blocker.resolvedAt) {
      actions.push(
        createAction({
          entityKind: normalizeEntityKind(blocker.entityKind),
          entityId: blocker.entityId,
          occurredAt: blocker.resolvedAt,
          kind: "append_update",
          payload: {
            kind: "append_update",
            updateKind: "blocker",
            summary: `${blocker.summary} (resolved)`,
            status: null,
            occurredAt: blocker.resolvedAt
          },
          suffix: `blocker:${blocker.id}:resolved`
        })
      );
    }
  }

  for (const link of normalizeProjectLinks(run.project?.links)) {
    const entityKind = link.entityKind ?? "run";
    const entityId = link.entityId?.trim() ? link.entityId.trim() : run.id;
    const linkPayload: Omit<ExternalRecordLink, "syncedAt"> = {
      id: link.id?.trim() ? link.id.trim() : createStableId(`link:${link.kind}:${link.url}`),
      kind: link.kind,
      url: link.url.trim(),
      title: link.title?.trim() ? link.title.trim() : null,
      provider: link.provider?.trim() ? link.provider.trim() : null,
      entityKind,
      entityId
    };

    actions.push(
      createAction({
        entityKind,
        entityId,
        kind: "attach_link",
        payload: {
          kind: "attach_link",
          link: linkPayload
        },
        suffix: `link:${link.kind}:${createStableId(link.url)}`
      })
    );
  }

  return actions;
}

function buildEntityDescriptors(run: AgentRunRecord): ExternalEntityDescriptor[] {
  const descriptors: ExternalEntityDescriptor[] = [
    {
      entityKind: "run",
      entityId: run.id,
      title: run.title?.trim() || summarizeText(run.instruction, 72),
      status: run.status,
      summary: summarizeRun(run),
      parentEntityKind: null,
      parentEntityId: null
    }
  ];

  for (const phase of run.phaseExecution?.phases ?? []) {
    descriptors.push({
      entityKind: "phase",
      entityId: phase.id,
      title: phase.name,
      status: phase.status,
      summary: summarizePhase(phase),
      parentEntityKind: "run",
      parentEntityId: run.id
    });

    for (const story of phase.userStories) {
      descriptors.push({
        entityKind: "story",
        entityId: story.id,
        title: story.title,
        status: story.status,
        summary: summarizeStory(story),
        parentEntityKind: "phase",
        parentEntityId: phase.id
      });

      for (const task of story.tasks) {
        descriptors.push({
          entityKind: "task",
          entityId: task.id,
          title: summarizeText(task.instruction, 72),
          status: task.status === "running" ? "running" : task.status,
          summary: summarizeTask(task),
          parentEntityKind: "story",
          parentEntityId: story.id
        });
      }
    }
  }

  return descriptors;
}

function summarizeRun(run: AgentRunRecord) {
  if (run.rollingSummary?.text?.trim()) {
    return run.rollingSummary.text.trim();
  }

  if (run.result?.summary?.trim()) {
    return run.result.summary.trim();
  }

  if (run.error?.message?.trim()) {
    return run.error.message.trim();
  }

  return summarizeText(run.instruction, 120);
}

function summarizePhase(phase: Phase) {
  if (phase.failureReason?.trim()) {
    return phase.failureReason.trim();
  }

  if (phase.lastValidationResults?.length) {
    return phase.lastValidationResults.map((result) => result.message).join(" ");
  }

  return phase.description.trim() || `${phase.name} is ${humanizeStatus(phase.status)}.`;
}

function summarizeStory(story: UserStory) {
  if (story.failureReason?.trim()) {
    return story.failureReason.trim();
  }

  if (story.lastValidationResults?.length) {
    return story.lastValidationResults.map((result) => result.message).join(" ");
  }

  const acceptanceSummary = story.acceptanceCriteria[0]?.trim();

  return acceptanceSummary || story.description.trim() || `${story.title} is ${humanizeStatus(story.status)}.`;
}

function summarizeTask(task: Task) {
  if (task.failureReason?.trim()) {
    return task.failureReason.trim();
  }

  if (task.lastValidationResults?.length) {
    return task.lastValidationResults.map((result) => result.message).join(" ");
  }

  if (task.result?.summary?.trim()) {
    return task.result.summary.trim();
  }

  return task.expectedOutcome.trim() || summarizeText(task.instruction, 120);
}

function toEventDescriptor(event: RunEvent): {
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  occurredAt: string;
  summary: string;
  updateKind: "approval" | "completion" | "failure" | "retry";
} | null {
  switch (event.type) {
    case "approval_gate_waiting":
    case "approval_gate_approved":
    case "approval_gate_rejected":
    case "approval_gate_retry_requested":
      return {
        entityKind: event.phaseId ? "phase" : "run",
        entityId: event.phaseId ?? "run",
        occurredAt: event.at,
        summary: event.message,
        updateKind: "approval"
      };
    case "phase_completed":
    case "story_completed":
    case "task_completed":
      return {
        entityKind: event.taskId ? "task" : event.storyId ? "story" : event.phaseId ? "phase" : "run",
        entityId: event.taskId ?? event.storyId ?? event.phaseId ?? "run",
        occurredAt: event.at,
        summary: event.message,
        updateKind: "completion"
      };
    case "phase_failed":
    case "story_failed":
    case "task_failed":
    case "validation_failed":
    case "rollback_failed":
    case "rollback_succeeded":
    case "execution_failed":
      return {
        entityKind: event.taskId ? "task" : event.storyId ? "story" : event.phaseId ? "phase" : "run",
        entityId: event.taskId ?? event.storyId ?? event.phaseId ?? "run",
        occurredAt: event.at,
        summary: event.message,
        updateKind: "failure"
      };
    case "retry_scheduled":
      return {
        entityKind: event.taskId ? "task" : event.storyId ? "story" : event.phaseId ? "phase" : "run",
        entityId: event.taskId ?? event.storyId ?? event.phaseId ?? "run",
        occurredAt: event.at,
        summary: event.message,
        updateKind: "retry"
      };
    default:
      return null;
  }
}

function deriveEventStatus(event: RunEvent): ExternalRecordStatus | null {
  switch (event.type) {
    case "approval_gate_waiting":
      return "blocked";
    case "approval_gate_approved":
      return "pending";
    case "approval_gate_rejected":
      return "failed";
    case "approval_gate_retry_requested":
      return "pending";
    case "phase_completed":
    case "story_completed":
    case "task_completed":
      return "completed";
    case "phase_failed":
    case "story_failed":
    case "task_failed":
    case "validation_failed":
    case "rollback_failed":
    case "execution_failed":
      return "failed";
    case "rollback_succeeded":
    case "retry_scheduled":
      return "pending";
    default:
      return null;
  }
}

function createAction(input: {
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  kind: ExternalSyncActionKind;
  payload: ExternalSyncActionPayload;
  occurredAt?: string | null;
  suffix?: string | null;
}): ExternalSyncAction {
  const signature = input.suffix?.trim()
    ? input.suffix.trim()
    : createStableId(
        JSON.stringify({
          entityKind: input.entityKind,
          entityId: input.entityId,
          kind: input.kind,
          payload: input.payload
        })
      );
  const dedupeKey = `${input.kind}:${input.entityKind}:${input.entityId}:${signature}`;

  return {
    id: `external-sync:${dedupeKey}`,
    dedupeKey,
    provider: EXTERNAL_SYNC_PROVIDER,
    entityKind: input.entityKind,
    entityId: input.entityId,
    kind: input.kind,
    status: "pending",
    payload: input.payload,
    attempts: 0,
    lastAttemptAt: null,
    completedAt: null,
    error: null,
    externalRecordId: null
  };
}

function normalizeEntityKind(value: string | null | undefined): ExternalRecordEntityKind {
  if (value === "phase" || value === "story" || value === "task") {
    return value;
  }

  return "run";
}

function normalizeActionKind(value: string | null | undefined): ExternalSyncActionKind {
  if (value === "append_update" || value === "attach_link") {
    return value;
  }

  return "upsert_record";
}

function normalizeExternalLinks(value: ExternalRecordLink[] | null | undefined): ExternalRecordLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((link) => typeof link?.url === "string" && link.url.trim())
    .map((link) => ({
      id: link.id,
      kind: link.kind,
      url: link.url.trim(),
      title: link.title?.trim() ? link.title.trim() : null,
      provider: link.provider?.trim() ? link.provider.trim() : null,
      entityKind: normalizeEntityKind(link.entityKind),
      entityId: link.entityId,
      syncedAt: link.syncedAt ?? null
    }));
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function humanizeStatus(status: string) {
  return status.replace(/_/g, " ");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim()).map((value) => value.trim())));
}

function createStableId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}
