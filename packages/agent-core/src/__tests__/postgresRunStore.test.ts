import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresRunStore } from "../runtime/createPostgresRunStore";
import type { AgentRunRecord } from "../runtime/types";

test("postgres run store persists runs through the queryable client", async () => {
  const queryable = createFakeQueryable();
  const firstStore = createPostgresRunStore({
    queryable,
    schemaName: "shipyard_runtime",
    tableName: "agent_runs_test"
  });
  const run = createRun({
    id: "run-postgres",
    status: "pending"
  });

  await firstStore.create(run);
  await firstStore.update({
    ...run,
    status: "completed",
    completedAt: "2026-03-24T12:05:00.000Z",
    result: {
      mode: "placeholder-execution",
      summary: "persisted in postgres",
      instructionEcho: run.instruction,
      skillId: "coding-agent",
      completedAt: "2026-03-24T12:05:00.000Z"
    }
  });

  const secondStore = createPostgresRunStore({
    queryable,
    schemaName: "shipyard_runtime",
    tableName: "agent_runs_test"
  });
  const loadedRuns = await secondStore.load();
  const persisted = await secondStore.get(run.id);

  assert.equal(loadedRuns[0]?.id, run.id);
  assert.equal(persisted?.status, "completed");
  assert.equal(persisted?.result?.summary, "persisted in postgres");
});

function createRun(
  overrides: Partial<AgentRunRecord> & Pick<AgentRunRecord, "id" | "status">
): AgentRunRecord {
  return {
    id: overrides.id,
    threadId: overrides.threadId ?? overrides.id,
    parentRunId: overrides.parentRunId ?? null,
    title: overrides.title ?? "Stored run",
    instruction: overrides.instruction ?? `${overrides.id} instruction`,
    simulateFailure: overrides.simulateFailure ?? false,
    toolRequest: overrides.toolRequest ?? null,
    attachments: overrides.attachments ?? [],
    context: overrides.context ?? {
      objective: null,
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: []
    },
    status: overrides.status,
    createdAt: overrides.createdAt ?? "2026-03-24T12:00:00.000Z",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    retryCount: overrides.retryCount ?? 0,
    validationStatus: overrides.validationStatus ?? "not_run",
    lastValidationResult: overrides.lastValidationResult ?? null,
    orchestration: overrides.orchestration ?? null,
    phaseExecution: overrides.phaseExecution ?? null,
    rollingSummary: overrides.rollingSummary ?? null,
    events: overrides.events ?? [],
    error: overrides.error ?? null,
    result: overrides.result ?? null
  };
}

function createFakeQueryable() {
  const rows = new Map<
    string,
    {
      id: string;
      status: string;
      title: string | null;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
      updated_at: string;
      run_json: AgentRunRecord;
    }
  >();

  return {
    async query(text: string, values: readonly unknown[] = []) {
      if (
        text.includes("CREATE SCHEMA") ||
        text.includes("CREATE TABLE") ||
        text.includes("CREATE INDEX")
      ) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (text.includes("INSERT INTO")) {
        const [
          id,
          status,
          title,
          createdAt,
          startedAt,
          completedAt,
          updatedAt,
          runJson
        ] = values as [
          string,
          string,
          string | null,
          string,
          string | null,
          string | null,
          string,
          string
        ];

        rows.set(id, {
          id,
          status,
          title,
          created_at: createdAt,
          started_at: startedAt,
          completed_at: completedAt,
          updated_at: updatedAt,
          run_json: JSON.parse(runJson) as AgentRunRecord
        });

        return {
          rows: [],
          rowCount: 1
        };
      }

      if (text.includes("UPDATE")) {
        const [
          id,
          status,
          title,
          createdAt,
          startedAt,
          completedAt,
          updatedAt,
          runJson
        ] = values as [
          string,
          string,
          string | null,
          string,
          string | null,
          string | null,
          string,
          string
        ];

        if (!rows.has(id)) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        rows.set(id, {
          id,
          status,
          title,
          created_at: createdAt,
          started_at: startedAt,
          completed_at: completedAt,
          updated_at: updatedAt,
          run_json: JSON.parse(runJson) as AgentRunRecord
        });

        return {
          rows: [],
          rowCount: 1
        };
      }

      if (text.includes("WHERE id = $1")) {
        const row = rows.get(String(values[0]));

        return {
          rows: row ? [{ run_json: row.run_json }] : [],
          rowCount: row ? 1 : 0
        };
      }

      if (text.includes("ORDER BY created_at DESC")) {
        return {
          rows: Array.from(rows.values())
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .map((row) => ({
              run_json: row.run_json
            })),
          rowCount: rows.size
        };
      }

      throw new Error(`Unexpected query in fake queryable: ${text}`);
    }
  };
}
