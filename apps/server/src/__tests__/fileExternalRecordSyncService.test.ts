import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createControlPlaneState,
  normalizePhaseExecutionInput,
  reconcileExternalSyncState,
  type AgentRunRecord
} from "@shipyard/agent-core";

import { createFileExternalRecordSyncService } from "../runtime/createFileExternalRecordSyncService";

function createRunFixture(): AgentRunRecord {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-runtime",
        name: "Runtime",
        description: "Build the runtime mirror.",
        userStories: [
          {
            id: "story-sync",
            title: "Ship external sync",
            description: "Mirror runtime state.",
            acceptanceCriteria: ["External records are mirrored."],
            tasks: [
              {
                id: "task-sync",
                instruction: "Implement file mirror sync.",
                expectedOutcome: "File mirror sync implemented."
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  phaseExecution.status = "completed";
  phaseExecution.current = {
    phaseId: "phase-runtime",
    storyId: "story-sync",
    taskId: "task-sync"
  };
  phaseExecution.progress.completedPhases = 1;
  phaseExecution.progress.completedStories = 1;
  phaseExecution.progress.completedTasks = 1;
  phaseExecution.phases[0]!.status = "completed";
  phaseExecution.phases[0]!.userStories[0]!.status = "completed";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "completed";

  return {
    id: "run-sync-service",
    threadId: "thread-sync-service",
    parentRunId: null,
    title: "External sync service",
    instruction: "Mirror the run to file.",
    simulateFailure: false,
    toolRequest: null,
    attachments: [],
    project: {
      id: "project-sync",
      name: "Sync project",
      kind: "live",
      environment: "Production",
      description: "Runtime project",
      links: [
        {
          kind: "repository",
          url: "https://github.com/StefanoCaruso456/shipyard-sync"
        },
        {
          kind: "pull_request",
          url: "https://github.com/StefanoCaruso456/ShipYard/pull/71"
        },
        {
          kind: "deployment",
          url: "https://shipyard1.vercel.app",
          entityKind: "task",
          entityId: "task-sync"
        }
      ],
      folder: null
    },
    context: {
      objective: "Mirror the run to an external file store.",
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: []
    },
    status: "completed",
    createdAt: "2026-03-26T13:00:00.000Z",
    startedAt: "2026-03-26T13:01:00.000Z",
    completedAt: "2026-03-26T13:05:00.000Z",
    retryCount: 0,
    validationStatus: "passed",
    lastValidationResult: null,
    orchestration: null,
    phaseExecution,
    controlPlane: createControlPlaneState(phaseExecution),
    rebuild: null,
    externalSync: null,
    rollingSummary: {
      text: "Phase 18 mirror complete.",
      updatedAt: "2026-03-26T13:05:00.000Z",
      source: "result"
    },
    events: [
      {
        at: "2026-03-26T13:04:00.000Z",
        type: "task_completed",
        message: "Completed task-sync.",
        phaseId: "phase-runtime",
        storyId: "story-sync",
        taskId: "task-sync"
      },
      {
        at: "2026-03-26T13:05:00.000Z",
        type: "phase_completed",
        message: "Completed phase-runtime.",
        phaseId: "phase-runtime"
      }
    ],
    error: null,
    result: {
      mode: "phase-execution",
      summary: "Phase 18 completed.",
      instructionEcho: "Mirror the run to file.",
      skillId: "shipyard-runtime",
      completedAt: "2026-03-26T13:05:00.000Z",
      phaseExecution,
      controlPlane: createControlPlaneState(phaseExecution)
    }
  };
}

test("file external record sync service mirrors parent-child records and links idempotently", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-external-sync-"));
  const service = createFileExternalRecordSyncService({
    filePath: path.join(tempDir, "external-records.json")
  });

  try {
    const run = createRunFixture();
    const firstState = await service.syncRun({
      ...run,
      externalSync: reconcileExternalSyncState(run)
    });
    const secondState = await service.syncRun({
      ...run,
      externalSync: firstState
    });

    assert.equal(firstState.status, "ready");
    assert.equal(secondState.status, "ready");
    assert.equal(firstState.records.length, 4);
    assert.equal(secondState.records.length, 4);

    const records = await service.listRecords();
    const runRecord = records.find((record) => record.entityKind === "run");
    const phaseRecord = records.find((record) => record.entityKind === "phase");
    const storyRecord = records.find((record) => record.entityKind === "story");
    const taskRecord = records.find((record) => record.entityKind === "task");

    assert.ok(runRecord);
    assert.ok(phaseRecord);
    assert.ok(storyRecord);
    assert.ok(taskRecord);
    assert.ok(runRecord?.childExternalIds.includes(phaseRecord!.externalId));
    assert.equal(storyRecord?.parentExternalId, phaseRecord?.externalId ?? null);
    assert.equal(taskRecord?.parentExternalId, storyRecord?.externalId ?? null);
    assert.ok(runRecord?.links.some((link) => link.kind === "repository"));
    assert.ok(runRecord?.links.some((link) => link.kind === "pull_request"));
    assert.ok(taskRecord?.links.some((link) => link.kind === "deployment"));

    const runDetail = await service.getRecord(runRecord!.externalId);
    const repeatedRunDetail = await service.getRecord(runRecord!.externalId);

    assert.equal(runDetail?.updateCount, repeatedRunDetail?.updateCount);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
