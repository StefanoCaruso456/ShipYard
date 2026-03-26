import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  normalizeExternalSyncState,
  type AgentRunRecord,
  type ExternalRecordLink,
  type ExternalRecordMirror,
  type ExternalRecordMirrorDetail,
  type ExternalRecordSyncService,
  type ExternalSyncAction,
  type ExternalSyncState
} from "@shipyard/agent-core";

type CreateFileExternalRecordSyncServiceOptions = {
  filePath: string;
};

type StoredExternalRecordState = {
  version: 1;
  provider: "file_mirror";
  records: ExternalRecordMirrorDetail[];
};

const STORE_VERSION = 1;

export function createFileExternalRecordSyncService(
  options: CreateFileExternalRecordSyncServiceOptions
): ExternalRecordSyncService {
  const resolvedPath = path.resolve(options.filePath);
  const records = new Map<string, ExternalRecordMirrorDetail>(
    readStoredRecords(resolvedPath).map((record) => [record.externalId, cloneRecord(record)])
  );

  function persist() {
    const directoryPath = path.dirname(resolvedPath);
    const tempPath = `${resolvedPath}.tmp`;
    const payload: StoredExternalRecordState = {
      version: STORE_VERSION,
      provider: "file_mirror",
      records: Array.from(records.values()).map(cloneRecord)
    };

    mkdirSync(directoryPath, { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempPath, resolvedPath);
  }

  return {
    descriptor: {
      providerId: "file_mirror",
      location: resolvedPath
    },
    async syncRun(run) {
      const state = normalizeExternalSyncState(run.externalSync);
      const nextState: ExternalSyncState = {
        ...state,
        status: "ready",
        lastError: null
      };
      const pendingActions = nextState.actions.filter((action) => action.status !== "completed");
      let lastSyncedAt = nextState.lastSyncedAt;
      let firstError: string | null = null;

      for (const action of pendingActions) {
        const attemptedAt = new Date().toISOString();

        try {
          const externalRecordId = applyAction(records, run, action, attemptedAt);
          action.status = "completed";
          action.attempts += 1;
          action.lastAttemptAt = attemptedAt;
          action.completedAt = attemptedAt;
          action.error = null;
          action.externalRecordId = externalRecordId;
          lastSyncedAt = attemptedAt;
        } catch (error) {
          action.status = "failed";
          action.attempts += 1;
          action.lastAttemptAt = attemptedAt;
          action.error = error instanceof Error ? error.message : "External record sync failed.";
          firstError ??= action.error;
        }
      }

      persist();

      return {
        ...nextState,
        status: firstError ? "degraded" : "ready",
        lastError: firstError,
        lastSyncedAt,
        records: listRecordsForRun(records, run.id)
      };
    },
    async listRecords() {
      return Array.from(records.values())
        .map(cloneRecord)
        .sort((left, right) => right.lastSyncedAt?.localeCompare(left.lastSyncedAt ?? "") ?? -1);
    },
    async getRecord(externalId) {
      const record = records.get(externalId);

      return record ? cloneRecord(record) : null;
    }
  };
}

function applyAction(
  records: Map<string, ExternalRecordMirrorDetail>,
  run: AgentRunRecord,
  action: ExternalSyncAction,
  syncedAt: string
) {
  switch (action.kind) {
    case "upsert_record":
      return upsertRecord(records, run, action, syncedAt);
    case "append_update":
      return appendRecordUpdate(records, run, action, syncedAt);
    case "attach_link":
      return attachRecordLink(records, run, action, syncedAt);
    default:
      return upsertRecord(records, run, action, syncedAt);
  }
}

function upsertRecord(
  records: Map<string, ExternalRecordMirrorDetail>,
  run: AgentRunRecord,
  action: ExternalSyncAction,
  syncedAt: string
) {
  if (action.payload.kind !== "upsert_record") {
    throw new Error(`Action ${action.id} does not contain an upsert_record payload.`);
  }

  const externalId = toExternalId(run.id, action.entityKind, action.entityId);
  const parentExternalId =
    action.payload.parentEntityKind && action.payload.parentEntityId
      ? toExternalId(run.id, action.payload.parentEntityKind, action.payload.parentEntityId)
      : null;
  const existing = records.get(externalId);
  const next: ExternalRecordMirrorDetail = existing
    ? cloneRecord(existing)
    : {
        externalId,
        provider: "file_mirror",
        runId: run.id,
        entityKind: action.entityKind,
        entityId: action.entityId,
        title: action.payload.title,
        status: action.payload.status,
        summary: action.payload.summary,
        parentExternalId,
        childExternalIds: [],
        links: [],
        lastSyncedAt: syncedAt,
        lastUpdateSummary: null,
        updateCount: 0,
        updates: []
      };

  next.title = action.payload.title;
  next.status = action.payload.status;
  next.summary = action.payload.summary;
  next.parentExternalId = parentExternalId;
  next.lastSyncedAt = syncedAt;
  records.set(externalId, next);

  if (parentExternalId) {
    ensureParentChildLink(records, parentExternalId, externalId);
  }

  return externalId;
}

function appendRecordUpdate(
  records: Map<string, ExternalRecordMirrorDetail>,
  run: AgentRunRecord,
  action: ExternalSyncAction,
  syncedAt: string
) {
  if (action.payload.kind !== "append_update") {
    throw new Error(`Action ${action.id} does not contain an append_update payload.`);
  }

  const externalId = toExternalId(run.id, action.entityKind, action.entityId);
  const record = ensureRecord(records, run.id, action.entityKind, action.entityId, syncedAt);

  if (!record.updates.some((update) => update.actionId === action.id)) {
    record.updates.push({
      id: `${action.id}:update`,
      kind: action.payload.updateKind,
      summary: action.payload.summary,
      status: action.payload.status,
      at: action.payload.occurredAt,
      actionId: action.id
    });
    record.updateCount = record.updates.length;
    record.lastUpdateSummary = action.payload.summary;
  }

  if (action.payload.status) {
    record.status = action.payload.status;
  }

  record.lastSyncedAt = syncedAt;
  records.set(externalId, record);

  return externalId;
}

function attachRecordLink(
  records: Map<string, ExternalRecordMirrorDetail>,
  run: AgentRunRecord,
  action: ExternalSyncAction,
  syncedAt: string
) {
  if (action.payload.kind !== "attach_link") {
    throw new Error(`Action ${action.id} does not contain an attach_link payload.`);
  }

  const payload = action.payload;

  const externalId = toExternalId(run.id, action.entityKind, action.entityId);
  const record = ensureRecord(records, run.id, action.entityKind, action.entityId, syncedAt);

  if (!record.links.some((link) => link.id === payload.link.id)) {
    const link: ExternalRecordLink = {
      ...payload.link,
      syncedAt
    };
    record.links.push(link);
    record.lastUpdateSummary = `${humanizeLinkKind(link.kind)} linked`;
    record.updateCount += 1;
    record.updates.push({
      id: `${action.id}:link`,
      kind: "link",
      summary: `${humanizeLinkKind(link.kind)} linked`,
      status: record.status,
      at: syncedAt,
      actionId: action.id
    });
  }

  record.lastSyncedAt = syncedAt;
  records.set(externalId, record);

  return externalId;
}

function ensureRecord(
  records: Map<string, ExternalRecordMirrorDetail>,
  runId: string,
  entityKind: ExternalRecordMirrorDetail["entityKind"],
  entityId: string,
  syncedAt: string
) {
  const externalId = toExternalId(runId, entityKind, entityId);
  const existing = records.get(externalId);

  if (existing) {
    return cloneRecord(existing);
  }

  const record: ExternalRecordMirrorDetail = {
    externalId,
    provider: "file_mirror",
    runId,
    entityKind,
    entityId,
    title: `${entityKind}:${entityId}`,
    status: "pending",
    summary: `${entityKind} ${entityId}`,
    parentExternalId: null,
    childExternalIds: [],
    links: [],
    lastSyncedAt: syncedAt,
    lastUpdateSummary: null,
    updateCount: 0,
    updates: []
  };

  records.set(externalId, record);
  return cloneRecord(record);
}

function ensureParentChildLink(
  records: Map<string, ExternalRecordMirrorDetail>,
  parentExternalId: string,
  childExternalId: string
) {
  const parent = records.get(parentExternalId);

  if (!parent) {
    return;
  }

  if (!parent.childExternalIds.includes(childExternalId)) {
    parent.childExternalIds = [...parent.childExternalIds, childExternalId];
    records.set(parentExternalId, cloneRecord(parent));
  }
}

function listRecordsForRun(
  records: Map<string, ExternalRecordMirrorDetail>,
  runId: string
): ExternalRecordMirror[] {
  return Array.from(records.values())
    .filter((record) => record.runId === runId)
    .sort((left, right) => left.externalId.localeCompare(right.externalId))
    .map(toMirrorRecord);
}

function toMirrorRecord(record: ExternalRecordMirrorDetail): ExternalRecordMirror {
  return {
    externalId: record.externalId,
    provider: record.provider,
    entityKind: record.entityKind,
    entityId: record.entityId,
    title: record.title,
    status: record.status,
    summary: record.summary,
    parentExternalId: record.parentExternalId,
    childExternalIds: [...record.childExternalIds],
    links: record.links.map(cloneLink),
    lastSyncedAt: record.lastSyncedAt,
    lastUpdateSummary: record.lastUpdateSummary,
    updateCount: record.updateCount
  };
}

function readStoredRecords(filePath: string): ExternalRecordMirrorDetail[] {
  if (!existsSync(filePath)) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown external record state parse failure.";
    throw new Error(`Failed to parse external record state at ${filePath}: ${message}`);
  }

  if (!isStoredExternalRecordState(parsed)) {
    throw new Error(`External record state at ${filePath} is not a valid payload.`);
  }

  return parsed.records.map(cloneRecord);
}

function isStoredExternalRecordState(value: unknown): value is StoredExternalRecordState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredExternalRecordState>;

  return (
    candidate.version === STORE_VERSION &&
    candidate.provider === "file_mirror" &&
    Array.isArray(candidate.records)
  );
}

function toExternalId(
  runId: string,
  entityKind: ExternalRecordMirrorDetail["entityKind"],
  entityId: string
) {
  return `file-mirror:${runId}:${entityKind}:${entityId}`;
}

function humanizeLinkKind(kind: ExternalRecordLink["kind"]) {
  if (kind === "repository") {
    return "Repository";
  }

  return kind === "pull_request" ? "Pull request" : "Deployment";
}

function cloneRecord(record: ExternalRecordMirrorDetail): ExternalRecordMirrorDetail {
  return structuredClone(record);
}

function cloneLink(link: ExternalRecordLink): ExternalRecordLink {
  return structuredClone(link);
}
