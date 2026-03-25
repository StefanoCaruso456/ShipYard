import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentRuntime,
  createContextAssembler,
  createPersistentRuntimeService,
  createRepoToolset,
  type AgentRunRecord,
  type AgentRunResult
} from "@shipyard/agent-core";

import { createTraceService } from "../observability/createTraceService";
import { resolveLangSmithTraceConfig } from "../observability/langsmithTracer";
import { resolveOpenAIExecutorConfig } from "../runtime/createOpenAIExecutor";
import { createRuntimeExecutor } from "../runtime/createRuntimeExecutor";

test("resolveLangSmithTraceConfig prefers WORKSPACE_ID over the legacy fallback", () => {
  const config = resolveLangSmithTraceConfig({
    LANGSMITH_TRACING: "true",
    LANGSMITH_API_KEY: "lsv2_test",
    WORKSPACE_ID: "workspace-preferred",
    LANGSMITH_WORKSPACE_ID: "workspace-legacy",
    LANGSMITH_PROJECT: "shipyard-runtime-observability"
  });

  assert.equal(config.workspaceId, "workspace-preferred");
  assert.equal(config.project, "shipyard-runtime-observability");
  assert.equal(config.enabled, true);
});

test("local trace service records root and child spans", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-trace-service-"));
  const traceLogPath = path.join(tempDir, "traces.jsonl");
  const traceService = createTraceService({
    logPath: traceLogPath,
    env: {}
  });

  try {
    const runTrace = await traceService.startRun({
      runId: "run-1",
      taskId: "task-1",
      name: "test run",
      inputSummary: "Summarize runtime status."
    });
    const toolTrace = await runTrace.startChild({
      name: "tool:search_repo",
      spanType: "tool",
      inputSummary: "Search the repo for runtime status."
    });

    toolTrace.addEvent("selected_file", {
      message: "Selected src/runtime.ts for inspection.",
      metadata: {
        path: "src/runtime.ts"
      }
    });
    await toolTrace.end({
      status: "completed",
      outputSummary: "Found 1 match."
    });
    await runTrace.end({
      status: "completed",
      outputSummary: "Run completed."
    });
    await waitForTraceFlush(traceService);

    const trace = traceService.getRunTrace("run-1");

    assert.ok(trace);
    assert.equal(trace?.spans.length, 2);
    assert.equal(trace?.spans.find((span) => span.parentId === null)?.spanType, "run");
    assert.equal(trace?.spans.find((span) => span.spanType === "tool")?.events[0]?.name, "selected_file");
    assert.match(await readFile(traceLogPath, "utf8"), /span_started/);
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime traces planner executor verifier and context spans for a successful run", async () => {
  const { instructionRuntime, assembler } = await createHarness();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-trace-"));
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    contextAssembler: assembler,
    traceService,
    executeRun: async (run, context) => ({
      mode: "placeholder-execution",
      summary: run.context.objective ?? run.instruction,
      instructionEcho: run.instruction,
      skillId: context.instructionRuntime.skill.meta.id,
      completedAt: new Date().toISOString()
    })
  });

  try {
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
    await waitForTraceFlush(traceService);
    const trace = traceService.getRunTrace(run.id);

    assert.ok(completedRun.result);
    assert.ok(trace);
    assert.ok(trace?.summary);
    assert.ok(trace?.spans.some((span) => span.spanType === "run"));
    assert.ok(trace?.spans.some((span) => span.spanType === "context"));
    assert.ok(trace?.spans.some((span) => span.name === "planner"));
    assert.ok(trace?.spans.some((span) => span.name === "executor"));
    assert.ok(trace?.spans.some((span) => span.name === "verifier"));
    assert.ok(
      trace?.spans.some(
        (span) =>
          span.spanType === "context" &&
          Array.isArray(span.metadata.sectionIds) &&
          span.metadata.sectionIds.includes("task-objective")
      )
    );
    assert.ok(
      trace?.spans
        .flatMap((span) => span.events)
        .some((event) => event.name === "handoff_created")
    );
    assert.ok(
      trace?.spans
        .flatMap((span) => span.events)
        .some((event) => event.name === "state_merged")
    );
    assert.ok(
      trace?.spans
        .flatMap((span) => span.events)
        .some((event) => event.name === "coordinator_decision")
    );
    assert.equal(trace?.summary.roleFlow, "orchestration");
    assert.equal(trace?.summary.model.modelId, null);
    assert.equal(trace?.summary.files.selectedCount, 1);
    assert.equal(trace?.summary.validation.status, "not_run");
    assert.equal(trace?.summary.orchestration?.status, "completed");
    assert.equal(trace?.summary.orchestration?.maxStepRetries, 1);
    assert.equal(trace?.summary.orchestration?.maxReplans, 1);
    assert.equal(trace?.summary.orchestration?.stepRetryCount, 0);
    assert.equal(trace?.summary.orchestration?.replanCount, 0);
    assert.equal(trace?.summary.phaseExecution, null);
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime trace summary captures phase execution progress and retry policy", async () => {
  const { instructionRuntime, assembler } = await createHarness();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-phase-trace-"));
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    contextAssembler: assembler,
    traceService,
    executeRun: async (run, context) => ({
      mode: "placeholder-execution",
      summary: run.context.objective ?? run.instruction,
      instructionEcho: run.instruction,
      skillId: context.instructionRuntime.skill.meta.id,
      completedAt: new Date().toISOString()
    })
  });

  try {
    const run = await runtimeService.submitTask({
      instruction: "Execute one phase task.",
      phaseExecution: {
        phases: [
          {
            id: "phase-1",
            name: "Phase 1",
            description: "Test phase execution tracing.",
            userStories: [
              {
                id: "story-1",
                title: "Story 1",
                description: "Test story.",
                acceptanceCriteria: ["Do the task."],
                tasks: [
                  {
                    id: "task-1",
                    instruction: "Do the task.",
                    expectedOutcome: "Do the task."
                  }
                ]
              }
            ]
          }
        ]
      }
    });

    await waitForRunStatus(runtimeService, run.id, "completed");
    await waitForTraceFlush(traceService);
    const trace = traceService.getRunTrace(run.id);

    assert.equal(trace?.summary.roleFlow, "phase-execution");
    assert.equal(trace?.summary.phaseExecution?.status, "completed");
    assert.equal(trace?.summary.phaseExecution?.currentPhaseId, null);
    assert.equal(trace?.summary.phaseExecution?.completedPhases, 1);
    assert.equal(trace?.summary.phaseExecution?.totalPhases, 1);
    assert.equal(trace?.summary.phaseExecution?.completedStories, 1);
    assert.equal(trace?.summary.phaseExecution?.totalStories, 1);
    assert.equal(trace?.summary.phaseExecution?.completedTasks, 1);
    assert.equal(trace?.summary.phaseExecution?.totalTasks, 1);
    assert.equal(trace?.summary.phaseExecution?.maxTaskRetries, 1);
    assert.equal(trace?.summary.phaseExecution?.maxStoryRetries, 1);
    assert.equal(trace?.summary.phaseExecution?.maxReplans, 1);
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime traces tool and validation spans for a repo edit", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-edit-trace-"));
  const filePath = path.join(tempDir, "src/example.ts");
  const instructionRuntime = await createInstructionRuntimeForTests();
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });
  const repoToolset = createRepoToolset({ rootDir: tempDir });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    traceService,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({}),
      repoToolset
    })
  });

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      ["export function greet(name: string) {", "  return `Hello ${name}`;", "}"].join("\n"),
      "utf8"
    );

    const run = await runtimeService.submitTask({
      instruction: "Edit the greet function surgically.",
      toolRequest: {
        toolName: "edit_file_region",
        input: {
          path: "src/example.ts",
          anchor: "export function greet",
          currentText: [
            "export function greet(name: string) {",
            "  return `Hello ${name}`;",
            "}"
          ].join("\n"),
          replacementText: [
            "export function greet(name: string) {",
            "  return `Hi ${name}`;",
            "}"
          ].join("\n")
        }
      }
    });

    await waitForRunStatus(runtimeService, run.id, "completed");
    await waitForTraceFlush(traceService);
    const trace = traceService.getRunTrace(run.id);

    assert.ok(trace?.spans.some((span) => span.name.startsWith("tool:edit_file_region")));
    assert.ok(trace?.spans.some((span) => span.spanType === "validation"));
    assert.equal(trace?.summary.tools.names[0], "edit_file_region");
    assert.equal(trace?.summary.files.changedPaths[0], "src/example.ts");
    assert.equal(trace?.summary.validation.failureCount, 0);
    assert.equal(
      await readFile(filePath, "utf8"),
      ["export function greet(name: string) {", "  return `Hi ${name}`;", "}"].join("\n")
    );
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime traces retry and rollback events on failed validation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-retry-trace-"));
  const instructionRuntime = await createInstructionRuntimeForTests();
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    traceService,
    executeRun: async () => {
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

  try {
    const run = await runtimeService.submitTask({
      instruction: "Retry this invalid edit once."
    });

    await waitForRunStatus(runtimeService, run.id, "failed");
    await waitForTraceFlush(traceService);
    const trace = traceService.getRunTrace(run.id);
    const rootSpan = trace?.spans.find((span) => span.parentId === null);

    assert.ok(rootSpan?.events.some((event) => event.name === "retry_scheduled"));
    assert.ok(rootSpan?.events.some((event) => event.name === "rollback_succeeded"));
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
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

async function waitForTraceFlush(traceService: { flush(): Promise<void> }) {
  await traceService.flush();
}
