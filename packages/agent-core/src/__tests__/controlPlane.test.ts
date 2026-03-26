import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlPlaneState,
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
  assert.ok(controlPlane.specialistAgentRegistry.definitions.length > 0);

  recordPhaseStarted(controlPlane, phaseExecution.phases[0]!);

  const storyHandoff = controlPlane.handoffs.find((handoff) => handoff.id === "handoff:story:story-runtime");
  const phaseHandoff = controlPlane.handoffs.find(
    (handoff) => handoff.id === "handoff:phase:phase-foundation"
  );

  assert.equal(phaseHandoff?.status, "accepted");
  assert.equal(storyHandoff?.status, "created");
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-delegation:story-runtime"));
  assert.deepEqual(storyHandoff?.acceptanceCriteria, ["Define runtime"]);
  assert.equal(storyHandoff?.correlationId, "corr:story:story-runtime");
  assert.equal(storyHandoff?.toAgentTypeId, "backend_dev");

  recordStoryStarted(controlPlane, phaseExecution.phases[0]!.userStories[0]!);

  const taskHandoff = controlPlane.handoffs.find((handoff) => handoff.id === "handoff:task:task-runtime");
  const dependentTaskHandoff = controlPlane.handoffs.find(
    (handoff) => handoff.id === "handoff:task:task-contracts"
  );

  assert.equal(storyHandoff?.status, "accepted");
  assert.equal(taskHandoff?.status, "created");
  assert.deepEqual(dependentTaskHandoff?.dependencyIds, ["task-runtime"]);
  assert.equal(taskHandoff?.toAgentTypeId, "execution_subagent");

  recordTaskStarted(
    controlPlane,
    phaseExecution.phases[0]!.userStories[0]!,
    phaseExecution.phases[0]!.userStories[0]!.tasks[0]!
  );

  assert.equal(taskHandoff?.status, "accepted");
  assert.deepEqual(taskHandoff?.validationTargets, ["Define runtime"]);
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
