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

  const runtimeService = createPersistentRuntimeService({
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

  const firstRun = runtimeService.submitTask({
    instruction: "first task",
    title: "First"
  });
  const secondRun = runtimeService.submitTask({
    instruction: "second task",
    title: "Second"
  });

  assert.equal(firstRun.status, "pending");
  assert.equal(secondRun.status, "pending");
  assert.equal(runtimeService.getStatus().queuedRuns, 2);

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
  const runtimeService = createPersistentRuntimeService({ instructionRuntime });

  const failedRun = runtimeService.submitTask({
    instruction: "fail this task",
    simulateFailure: true
  });

  const failedRecord = await waitForRunStatus(runtimeService, failedRun.id, "failed");

  assert.match(failedRecord.error?.message ?? "", /Simulated runtime failure/);
  assert.equal(failedRecord.result, null);

  const completedRun = runtimeService.submitTask({
    instruction: "recover after failure"
  });

  const completedRecord = await waitForRunStatus(runtimeService, completedRun.id, "completed");

  assert.equal(completedRecord.error, null);
  assert.match(
    completedRecord.result?.summary ?? "",
    /Persistent runtime skeleton processed the task/
  );

  const status = runtimeService.getStatus();

  assert.equal(status.runsByStatus.failed, 1);
  assert.equal(status.runsByStatus.completed, 1);
  assert.equal(status.totalRuns, 2);
});

test("persistent runtime retries validation failures once and records rollback events", async () => {
  const instructionRuntime = await createInstructionRuntimeForTests();
  const attempts: number[] = [];
  const runtimeService = createPersistentRuntimeService({
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

  const run = runtimeService.submitTask({
    instruction: "Retry this invalid edit once."
  });

  const failedRun = await waitForRunStatus(runtimeService, run.id, "failed");

  assert.deepEqual(attempts, [1, 2]);
  assert.equal(failedRun.retryCount, 1);
  assert.equal(failedRun.validationStatus, "rolled_back");
  assert.equal(failedRun.lastValidationResult?.success, false);
  assert.equal(failedRun.error?.code, "validation_failed");
  assert.ok(failedRun.events.some((event) => event.type === "retry_scheduled"));
  assert.ok(failedRun.events.some((event) => event.type === "rollback_succeeded"));
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
