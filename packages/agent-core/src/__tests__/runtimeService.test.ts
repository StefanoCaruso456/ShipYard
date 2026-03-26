import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createAgentRuntime } from "../runtime/createAgentRuntime";
import { createPersistentRuntimeService } from "../runtime/createPersistentRuntimeService";
import type { AgentRunResult } from "../runtime/types";

test("persistent runtime processes queued tasks sequentially without restart", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const firstGate = createDeferred<AgentRunResult>();
  const secondGate = createDeferred<AgentRunResult>();
  const startedInstructions: string[] = [];

  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async (run, context) => {
      startedInstructions.push(run.instruction);

      const gate = run.instruction === "first task" ? firstGate : secondGate;

      return gate.promise.then((result) => ({
        ...result,
        skillId: context.instructionRuntime.skill.meta.id,
        instructionEcho: run.instruction
      }));
    }
  });

  const firstRun = await runtimeService.submitTask({
    instruction: "first task",
    title: "First"
  });
  const secondRun = await runtimeService.submitTask({
    instruction: "second task",
    title: "Second"
  });

  assert.equal(firstRun.status, "pending");
  assert.equal(secondRun.status, "pending");
  assert.ok(runtimeService.getStatus().queuedRuns >= 1);

  await waitForRunStatus(runtimeService, firstRun.id, "running");
  assert.equal(runtimeService.getRun(secondRun.id)?.status, "pending");

  firstGate.resolve({
    mode: "placeholder-execution",
    summary: "first complete",
    instructionEcho: "",
    skillId: "",
    completedAt: new Date().toISOString()
  });

  await waitForRunStatus(runtimeService, firstRun.id, "completed");
  await waitForRunStatus(runtimeService, secondRun.id, "running");

  secondGate.resolve({
    mode: "placeholder-execution",
    summary: "second complete",
    instructionEcho: "",
    skillId: "",
    completedAt: new Date().toISOString()
  });

  await waitForRunStatus(runtimeService, secondRun.id, "completed");

  const status = runtimeService.getStatus();

  assert.equal(status.workerState, "idle");
  assert.equal(status.queuedRuns, 0);
  assert.equal(status.runsByStatus.completed, 2);
  assert.deepEqual(startedInstructions, ["first task", "second task"]);

  const runs = runtimeService.listRuns();

  assert.equal(runs[0]?.id, secondRun.id);
  assert.equal(runs[1]?.id, firstRun.id);
});

test("persistent runtime marks failures clearly and accepts follow-up tasks", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const runtimeService = await createPersistentRuntimeService({ instructionRuntime });

  const failedRun = await runtimeService.submitTask({
    instruction: "fail this task",
    simulateFailure: true
  });

  const failedRecord = await waitForRunStatus(runtimeService, failedRun.id, "failed");

  assert.match(failedRecord.error?.message ?? "", /Simulated runtime failure/);
  assert.equal(failedRecord.result, null);

  const completedRun = await runtimeService.submitTask({
    instruction: "recover after failure"
  });

  const completedRecord = await waitForRunStatus(runtimeService, completedRun.id, "completed");

  assert.equal(completedRecord.error, null);
  assert.match(
    completedRecord.result?.summary ?? "",
    /Persistent runtime skeleton processed the task/
  );
  assert.match(
    completedRecord.rollingSummary?.text ?? "",
    /Persistent runtime skeleton processed the task/
  );

  const status = runtimeService.getStatus();

  assert.equal(status.runsByStatus.failed, 1);
  assert.equal(status.runsByStatus.completed, 1);
  assert.equal(status.totalRuns, 2);
});

test("persistent runtime keeps staged follow-up runs on the same thread", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const runtimeService = await createPersistentRuntimeService({ instructionRuntime });

  const initialRun = await runtimeService.submitTask({
    instruction: "Plan the next backend task."
  });
  const followUpRun = await runtimeService.submitTask({
    instruction: "Also note whether we are using LangGraph.",
    threadId: initialRun.threadId,
    parentRunId: initialRun.id
  });

  assert.equal(initialRun.threadId, initialRun.id);
  assert.equal(initialRun.parentRunId, null);
  assert.equal(followUpRun.threadId, initialRun.threadId);
  assert.equal(followUpRun.parentRunId, initialRun.id);
  assert.notEqual(followUpRun.id, initialRun.id);

  const storedFollowUp = runtimeService.getRun(followUpRun.id);

  assert.equal(storedFollowUp?.threadId, initialRun.threadId);
  assert.equal(storedFollowUp?.parentRunId, initialRun.id);
});

