import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlPlaneState,
  normalizePhaseExecutionInput,
  reconcileExternalSyncState,
  type AgentRunRecord
} from "../index";

function createRunFixture(): AgentRunRecord {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-foundation",
        name: "Foundation",
        description: "Stand up the runtime foundation.",
        approvalGate: {
          kind: "architecture",
          title: "Architecture review"
        },
        userStories: [
          {
            id: "story-runtime",
            title: "Ship runtime state",
            description: "Define the runtime contracts.",
            acceptanceCriteria: ["Runtime contracts are defined."],
            tasks: [
              {
                id: "task-runtime",
                instruction: "Implement the runtime state.",
                expectedOutcome: "Runtime state implemented."
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  phaseExecution.status = "in_progress";
  phaseExecution.current = {
    phaseId: "phase-foundation",
    storyId: "story-runtime",
    taskId: "task-runtime"
  };
  phaseExecution.phases[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "running";

  const controlPlane = createControlPlaneState(phaseExecution);
  controlPlane.blockers.push({
    id: "blocker:story-runtime",
    entityKind: "story",
    entityId: "story-runtime",
    summary: "Waiting on architecture review.",
    status: "resolved",
    createdAt: "2026-03-26T10:00:00.000Z",
    resolvedAt: "2026-03-26T10:05:00.000Z",
    ownerRole: "production_lead",
    ownerId: "agent:production-lead",
    ownerAgentTypeId: "production_lead"
  });

  return {
    id: "run-phase-18",
    threadId: "thread-phase-18",
    parentRunId: null,
    title: "External sync audit",
    instruction: "Mirror runtime progress outward.",
    simulateFailure: false,
    toolRequest: null,
    attachments: [],
    project: {
      id: "project-runtime",
      name: "Shipyard Runtime",
      kind: "live",
      environment: "Production",
      description: "Live runtime project.",
      links: [
        {
          kind: "pull_request",
          url: "https://github.com/StefanoCaruso456/ShipYard/pull/71",
          title: "Phase 17 restore"
        },
        {
          kind: "deployment",
          url: "https://shipyard1.vercel.app",
          title: "Frontend production",
          entityKind: "task",
          entityId: "task-runtime"
        }
      ],
      folder: null
    },
    context: {
      objective: "Mirror runtime progress into an external record.",
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: ["pnpm test"]
    },
    status: "running",
    createdAt: "2026-03-26T09:55:00.000Z",
    startedAt: "2026-03-26T09:56:00.000Z",
    completedAt: null,
    retryCount: 0,
    validationStatus: "not_run",
    lastValidationResult: null,
    orchestration: null,
    phaseExecution,
    controlPlane,
    rebuild: null,
    externalSync: null,
    rollingSummary: {
      text: "Working through the runtime foundation phase.",
      updatedAt: "2026-03-26T10:01:00.000Z",
      source: "result"
    },
    events: [
      {
        at: "2026-03-26T10:00:00.000Z",
        type: "approval_gate_waiting",
        message: "Waiting for architecture approval.",
        phaseId: "phase-foundation",
        gateId: "phase-foundation-architecture"
      },
      {
        at: "2026-03-26T10:03:00.000Z",
        type: "retry_scheduled",
        message: "Retrying after architecture changes.",
        storyId: "story-runtime",
        taskId: "task-runtime",
        retryCount: 1
      },
      {
        at: "2026-03-26T10:08:00.000Z",
        type: "task_completed",
        message: "Completed task-runtime.",
        phaseId: "phase-foundation",
        storyId: "story-runtime",
        taskId: "task-runtime"
      }
    ],
    error: null,
    result: null
  };
}

test("reconcileExternalSyncState derives record, event, blocker, and link actions deterministically", () => {
  const run = createRunFixture();
  const externalSync = reconcileExternalSyncState(run);

  assert.equal(externalSync.provider, "file_mirror");
  assert.ok(
    externalSync.actions.some(
      (action) =>
        action.kind === "upsert_record" &&
        action.entityKind === "phase" &&
        action.payload.kind === "upsert_record"
    )
  );
  assert.ok(
    externalSync.actions.some(
      (action) =>
        action.kind === "append_update" &&
        action.payload.kind === "append_update" &&
        action.payload.updateKind === "approval"
    )
  );
  assert.ok(
    externalSync.actions.some(
      (action) =>
        action.kind === "append_update" &&
        action.payload.kind === "append_update" &&
        action.payload.updateKind === "blocker"
    )
  );
  assert.ok(
    externalSync.actions.some(
      (action) =>
        action.kind === "attach_link" &&
        action.payload.kind === "attach_link" &&
        action.payload.link.kind === "pull_request"
    )
  );
  assert.ok(
    externalSync.actions.some(
      (action) =>
        action.kind === "attach_link" &&
        action.entityKind === "task" &&
        action.payload.kind === "attach_link" &&
        action.payload.link.kind === "deployment"
    )
  );
});

test("reconcileExternalSyncState does not duplicate actions when state is already present", () => {
  const run = createRunFixture();
  const first = reconcileExternalSyncState(run);
  const second = reconcileExternalSyncState({
    ...run,
    externalSync: first
  });

  assert.equal(second.actions.length, first.actions.length);
  assert.deepEqual(
    second.actions.map((action) => action.dedupeKey),
    first.actions.map((action) => action.dedupeKey)
  );
});
