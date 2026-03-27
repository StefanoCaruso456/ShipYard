import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlPlaneState,
  deriveOperatorRunView,
  normalizePhaseExecutionInput,
  recordMergeGovernanceDecision,
  recordPhaseCompleted,
  recordPhaseStarted,
  recordStoryCompleted,
  recordStoryStarted,
  recordTaskCompleted,
  recordTaskStarted,
  type AgentRunRecord
} from "../index";

function createRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run-1",
    threadId: "thread-1",
    parentRunId: null,
    title: "Operator view test",
    instruction: "Build the operator workflow layer.",
    simulateFailure: false,
    toolRequest: null,
    attachments: [],
    project: null,
    context: {
      objective: null,
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: []
    },
    status: "pending",
    createdAt: "2026-03-26T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
    retryCount: 0,
    validationStatus: "not_run",
    lastValidationResult: null,
    orchestration: null,
    phaseExecution: null,
    controlPlane: null,
    rebuild: null,
    rollingSummary: null,
    events: [],
    error: null,
    result: null,
    ...overrides
  };
}

test("operator view surfaces execution ownership for an active phase task", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    retryPolicy: {
      maxTaskRetries: 2,
      maxStoryRetries: 1
    },
    phases: [
      {
        id: "phase-runtime",
        name: "Runtime",
        description: "Build the operator workflow.",
        userStories: [
          {
            id: "story-operator-view",
            title: "Ship operator visibility",
            description: "Turn runtime state into an operator summary.",
            acceptanceCriteria: ["Show stage", "Show owner"],
            tasks: [
              {
                id: "task-operator-view",
                instruction: "Implement the operator overview.",
                expectedOutcome: "Operator overview implemented."
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
    phaseId: "phase-runtime",
    storyId: "story-operator-view",
    taskId: "task-operator-view"
  };
  phaseExecution.phases[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "running";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.retryCount = 1;

  const controlPlane = createControlPlaneState(phaseExecution);
  recordPhaseStarted(controlPlane, phaseExecution.phases[0]!);
  recordStoryStarted(controlPlane, phaseExecution.phases[0]!.userStories[0]!);
  recordTaskStarted(
    controlPlane,
    phaseExecution.phases[0]!.userStories[0]!,
    phaseExecution.phases[0]!.userStories[0]!.tasks[0]!
  );

  const operatorView = deriveOperatorRunView(
    createRun({
      status: "running",
      startedAt: "2026-03-26T12:01:00.000Z",
      phaseExecution,
      controlPlane,
      events: [
        {
          at: "2026-03-26T12:01:30.000Z",
          type: "task_started",
          message: "Started task-operator-view.",
          taskId: "task-operator-view"
        }
      ]
    })
  );

  assert.equal(operatorView.stage.id, "execution");
  assert.equal(operatorView.stage.status, "active");
  assert.equal(operatorView.owner.role, "execution_subagent");
  assert.equal(operatorView.current.entityKind, "task");
  assert.match(operatorView.nextAction ?? "", /Complete/);
  assert.equal(operatorView.progress?.completedTasks, 0);
  assert.equal(operatorView.progress?.totalTasks, 1);
  assert.equal(operatorView.retries.taskRetries, 1);
  assert.ok(operatorView.planningArtifacts.some((artifact) => artifact.kind === "requirements"));
  assert.ok(
    operatorView.delegationPackets.some(
      (packet) =>
        packet.entityKind === "task" &&
        packet.workPacket?.scopeSummary.includes("Implement the operator overview")
    )
  );
  assert.ok(operatorView.journal.some((entry) => entry.label === "Task Started"));
});

test("operator view prioritizes open blockers during validation failure", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    retryPolicy: {
      maxTaskRetries: 1,
      maxStoryRetries: 1
    },
    phases: [
      {
        id: "phase-qa",
        name: "QA",
        description: "Exercise validation reporting.",
        userStories: [
          {
            id: "story-qa",
            title: "Validate output",
            description: "Fail validation and expose the blocker.",
            acceptanceCriteria: ["Pass validation"],
            tasks: [
              {
                id: "task-qa",
                instruction: "Run validation.",
                expectedOutcome: "Validation passes."
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  phaseExecution.status = "failed";
  phaseExecution.current = {
    phaseId: "phase-qa",
    storyId: "story-qa",
    taskId: "task-qa"
  };
  phaseExecution.phases[0]!.status = "failed";
  phaseExecution.phases[0]!.userStories[0]!.status = "failed";
  phaseExecution.phases[0]!.userStories[0]!.retryCount = 1;
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "failed";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.retryCount = 1;
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.failureReason = "Validation gate failed.";
  phaseExecution.lastFailureReason = "Validation gate failed.";

  const controlPlane = createControlPlaneState(phaseExecution);
  controlPlane.blockers.push({
    id: "blocker:task-qa",
    entityKind: "task",
    entityId: "task-qa",
    summary: "Validation evidence is incomplete.",
    status: "open",
    createdAt: "2026-03-26T12:05:00.000Z",
    resolvedAt: null,
    ownerRole: "specialist_dev",
    ownerId: "agent:specialist-dev:backend_dev:story-qa",
    ownerAgentTypeId: "backend_dev"
  });

  const operatorView = deriveOperatorRunView(
    createRun({
      status: "failed",
      startedAt: "2026-03-26T12:04:00.000Z",
      completedAt: "2026-03-26T12:06:00.000Z",
      retryCount: 1,
      validationStatus: "rolled_back",
      phaseExecution,
      controlPlane,
      events: [
        {
          at: "2026-03-26T12:04:30.000Z",
          type: "validation_gate_failed",
          message: "Validation gate failed for task-qa.",
          taskId: "task-qa"
        },
        {
          at: "2026-03-26T12:05:30.000Z",
          type: "retry_scheduled",
          message: "Retry scheduled for task-qa.",
          taskId: "task-qa",
          retryCount: 1
        }
      ],
      error: {
        message: "Validation gate failed.",
        code: "verification_failed"
      }
    })
  );

  assert.equal(operatorView.stage.id, "validation");
  assert.equal(operatorView.stage.status, "failed");
  assert.equal(operatorView.blockers[0]?.summary, "Validation evidence is incomplete.");
  assert.match(operatorView.nextAction ?? "", /Resolve blocker/);
  assert.equal(operatorView.retries.totalRetries, 3);
  assert.ok(operatorView.journal.some((entry) => entry.label === "Task blocker opened"));
  assert.ok(operatorView.journal.some((entry) => entry.label === "Run failed"));
});

test("operator view surfaces active approval gates for paused runs", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-implementation",
        name: "Implementation",
        description: "Pause for implementation approval.",
        approvalGate: {
          id: "gate-implementation",
          kind: "implementation",
          instructions: "Review the implementation brief before coding starts."
        },
        userStories: [
          {
            id: "story-implementation",
            title: "Prepare implementation",
            description: "Wait at the implementation gate.",
            acceptanceCriteria: ["Implementation approved"],
            tasks: [
              {
                id: "task-implementation",
                instruction: "Prepare implementation.",
                expectedOutcome: "Prepare implementation."
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  phaseExecution.status = "blocked";
  phaseExecution.activeApprovalGateId = "gate-implementation";
  phaseExecution.current = {
    phaseId: "phase-implementation",
    storyId: null,
    taskId: null
  };
  phaseExecution.phases[0]!.status = "blocked";
  phaseExecution.phases[0]!.approvalGate!.status = "waiting";
  phaseExecution.phases[0]!.approvalGate!.waitingAt = "2026-03-26T12:10:00.000Z";

  const controlPlane = createControlPlaneState(phaseExecution);
  const operatorView = deriveOperatorRunView(
    createRun({
      status: "paused",
      startedAt: "2026-03-26T12:09:00.000Z",
      phaseExecution,
      controlPlane,
      rollingSummary: {
        text: "Waiting for implementation approval.",
        updatedAt: "2026-03-26T12:10:00.000Z",
        source: "result"
      },
      events: [
        {
          at: "2026-03-26T12:10:00.000Z",
          type: "approval_gate_waiting",
          phaseId: "phase-implementation",
          gateId: "gate-implementation",
          message: "Waiting for approval before Implementation."
        }
      ]
    })
  );

  assert.equal(operatorView.stage.id, "coordination");
  assert.equal(operatorView.stage.status, "active");
  assert.equal(operatorView.approval?.activeGate?.id, "gate-implementation");
  assert.equal(operatorView.approval?.activeGate?.status, "waiting");
  assert.match(operatorView.nextAction ?? "", /Review implementation approval/i);
  assert.ok(operatorView.journal.some((entry) => entry.label === "Approval gate waiting"));
});

test("operator view surfaces merge conflicts and production-lead decisions", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-merge",
        name: "Merge",
        description: "Exercise conflict governance.",
        userStories: [
          {
            id: "story-merge",
            title: "Merge story",
            description: "Own the merge path.",
            acceptanceCriteria: ["Merge safely"],
            tasks: [
              {
                id: "task-merge",
                instruction: "Merge the specialist output.",
                expectedOutcome: "Merge completes cleanly."
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
    phaseId: "phase-merge",
    storyId: "story-merge",
    taskId: "task-merge"
  };
  phaseExecution.phases[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "running";

  const controlPlane = createControlPlaneState(phaseExecution);
  recordPhaseStarted(controlPlane, phaseExecution.phases[0]!);
  recordStoryStarted(controlPlane, phaseExecution.phases[0]!.userStories[0]!);
  recordTaskStarted(
    controlPlane,
    phaseExecution.phases[0]!.userStories[0]!,
    phaseExecution.phases[0]!.userStories[0]!.tasks[0]!
  );
  recordMergeGovernanceDecision(controlPlane, {
    conflicts: [
      {
        type: "unexpected_side_effects",
        stepId: "task-merge-step-1",
        reason: "Executor changed files outside the declared merge scope.",
        detectedAt: Date.parse("2026-03-26T13:10:00.000Z"),
        metadata: {
          changedFiles: ["packages/agent-core/src/runtime/controlPlane.ts"],
          expectedPath: "packages/agent-core/src/runtime/operatorView.ts",
          expectedAgentTypeId: "backend_dev",
          ownerAgentTypeId: "repo_tools_dev"
        }
      }
    ],
    entityKind: "task",
    entityId: "task-merge",
    outcome: "reassign",
    summary: "Production lead should reassign the merge pass to repo tools."
  });

  const operatorView = deriveOperatorRunView(
    createRun({
      status: "running",
      startedAt: "2026-03-26T13:09:00.000Z",
      phaseExecution,
      controlPlane
    })
  );

  assert.equal(operatorView.conflicts.length, 1);
  assert.equal(operatorView.conflicts[0]?.kind, "boundary_violation");
  assert.ok(
    operatorView.conflicts[0]?.conflictingPaths.includes(
      "packages/agent-core/src/runtime/controlPlane.ts"
    )
  );
  assert.equal(operatorView.mergeDecisions.length, 1);
  assert.equal(operatorView.mergeDecisions[0]?.outcome, "reassign");
  assert.match(operatorView.nextAction ?? "", /reassign/i);
  assert.ok(
    operatorView.journal.some((entry) => entry.label === "Boundary Violation conflict recorded")
  );
  assert.ok(
    operatorView.journal.some((entry) => entry.label === "Merge decision: Reassign")
  );
});

test("operator view assembles delivery summary and evaluation for completed runs", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-delivery",
        name: "Delivery",
        description: "Prepare the final operator closeout.",
        userStories: [
          {
            id: "story-delivery",
            title: "Ship the final closeout",
            description: "Complete the closeout flow.",
            acceptanceCriteria: ["Operator summary shipped"],
            tasks: [
              {
                id: "task-delivery",
                instruction: "Write the delivery summary.",
                expectedOutcome: "Delivery summary prepared."
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
    phaseId: null,
    storyId: null,
    taskId: null
  };
  phaseExecution.phases[0]!.status = "completed";
  phaseExecution.phases[0]!.userStories[0]!.status = "completed";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "completed";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.retryCount = 1;

  const controlPlane = createControlPlaneState(phaseExecution);
  const phase = phaseExecution.phases[0]!;
  const story = phase.userStories[0]!;
  const task = story.tasks[0]!;

  recordPhaseStarted(controlPlane, phase);
  recordStoryStarted(controlPlane, story);
  recordTaskStarted(controlPlane, story, task);
  recordTaskCompleted(
    controlPlane,
    task,
    {
      mode: "phase-execution",
      summary: "Delivery summary prepared.",
      instructionEcho: task.instruction,
      skillId: "execution_subagent",
      completedAt: "2026-03-26T14:03:00.000Z"
    },
    [
      {
        gateId: "task-complete",
        description: "Task completed",
        kind: "task_completed",
        success: true,
        message: "Task completed cleanly."
      }
    ]
  );
  recordStoryCompleted(controlPlane, story, [
    {
      gateId: "story-complete",
      description: "Story completed",
      kind: "all_tasks_completed",
      success: true,
      message: "Story completed cleanly."
    }
  ]);
  recordPhaseCompleted(controlPlane, phase, [
    {
      gateId: "phase-complete",
      description: "Phase completed",
      kind: "all_user_stories_completed",
      success: true,
      message: "Phase completed cleanly."
    }
  ]);

  const operatorView = deriveOperatorRunView(
    createRun({
      status: "completed",
      startedAt: "2026-03-26T14:00:00.000Z",
      completedAt: "2026-03-26T14:04:00.000Z",
      phaseExecution,
      controlPlane,
      project: {
        id: "project-1",
        name: "Shipyard",
        links: [
          {
            kind: "repository",
            url: "https://github.com/StefanoCaruso456/ShipYard",
            title: "Repository"
          }
        ]
      },
      externalSync: {
        version: 1,
        provider: "file_mirror",
        status: "ready",
        lastSyncedAt: "2026-03-26T14:04:30.000Z",
        lastError: null,
        actions: [],
        records: [
          {
            externalId: "ext-run-1",
            provider: "file_mirror",
            entityKind: "run",
            entityId: "run-1",
            title: "Run summary",
            status: "completed",
            summary: "Completed run mirror.",
            parentExternalId: null,
            childExternalIds: [],
            links: [
              {
                id: "link-1",
                kind: "deployment",
                url: "https://shipyard.app/demo",
                title: "Deployment",
                provider: "vercel",
                entityKind: "run",
                entityId: "run-1",
                syncedAt: "2026-03-26T14:04:30.000Z"
              }
            ],
            lastSyncedAt: "2026-03-26T14:04:30.000Z",
            lastUpdateSummary: "Completed",
            updateCount: 2
          }
        ]
      },
      result: {
        mode: "phase-execution",
        summary: "Shipped the delivery closeout.",
        instructionEcho: "Build the operator workflow layer.",
        skillId: "production_lead",
        completedAt: "2026-03-26T14:04:00.000Z",
        phaseExecution,
        controlPlane
      }
    })
  );

  assert.equal(operatorView.stage.id, "delivery");
  assert.equal(operatorView.delivery?.status, "completed");
  assert.match(
    operatorView.delivery?.headline ?? "",
    /Delivery summary prepared|Story Ship the final closeout completed|Phase Delivery completed|Shipped/i
  );
  assert.ok(operatorView.delivery?.outputs.includes("Operator summary shipped"));
  assert.equal(operatorView.delivery?.links.length, 2);
  assert.equal(operatorView.evaluation?.scorecard.retryCount, 1);
  assert.ok(
    operatorView.evaluation?.bottlenecks.some((bottleneck) => bottleneck.id === "retry-pressure")
  );
});