test("persistent runtime preserves project ownership metadata on queued runs", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const runtimeService = await createPersistentRuntimeService({ instructionRuntime });

  const run = await runtimeService.submitTask({
    instruction: "Work inside the analytics dashboard project.",
    project: {
      id: "project-analytics",
      name: "Analytics Dashboard",
      kind: "local",
      environment: "Local folder",
      description: "Connected browser workspace.",
      folder: {
        name: "analytics-dashboard",
        displayPath: "analytics-dashboard",
        status: "connected",
        provider: "browser-file-system-access"
      }
    }
  });

  const storedRun = runtimeService.getRun(run.id);

  assert.equal(storedRun?.project?.id, "project-analytics");
  assert.equal(storedRun?.project?.kind, "local");
  assert.equal(storedRun?.project?.folder?.displayPath, "analytics-dashboard");
});

test("persistent runtime runs active-thread follow-ups before unrelated queued work", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const firstGate = createDeferred<AgentRunResult>();
  const followUpGate = createDeferred<AgentRunResult>();
  const unrelatedGate = createDeferred<AgentRunResult>();
  const startedInstructions: string[] = [];

  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async (run, context) => {
      startedInstructions.push(run.instruction);

      const gate =
        run.instruction === "Continue the current thread next."
          ? followUpGate
          : run.instruction === "Handle another thread later."
            ? unrelatedGate
            : firstGate;

      return gate.promise.then((result) => ({
        ...result,
        skillId: context.instructionRuntime.skill.meta.id,
        instructionEcho: run.instruction
      }));
    }
  });

  const initialRun = await runtimeService.submitTask({
    instruction: "Start the main thread."
  });

  await waitForRunStatus(runtimeService, initialRun.id, "running");

  const unrelatedRun = await runtimeService.submitTask({
    instruction: "Handle another thread later."
  });
  const followUpRun = await runtimeService.submitTask({
    instruction: "Continue the current thread next.",
    threadId: initialRun.threadId,
    parentRunId: initialRun.id
  });

  assert.equal(runtimeService.getRun(unrelatedRun.id)?.status, "pending");
  assert.equal(runtimeService.getRun(followUpRun.id)?.status, "pending");

  firstGate.resolve({
    mode: "placeholder-execution",
    summary: "initial complete",
    instructionEcho: "",
    skillId: "",
    completedAt: new Date().toISOString()
  });

  await waitForRunStatus(runtimeService, initialRun.id, "completed");
  await waitForRunStatus(runtimeService, followUpRun.id, "running");
  assert.equal(runtimeService.getRun(unrelatedRun.id)?.status, "pending");

  followUpGate.resolve({
    mode: "placeholder-execution",
    summary: "follow-up complete",
    instructionEcho: "",
    skillId: "",
    completedAt: new Date().toISOString()
  });

  await waitForRunStatus(runtimeService, followUpRun.id, "completed");
  await waitForRunStatus(runtimeService, unrelatedRun.id, "running");

  unrelatedGate.resolve({
    mode: "placeholder-execution",
    summary: "unrelated complete",
    instructionEcho: "",
    skillId: "",
    completedAt: new Date().toISOString()
  });

  await waitForRunStatus(runtimeService, unrelatedRun.id, "completed");

  assert.deepEqual(startedInstructions, [
    "Start the main thread.",
    "Continue the current thread next.",
    "Handle another thread later."
  ]);
});

test("persistent runtime retries validation failures once and records rollback events", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const attempts: number[] = [];
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async () => {
      attempts.push(attempts.length + 1);

      const error = new Error("Validation failed after edit.") as Error & {
        code?: string;
        toolName?: string;
        path?: string;
        validationResult?: unknown;
        rollback?: unknown;
      };

      error.code = "validation_failed";
      error.toolName = "edit_file_region";
      error.path = "src/example.ts";
      error.validationResult = {
        success: false,
        type: "file",
        errors: ["Validation failed after edit."],
        warnings: [],
        path: "src/example.ts"
      };
      error.rollback = {
        attempted: true,
        success: true,
        path: "src/example.ts",
        message: "Restored the original file after validation failed."
      };

      throw error;
    }
  });

  const run = await runtimeService.submitTask({
    instruction: "Retry this invalid edit once."
  });

  const failedRun = await waitForRunStatus(runtimeService, run.id, "failed");

  assert.deepEqual(attempts, [1, 2]);
  assert.equal(failedRun.retryCount, 1);
  assert.equal(failedRun.validationStatus, "rolled_back");
  assert.equal(failedRun.lastValidationResult?.success, false);
  assert.equal(failedRun.error?.code, "validation_failed");
  assert.match(failedRun.rollingSummary?.text ?? "", /Run failed:/);
  assert.ok(failedRun.events.some((event) => event.type === "retry_scheduled"));
  assert.ok(failedRun.events.some((event) => event.type === "rollback_succeeded"));
});

