import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlPlaneState,
  recordMergeGovernanceDecision,
  recordPhaseStarted,
  recordStoryStarted,
  recordStoryRetry,
  recordTaskStarted,
  syncControlPlaneState
} from "../runtime/controlPlane";
import { normalizePhaseExecutionInput } from "../runtime/phaseExecution";

test("control plane initializes typed ownership for phases, stories, and tasks", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-foundation",
        name: "Foundation",
        description: "Lay the base contracts.",
        userStories: [
          {
            id: "story-runtime",
            title: "Define runtime",
            description: "Introduce runtime contracts.",
            acceptanceCriteria: ["Define runtime"],
            tasks: [
              {
                id: "task-runtime",
                instruction: "Define runtime.",
                expectedOutcome: "Define runtime"
              },
              {
                id: "task-contracts",
                instruction: "Expose runtime contracts.",
                expectedOutcome: "Expose runtime contracts"
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  const controlPlane = createControlPlaneState(phaseExecution);
  const phase = controlPlane.phases[0];
  const story = phase?.userStories[0];
  const task = story?.tasks[0];

  assert.equal(controlPlane.runOwnerId, "agent:orchestrator");
  assert.equal(phase?.ownerRole, "production_lead");
  assert.equal(phase?.ownerAgentTypeId, "production_lead");
  assert.equal(story?.ownerRole, "specialist_dev");
  assert.equal(story?.ownerAgentTypeId, "backend_dev");
  assert.equal(task?.ownerRole, "execution_subagent");
  assert.equal(task?.ownerAgentTypeId, "execution_subagent");
  assert.ok(controlPlane.agents.some((agent) => agent.role === "orchestrator"));
  assert.ok(
    controlPlane.agents.some(
      (agent) => agent.id === "agent:specialist-dev:backend_dev:story-runtime"
    )
  );
  assert.ok(
    controlPlane.agents.some(
      (agent) => agent.id === "agent:execution-subagent:backend_dev:task-runtime"
    )
  );
  assert.ok(
    controlPlane.agents.some(
      (agent) =>
        agent.id === "agent:specialist-dev:backend_dev:story-runtime" &&
        agent.skillIds.includes("backend_dev")
    )
  );
  assert.ok(
    controlPlane.agents.some(
      (agent) =>
        agent.id === "agent:execution-subagent:backend_dev:task-runtime" &&
        agent.skillIds.includes("execution_subagent") &&
        agent.skillIds.includes("backend_dev")
    )
  );
  assert.equal(controlPlane.artifacts[0]?.kind, "plan");
  assert.equal(controlPlane.artifacts[0]?.payload?.kind, "plan");
  assert.ok(controlPlane.specialistAgentRegistry.definitions.length > 0);

  recordPhaseStarted(controlPlane, phaseExecution.phases[0]!);

  const storyHandoff = controlPlane.handoffs.find((handoff) => handoff.id === "handoff:story:story-runtime");
  const phaseHandoff = controlPlane.handoffs.find(
    (handoff) => handoff.id === "handoff:phase:phase-foundation"
  );

  assert.equal(phaseHandoff?.status, "accepted");
  assert.equal(storyHandoff?.status, "created");
  assert.ok(phaseHandoff?.artifactIds.includes("artifact:phase-requirements:phase-foundation"));
  assert.ok(phaseHandoff?.artifactIds.includes("artifact:phase-delegation:phase-foundation"));
  assert.equal(phaseHandoff?.workPacket?.ownerAgentTypeId, "production_lead");
  assert.deepEqual(
    phaseHandoff?.workPacket?.sourceArtifactIds,
    phaseHandoff?.artifactIds
  );
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-delegation:story-runtime"));
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-architecture:story-runtime"));
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-user-flow:story-runtime"));
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-data-flow:story-runtime"));
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-breakdown:story-runtime"));
  assert.deepEqual(storyHandoff?.acceptanceCriteria, ["Define runtime"]);
  assert.equal(storyHandoff?.correlationId, "corr:story:story-runtime");
  assert.equal(storyHandoff?.toAgentTypeId, "backend_dev");
  assert.equal(storyHandoff?.workPacket?.ownerAgentTypeId, "backend_dev");
  assert.deepEqual(storyHandoff?.workPacket?.flowArtifactIds, [
    "artifact:story-user-flow:story-runtime",
    "artifact:story-data-flow:story-runtime"
  ]);
  assert.ok(
    controlPlane.artifacts.some(
      (artifact) => artifact.kind === "requirements" && artifact.entityId === "phase-foundation"
    )
  );
  assert.ok(
    controlPlane.artifacts.some(
      (artifact) =>
        artifact.kind === "architecture_decision" && artifact.entityId === "story-runtime"
    )
  );
  assert.ok(
    controlPlane.artifacts.some(
      (artifact) => artifact.kind === "user_flow_spec" && artifact.entityId === "story-runtime"
    )
  );
  assert.ok(
    controlPlane.artifacts.some(
      (artifact) => artifact.kind === "data_flow_spec" && artifact.entityId === "story-runtime"
    )
  );
  assert.ok(
    controlPlane.artifacts.some(
      (artifact) => artifact.kind === "subtask_breakdown" && artifact.entityId === "story-runtime"
    )
  );

  recordStoryStarted(controlPlane, phaseExecution.phases[0]!.userStories[0]!);

  const taskHandoff = controlPlane.handoffs.find((handoff) => handoff.id === "handoff:task:task-runtime");
  const dependentTaskHandoff = controlPlane.handoffs.find(
    (handoff) => handoff.id === "handoff:task:task-contracts"
  );

  assert.equal(storyHandoff?.status, "accepted");
  assert.equal(taskHandoff?.status, "created");
  assert.ok(taskHandoff?.artifactIds.includes("artifact:story-user-flow:story-runtime"));
  assert.ok(taskHandoff?.artifactIds.includes("artifact:story-data-flow:story-runtime"));
  assert.ok(taskHandoff?.artifactIds.includes("artifact:story-breakdown:story-runtime"));
  assert.ok(taskHandoff?.artifactIds.includes("artifact:task-delegation:task-runtime"));
  assert.deepEqual(dependentTaskHandoff?.dependencyIds, ["task-runtime"]);
  assert.equal(taskHandoff?.toAgentTypeId, "execution_subagent");
  assert.equal(taskHandoff?.workPacket?.ownerAgentTypeId, "backend_dev");
  assert.deepEqual(taskHandoff?.workPacket?.flowArtifactIds, [
    "artifact:story-user-flow:story-runtime",
    "artifact:story-data-flow:story-runtime"
  ]);

  recordTaskStarted(
    controlPlane,
    phaseExecution.phases[0]!.userStories[0]!,
    phaseExecution.phases[0]!.userStories[0]!.tasks[0]!
  );

  assert.equal(taskHandoff?.status, "accepted");
  assert.deepEqual(taskHandoff?.validationTargets, ["Define runtime"]);
  assert.deepEqual(taskHandoff?.workPacket?.taskIds, ["task-runtime"]);
});

test("control plane sync records status transitions and retry interventions", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-retry",
        name: "Retry",
        description: "Exercise status transitions.",
        userStories: [
          {
            id: "story-retry",
            title: "Retry story",
            description: "Retry when a task fails.",
            acceptanceCriteria: ["Expected output"],
            tasks: [
              {
                id: "task-retry",
                instruction: "Produce the expected output.",
                expectedOutcome: "Expected output"
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  const controlPlane = createControlPlaneState(phaseExecution);

  phaseExecution.status = "in_progress";
  phaseExecution.phases[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.status = "in_progress";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "failed";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.failureReason = "Expected output missing.";

  syncControlPlaneState(controlPlane, phaseExecution);

  const taskNode = controlPlane.phases[0]!.userStories[0]!.tasks[0]!;

  assert.equal(taskNode.status, "failed");
  assert.ok(
    taskNode.transitionLog.some(
      (transition) => transition.fromStatus === "pending" && transition.toStatus === "failed"
    )
  );

  phaseExecution.phases[0]!.userStories[0]!.retryCount = 1;
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.status = "pending";
  phaseExecution.phases[0]!.userStories[0]!.tasks[0]!.failureReason = null;
  syncControlPlaneState(controlPlane, phaseExecution);
  recordStoryRetry(
    controlPlane,
    phaseExecution.phases[0]!.userStories[0]!,
    1,
    "Retrying story after verifier rejection."
  );

  assert.equal(controlPlane.phases[0]!.userStories[0]!.tasks[0]!.status, "pending");
  assert.ok(
    controlPlane.interventions.some(
      (intervention) => intervention.kind === "retry" && intervention.entityId === "story-retry"
    )
  );
});

test("control plane records overlap conflicts and production-lead merge decisions", () => {
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-governance",
        name: "Governance",
        description: "Detect overlapping specialist scope.",
        userStories: [
          {
            id: "story-frontend",
            title: "Frontend scope",
            description: "Own the shared file from the frontend side.",
            preferredSpecialistAgentTypeId: "frontend_dev",
            acceptanceCriteria: ["Frontend ownership is clear"],
            tasks: [
              {
                id: "task-frontend",
                instruction: "Update the shared file from the frontend side.",
                expectedOutcome: "Frontend patch lands cleanly.",
                context: {
                  objective: null,
                  constraints: [],
                  relevantFiles: [
                    {
                      path: "apps/client/src/App.tsx"
                    }
                  ],
                  validationTargets: []
                }
              }
            ]
          },
          {
            id: "story-observability",
            title: "Observability scope",
            description: "Own the same file from the observability side.",
            preferredSpecialistAgentTypeId: "observability_dev",
            acceptanceCriteria: ["Observability ownership is clear"],
            tasks: [
              {
                id: "task-observability",
                instruction: "Update the shared file from the observability side.",
                expectedOutcome: "Observability patch lands cleanly.",
                context: {
                  objective: null,
                  constraints: [],
                  relevantFiles: [
                    {
                      path: "apps/client/src/App.tsx"
                    }
                  ],
                  validationTargets: []
                }
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  const controlPlane = createControlPlaneState(phaseExecution);
  recordPhaseStarted(controlPlane, phaseExecution.phases[0]!);

  const overlapConflict = controlPlane.conflicts.find((conflict) => conflict.kind === "scope_overlap");
  const overlapDecision = controlPlane.mergeDecisions.find(
    (decision) => decision.outcome === "reassign"
  );

  assert.ok(overlapConflict);
  assert.equal(overlapConflict?.entityKind, "story");
  assert.ok(overlapConflict?.conflictingPaths.includes("apps/client/src/App.tsx"));
  assert.ok(overlapConflict?.relatedHandoffIds.includes("handoff:story:story-frontend"));
  assert.ok(overlapConflict?.relatedHandoffIds.includes("handoff:story:story-observability"));
  assert.ok(overlapDecision);
  assert.equal(overlapDecision?.entityId, "story-observability");
  assert.ok(
    overlapDecision?.reassignedToAgentTypeId === "frontend_dev" ||
      overlapDecision?.reassignedToAgentTypeId === "observability_dev"
  );

  recordMergeGovernanceDecision(controlPlane, {
    conflicts: [
      {
        type: "unexpected_side_effects",
        stepId: "task-observability-step-1",
        reason: "Execution wrote outside the declared work packet.",
        detectedAt: Date.parse("2026-03-26T13:00:00.000Z"),
        metadata: {
          changedFiles: ["apps/server/src/index.ts"],
          expectedPath: "apps/client/src/App.tsx",
          expectedAgentTypeId: "observability_dev"
        }
      }
    ],
    entityKind: "task",
    entityId: "task-observability",
    outcome: "retry",
    summary: "Retry the observability task inside its assigned scope."
  });

  const boundaryConflict = controlPlane.conflicts.find(
    (conflict) =>
      conflict.entityId === "task-observability" && conflict.kind === "boundary_violation"
  );
  const retryDecision = controlPlane.mergeDecisions.find(
    (decision) => decision.entityId === "task-observability" && decision.outcome === "retry"
  );

  assert.ok(boundaryConflict);
  assert.deepEqual(boundaryConflict?.expectedPaths, ["apps/client/src/App.tsx"]);
  assert.deepEqual(boundaryConflict?.conflictingPaths, ["apps/server/src/index.ts"]);
  assert.ok(retryDecision);
  assert.equal(boundaryConflict?.resolutionDecisionId, retryDecision?.id);
});
