import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createContextAssembler } from "../context/createContextAssembler";
import { createAgentRuntime } from "../runtime/createAgentRuntime";
import { createPersistentRuntimeService } from "../runtime/createPersistentRuntimeService";
import { createAgentHandoff, createAgentInvocation } from "../runtime/coordinator/handoffs";
import { planNextStep, verifyStepResult } from "../runtime/orchestration";
import type {
  AgentRunRecord,
  AgentRuntimeStatus,
  PlannerStepResult,
  Task
} from "../runtime/types";

test("typed handoffs preserve bounded coordination payloads for role invocations", () => {
  const handoff = createAgentHandoff({
    runId: "run-handoff",
    stepId: "step-1",
    source: "coordinator",
    target: "planner",
    purpose: "plan_next_step",
    payload: {
      objective: "Plan a bounded step."
    },
    correlationId: "corr-123"
  });
  const invocation = createAgentInvocation(handoff);

  assert.equal(handoff.source, "coordinator");
  assert.equal(handoff.target, "planner");
  assert.equal(handoff.correlationId, "corr-123");
  assert.equal(invocation.role, "planner");
  assert.equal(invocation.stepId, "step-1");
  assert.deepEqual(invocation.input, {
    objective: "Plan a bounded step."
  });
});

test("planner step generation stays bounded and carries tool metadata", async () => {
  const { assembler } = await createHarness();
  const run = createRunRecord({
    toolRequest: {
      toolName: "edit_file_region",
      input: {
        path: "src/example.ts",
        anchor: "export function greet",
        currentText: "before",
        replacementText: "after"
      }
    }
  });
  const task = createTask({
    id: "task-edit",
    instruction: "Edit the greeting.",
    expectedOutcome: "Update the greeting in src/example.ts",
    toolRequest: run.toolRequest
  });
  const payload = assembler.buildRolePayload("planner", {
    run,
    runtimeStatus: createRuntimeStatus()
  });
  const plannerResult = planNextStep({
    run,
    task,
    payload,
    iteration: 1
  });

  assert.equal(plannerResult.step.kind, "repo_tool");
  assert.equal(plannerResult.step.requiredTool, "edit_file_region");
  assert.deepEqual(plannerResult.step.requiredInputs, ["src/example.ts"]);
  assert.ok(plannerResult.step.successCriteria.includes("Update the greeting in src/example.ts"));
  assert.ok(plannerResult.consumedContextSectionIds.includes("task-objective"));
  assert.ok(plannerResult.consumedContextSectionIds.includes("validation-targets"));
});

test("verifier decision output requests a retry when execution misses the planned intent", async () => {
  const { assembler } = await createHarness();
  const task = createTask({
    id: "task-retry",
    instruction: "Produce the expected output.",
    expectedOutcome: "Expected output"
  });
  const run = createRunRecord({
    context: {
      objective: "Expected output",
      constraints: [],
      relevantFiles: [],
      validationTargets: []
    },
    orchestration: {
      status: "verifying",
      iteration: 1,
      stepRetryCount: 0,
      replanCount: 0,
      maxStepRetries: 1,
      maxReplans: 1,
      nextAction: null,
      currentStep: null,
      lastPlannerResult: null,
      lastExecutorResult: null,
      lastVerifierResult: null
    }
  });
  const plannerResult: PlannerStepResult = planNextStep({
    run,
    task,
    payload: assembler.buildRolePayload("planner", {
      run,
      runtimeStatus: createRuntimeStatus()
    }),
    iteration: 1
  });
  const executionResult = {
    mode: "placeholder-execution" as const,
    summary: "Mismatched output",
    instructionEcho: task.instruction,
    skillId: "coding-agent",
    completedAt: "2026-03-24T12:05:00.000Z"
  };
  const verifierResult = verifyStepResult({
    run: {
      ...run,
      result: executionResult
    },
    task,
    plannerResult,
    executorResult: {
      role: "executor",
      at: "2026-03-24T12:05:00.000Z",
      stepId: plannerResult.step.id,
      success: true,
      mode: executionResult.mode,
      summary: executionResult.summary,
      responseText: null,
      toolResult: null,
      changedFiles: [],
      validationTargets: [],
      consumedContextSectionIds: ["task-objective"],
      error: null
    },
    executionResult,
    payload: assembler.buildRolePayload("verifier", {
      run: {
        ...run,
        result: executionResult
      },
      runtimeStatus: createRuntimeStatus()
    })
  });

  assert.equal(verifierResult.decision, "retry_step");
  assert.equal(verifierResult.intentMatched, false);
  assert.ok(verifierResult.validationGateResults?.some((gate) => gate.success === false));
});

test("live orchestration consumes assembler payloads and records planner/executor/verifier state", async () => {
  const { instructionRuntime, assembler } = await createHarness();
  const seen = {
    prompt: "",
    sectionIds: [] as string[],
    plannedStepId: ""
  };
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    contextAssembler: assembler,
    executeRun: async (run, context) => {
      seen.prompt = context.roleContextPrompt ?? "";
      seen.sectionIds = context.roleContextSectionIds ?? [];
      seen.plannedStepId = context.plannedStep?.id ?? "";

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
    instruction: "Summarize the runtime status.",
    context: {
      objective: "Summarize the runtime status.",
      constraints: ["Keep the response brief."],
      relevantFiles: [
        {
          path: "src/runtime.ts",
          reason: "Current runtime entrypoint."
        }
      ],
      validationTargets: ["pnpm --filter @shipyard/server typecheck"]
    }
  });
  const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

  assert.ok(seen.prompt.includes("# Executor Context Payload"));
  assert.ok(seen.sectionIds.includes("task-objective"));
  assert.ok(seen.plannedStepId.length > 0);
  assert.ok(completedRun.orchestration?.lastPlannerResult);
  assert.ok(completedRun.orchestration?.lastExecutorResult);
  assert.ok(completedRun.orchestration?.lastVerifierResult);
  assert.ok(completedRun.events.some((event) => event.type === "planner_step_proposed"));
  assert.ok(completedRun.events.some((event) => event.type === "executor_step_completed"));
  assert.ok(completedRun.events.some((event) => event.type === "verifier_decision_made"));
  assert.ok(
    completedRun.orchestration?.lastPlannerResult?.consumedContextSectionIds.includes("task-objective")
  );
  assert.ok(
    completedRun.orchestration?.lastVerifierResult?.consumedContextSectionIds.includes("task-objective")
  );
});