test("persistent runtime executes phases, stories, and tasks sequentially", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const startedInstructions: string[] = [];
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async (run, context) => {
      startedInstructions.push(run.instruction);

      return {
        mode: "placeholder-execution",
        summary: run.context.objective ?? run.instruction,
        instructionEcho: run.instruction,
        skillId: context.instructionRuntime.skill.meta.id,
        completedAt: new Date().toISOString()
      };
    }
  });

  const run = await runtimeService.submitTask({
    instruction: "Execute the backend delivery plan.",
    phaseExecution: {
      phases: [
        {
          id: "phase-foundation",
          name: "Foundation",
          description: "Lay down the core execution contracts.",
          userStories: [
            {
              id: "story-runtime-shape",
              title: "Define runtime shape",
              description: "Introduce the runtime contracts for the new system.",
              acceptanceCriteria: ["Define runtime shape", "Expose runtime contracts"],
              tasks: [
                {
                  id: "task-1",
                  instruction: "Define runtime shape.",
                  expectedOutcome: "Define runtime shape"
                },
                {
                  id: "task-2",
                  instruction: "Expose runtime contracts.",
                  expectedOutcome: "Expose runtime contracts"
                }
              ]
            }
          ]
        },
        {
          id: "phase-validation",
          name: "Validation",
          description: "Ensure the system validates progression.",
          userStories: [
            {
              id: "story-gates",
              title: "Gate every step",
              description: "Validate task and story completion before moving on.",
              acceptanceCriteria: ["Gate every step"],
              tasks: [
                {
                  id: "task-3",
                  instruction: "Gate every step.",
                  expectedOutcome: "Gate every step"
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

  assert.equal(completedRun.result?.mode, "phase-execution");
  assert.equal(completedRun.phaseExecution?.status, "completed");
  assert.equal(completedRun.controlPlane?.status, "completed");
  assert.equal(completedRun.controlPlane?.progress.completedTasks, 3);
  assert.ok(
    completedRun.controlPlane?.handoffs.some(
      (handoff) => handoff.entityKind === "task" && handoff.entityId === "task-1"
    )
  );
  const storyHandoff = completedRun.controlPlane?.handoffs.find(
    (handoff) => handoff.id === "handoff:story:story-runtime-shape"
  );
  const taskHandoff = completedRun.controlPlane?.handoffs.find(
    (handoff) => handoff.id === "handoff:task:task-2"
  );

  assert.equal(storyHandoff?.status, "completed");
  assert.equal(taskHandoff?.status, "completed");
  assert.ok(storyHandoff?.artifactIds.includes("artifact:story-delegation:story-runtime-shape"));
  assert.deepEqual(taskHandoff?.dependencyIds, ["task-1"]);
  assert.ok(
    completedRun.controlPlane?.artifacts.some(
      (artifact) =>
        artifact.kind === "delegation_brief" && artifact.entityKind === "story"
    )
  );
  assert.ok(
    completedRun.controlPlane?.artifacts.some(
      (artifact) => artifact.kind === "task_result" && artifact.entityId === "task-1"
    )
  );
  assert.deepEqual(startedInstructions, [
    "Define runtime shape.",
    "Expose runtime contracts.",
    "Gate every step."
  ]);
  assert.equal(completedRun.phaseExecution?.progress.completedPhases, 2);
  assert.equal(completedRun.phaseExecution?.progress.completedStories, 2);
  assert.equal(completedRun.phaseExecution?.progress.completedTasks, 3);
  assert.ok(completedRun.events.some((event) => event.type === "phase_started"));
  assert.ok(completedRun.events.some((event) => event.type === "story_completed"));
  assert.ok(completedRun.events.some((event) => event.type === "task_completed"));
});

test("persistent runtime retries task validation gates before failing the full run", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const attempts = new Map<string, number>();
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async (run, context) => {
      const currentAttempt = (attempts.get(run.instruction) ?? 0) + 1;
      attempts.set(run.instruction, currentAttempt);

      return {
        mode: "placeholder-execution",
        summary: currentAttempt === 1 ? "Mismatched output" : run.context.objective ?? run.instruction,
        instructionEcho: run.instruction,
        skillId: context.instructionRuntime.skill.meta.id,
        completedAt: new Date().toISOString()
      };
    }
  });

  const run = await runtimeService.submitTask({
    instruction: "Execute the retrying plan.",
    phaseExecution: {
      retryPolicy: {
        maxTaskRetries: 1
      },
      phases: [
        {
          id: "phase-retry",
          name: "Retry",
          description: "Validate retry behavior.",
          userStories: [
            {
              id: "story-retry",
              title: "Retry a task",
              description: "Retry when task evidence misses the expected outcome.",
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
    }
  });

  const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");
  const task =
    completedRun.phaseExecution?.phases[0]?.userStories[0]?.tasks[0];

  assert.equal(task?.retryCount, 1);
  assert.equal(task?.status, "completed");
  assert.ok(
    completedRun.controlPlane?.interventions.some(
      (intervention) => intervention.kind === "retry" && intervention.entityKind === "task"
    )
  );
  assert.ok(
    completedRun.controlPlane?.phases[0]?.userStories[0]?.tasks[0]?.transitionLog.some(
      (transition) =>
        transition.fromStatus === "in_progress" && transition.toStatus === "completed"
    )
  );
  assert.ok(completedRun.events.some((event) => event.type === "validation_gate_failed"));
  assert.ok(completedRun.events.some((event) => event.type === "retry_scheduled"));
  assert.ok(completedRun.events.some((event) => event.type === "coordination_conflict_detected"));
});

test("persistent runtime tracks rebuild targets artifacts and interventions for ship rebuild runs", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const attempts = new Map<string, number>();
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: async (run, context) => {
      const currentAttempt = (attempts.get(run.instruction) ?? 0) + 1;
      attempts.set(run.instruction, currentAttempt);

      return {
        mode: "placeholder-execution",
        summary:
          currentAttempt === 1
            ? "Incomplete rebuild evidence"
            : run.context.objective ?? run.instruction,
        instructionEcho: run.instruction,
        skillId: context.instructionRuntime.skill.meta.id,
        completedAt: new Date().toISOString()
      };
    }
  });

  const run = await runtimeService.submitTask({
    instruction: "Rebuild the Scopex ship workflow.",
    rebuild: {
      target: {
        shipId: "ship-scopex",
        label: "Scopex rebuild",
        objective: "Restore the ship rebuild workflow.",
        projectId: "project-scopex",
        rootPath: "1st project",
        baseBranch: "main",
        entryPaths: ["client/src/App.tsx", "server/src/index.ts"],
        acceptanceSummary: "Preserve rebuild evidence and intervention history."
      }
    },
    phaseExecution: {
      retryPolicy: {
        maxTaskRetries: 1
      },
      phases: [
        {
          id: "phase-rebuild",
          name: "Rebuild",
          description: "Restore the ship rebuild path.",
          userStories: [
            {
              id: "story-rebuild",
              title: "Rebuild the ship",
              description: "Rebuild the ship with tracked evidence.",
              acceptanceCriteria: ["Restore the ship rebuild workflow."],
              tasks: [
                {
                  id: "task-rebuild",
                  instruction: "Restore the ship rebuild workflow.",
                  expectedOutcome: "Restore the ship rebuild workflow."
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

  assert.equal(completedRun.result?.mode, "ship-rebuild");
  assert.equal(completedRun.rebuild?.status, "completed");
  assert.equal(completedRun.rebuild?.target.shipId, "ship-scopex");
  assert.equal(completedRun.rebuild?.target.scope, "ship");
  assert.deepEqual(completedRun.rebuild?.target.entryPaths, [
    "client/src/App.tsx",
    "server/src/index.ts"
  ]);
  assert.equal(completedRun.rebuild?.progress?.completedTasks, 1);
  assert.equal(completedRun.rebuild?.retryPolicy?.maxTaskRetries, 1);
  assert.equal(completedRun.rebuild?.validationStatus, "passed");
  assert.ok(
    completedRun.rebuild?.artifactLog.some((artifact) => artifact.kind === "task_result")
  );
  assert.ok(
    completedRun.rebuild?.artifactLog.some((artifact) => artifact.kind === "validation_report")
  );
  assert.ok(
    completedRun.rebuild?.interventionLog.some((intervention) => intervention.kind === "retry")
  );
});

async function createInstructionRuntimeForTests() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );

  return createAgentRuntime({ skillPath });
}

async function waitForRunStatus(
  runtimeService: Awaited<ReturnType<typeof createPersistentRuntimeService>>,
  runId: string,
  expectedStatus: "running" | "completed" | "failed"
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = runtimeService.getRun(runId);

    if (run?.status === expectedStatus) {
      return run;
    }

    await tick();
  }

  assert.fail(`Timed out waiting for run ${runId} to reach ${expectedStatus}.`);
}

async function tick() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}
