import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { cloneRunRecord, type AgentRunRecord, type AgentRunStore } from "./types";

type CreateFileRunStoreOptions = {
  filePath: string;
};

type StoredRunState = {
  version: 1;
  runs: AgentRunRecord[];
};

const STORE_VERSION = 1;

export function createFileRunStore(options: CreateFileRunStoreOptions): AgentRunStore {
  const resolvedPath = path.resolve(options.filePath);
  const runs = new Map<string, AgentRunRecord>(
    readStoredRuns(resolvedPath).map((run) => [run.id, cloneRunRecord(run)])
  );

  function persist() {
    const directoryPath = path.dirname(resolvedPath);
    const tempPath = `${resolvedPath}.tmp`;
    const payload: StoredRunState = {
      version: STORE_VERSION,
      runs: Array.from(runs.values()).map(cloneRunRecord)
    };

    mkdirSync(directoryPath, { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempPath, resolvedPath);
  }

  return {
    create(run) {
      runs.set(run.id, cloneRunRecord(run));
      persist();
    },
    update(run) {
      if (!runs.has(run.id)) {
        throw new Error(`Cannot update unknown run: ${run.id}`);
      }

      runs.set(run.id, cloneRunRecord(run));
      persist();
    },
    get(id) {
      const run = runs.get(id);

      return run ? cloneRunRecord(run) : null;
    },
    list() {
      return Array.from(runs.values()).reverse().map(cloneRunRecord);
    }
  };
}

function readStoredRuns(filePath: string): AgentRunRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown runtime state parse failure.";
    throw new Error(`Failed to parse runtime state at ${filePath}: ${message}`);
  }

  if (!isStoredRunState(parsed)) {
    throw new Error(`Runtime state at ${filePath} is not a valid run store payload.`);
  }

  return parsed.runs.map(cloneRunRecord);
}

function isStoredRunState(value: unknown): value is StoredRunState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredRunState>;

  return candidate.version === STORE_VERSION && Array.isArray(candidate.runs);
}
