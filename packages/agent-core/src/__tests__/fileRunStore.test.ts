import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileRunStore } from "../runtime/createFileRunStore";
import { createPersistentRuntimeService } from "../runtime/createPersistentRuntimeService";
import type { AgentRunRecord, AgentRunResult } from "../runtime/types";
import { createAgentRuntime } from "../runtime/createAgentRuntime";

test("file run store persists runs across store instances", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-run-store-"));
  const filePath = path.join(tempDir, "runs.json");
  const firstStore = createFileRunStore({ filePath });
  const run = createRun({
    id: "run-persisted",
    status: "pending"
  });

  try {
    firstStore.create(run);
    firstStore.update({
      ...run,
      status: "completed",
      completedAt: "2026-03-23T12:05:00.000Z",
      result: {
        mode: "placeholder-execution",
        summary: "stored",
        instructionEcho: run.instruction,
        skillId: "coding-agent",
        completedAt: "2026-03-23T12:05:00.000Z"
      }
    });

    const secondStore = createFileRunStore({ filePath });
    const persisted = secondStore.get(run.id);

    assert.equal(persisted?.status, "completed");
    assert.equal(persisted?.result?.summary, "stored");
    assert.equal(secondStore.list()[0]?.id, run.id);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("persistent runtime recovers pending runs and fails interrupted running runs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-run-recovery-"));
  const filePath = path.join(tempDir, "runs.json");
  const store = createFileRunStore({ filePath });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const completedRuns: string[] = [];

  try {
    store.create(
      createRun({
        id: "pending-run",
        status: "pending",
        startedAt: null
      })
    );
    store.create(
      createRun({
        id: "running-run",
        status: "running",
        startedAt: "2026-03-23T12:01:00.000Z"
      })
    );
    store.create(
      createRun({
        id: "completed-run",
        status: "completed",
        startedAt: "2026-03-23T11:59:00.000Z",
        completedAt: "2026-03-23T12:00:00.000Z",
        result: {
          mode: "placeholder-execution",
          summary: "already done",
          instructionEcho: "finished task",
          skillId: "coding-agent",
          completedAt: "2026-03-23T12:00:00.000Z"
        }
      })
    );

    const runtimeService = createPersistentRuntimeService({
      instructionRuntime,
      store,
      executeRun: async (run, context): Promise<AgentRunResult> => {
        completedRuns.push(run.id);

        return {
          mode: "placeholder-execution",
          summary: `Recovered ${run.id}`,
          instructionEcho: run.instruction,
          skillId: context.instructionRuntime.skill.meta.id,
          completedAt: new Date().toISOString()
        };
      }
    });

    const recoveredPending = await waitForRunStatus(runtimeService, "pending-run", "completed");
    const recoveredRunning = runtimeService.getRun("running-run");
    const untouchedCompleted = runtimeService.getRun("completed-run");

    assert.deepEqual(completedRuns, ["pending-run"]);
    assert.match(recoveredPending.result?.summary ?? "", /Recovered pending-run/);
    assert.equal(recoveredRunning?.status, "failed");
    assert.match(
      recoveredRunning?.error?.message ?? "",
      /Runtime restarted before this run completed/
    );
    assert.equal(untouchedCompleted?.status, "completed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createInstructionRuntimeForTests() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );

  return createAgentRuntime({ skillPath });
}

async function waitForRunStatus(
  runtimeService: ReturnType<typeof createPersistentRuntimeService>,
  runId: string,
  expectedStatus: "completed"
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = runtimeService.getRun(runId);

    if (run?.status === expectedStatus) {
      return run;
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.fail(`Timed out waiting for run ${runId} to reach ${expectedStatus}.`);
}

function createRun(
  overrides: Partial<AgentRunRecord> & Pick<AgentRunRecord, "id" | "status">
): AgentRunRecord {
  return {
    id: overrides.id,
    title: overrides.title ?? "Stored run",
    instruction: overrides.instruction ?? `${overrides.id} instruction`,
    simulateFailure: overrides.simulateFailure ?? false,
    toolRequest: overrides.toolRequest ?? null,
    context: overrides.context ?? {
      objective: null,
      constraints: [],
      relevantFiles: [],
      validationTargets: []
    },
    status: overrides.status,
    createdAt: overrides.createdAt ?? "2026-03-23T12:00:00.000Z",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    retryCount: overrides.retryCount ?? 0,
    validationStatus: overrides.validationStatus ?? "not_run",
    lastValidationResult: overrides.lastValidationResult ?? null,
    rollingSummary: overrides.rollingSummary ?? null,
    events: overrides.events ?? [],
    error: overrides.error ?? null,
    result: overrides.result ?? null
  };
}