test("verifier can fail a task immediately when retries are exhausted", async () => {
  const { instructionRuntime, assembler } = await createHarness();
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    contextAssembler: assembler,
    executeRun: async (run, context) => ({
      mode: "placeholder-execution",
      summary: "Wrong result",
      instructionEcho: run.instruction,
      skillId: context.instructionRuntime.skill.meta.id,
      completedAt: new Date().toISOString()
    })
  });

  const run = await runtimeService.submitTask({
    instruction: "Run the failing plan.",
    phaseExecution: {
      retryPolicy: {
        maxTaskRetries: 0,
        maxReplans: 0
      },
      phases: [
        {
          id: "phase-fail",
          name: "Fail",
          description: "Verifier should reject incorrect output.",
          userStories: [
            {
              id: "story-fail",
              title: "Fail the task",
              description: "Incorrect output must not be marked complete.",
              acceptanceCriteria: ["Expected output"],
              tasks: [
                {
                  id: "task-fail",
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
  const failedRun = await waitForRunStatus(runtimeService, run.id, "failed");

  assert.equal(failedRun.orchestration?.lastVerifierResult?.decision, "fail");
  assert.match(failedRun.error?.message ?? "", /Verifier failed/);
  assert.ok(
    failedRun.events.some((event) => event.type === "coordination_conflict_detected")
  );
  assert.ok(
    failedRun.events.some((event) => event.message.includes("verifier_intent_mismatch"))
  );
});

async function createHarness() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );
  const instructionRuntime = await createAgentRuntime({ skillPath });
  const assembler = createContextAssembler({
    instructionRuntime,
    projectRules: {
      sourcePath: "/tmp/project-rules.md",
      loadedAt: "2026-03-24T12:00:00.000Z",
      content: "# Project Rules\n\n- Keep changes minimal.\n- Validate every meaningful edit."
    }
  });

  return {
    instructionRuntime,
    assembler
  };
}

function createRunRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: overrides.id ?? "run-orchestration",
    title: overrides.title ?? "Orchestration test",
    instruction: overrides.instruction ?? "Implement the orchestration loop.",
    simulateFailure: overrides.simulateFailure ?? false,
    toolRequest: overrides.toolRequest ?? null,
    attachments: overrides.attachments ?? [],
    context: overrides.context ?? {
      objective: "Implement the orchestration loop.",
      constraints: [],
      relevantFiles: [],
      validationTargets: ["pnpm --filter @shipyard/agent-core test"]
    },
    status: overrides.status ?? "running",
    createdAt: overrides.createdAt ?? "2026-03-24T12:00:00.000Z",
    startedAt: overrides.startedAt ?? "2026-03-24T12:01:00.000Z",
    completedAt: overrides.completedAt ?? null,
    retryCount: overrides.retryCount ?? 0,
    validationStatus: overrides.validationStatus ?? "not_run",
    lastValidationResult:
      "lastValidationResult" in overrides ? overrides.lastValidationResult ?? null : null,
    orchestration: overrides.orchestration ?? null,
    phaseExecution: overrides.phaseExecution ?? undefined,
    rollingSummary: "rollingSummary" in overrides ? overrides.rollingSummary ?? null : null,
    events: overrides.events ?? [],
    error: overrides.error ?? null,
    result: "result" in overrides ? overrides.result ?? null : null
  };
}

function createTask(
  overrides: Partial<Task> & Pick<Task, "id" | "instruction" | "expectedOutcome">
): Task {
  return {
    id: overrides.id,
    instruction: overrides.instruction,
    expectedOutcome: overrides.expectedOutcome,
    status: overrides.status ?? "pending",
    toolRequest: overrides.toolRequest ?? null,
    context: overrides.context ?? null,
    validationGates: overrides.validationGates ?? [],
    retryCount: overrides.retryCount ?? 0,
    failureReason: overrides.failureReason ?? null,
    lastValidationResults: overrides.lastValidationResults ?? null,
    result: overrides.result ?? null
  };
}

function createRuntimeStatus(): AgentRuntimeStatus {
  return {
    startedAt: "2026-03-24T12:00:00.000Z",
    workerState: "idle",
    activeRunId: null,
    queuedRuns: 0,
    totalRuns: 1,
    runsByStatus: {
      pending: 0,
      running: 1,
      completed: 0,
      failed: 0
    },
    instructions: {
      skillId: "coding-agent",
      loadedAt: "2026-03-24T11:59:00.000Z"
    }
  };
}

async function waitForRunStatus(
  runtimeService: Awaited<ReturnType<typeof createPersistentRuntimeService>>,
  runId: string,
  expectedStatus: AgentRunRecord["status"]
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
