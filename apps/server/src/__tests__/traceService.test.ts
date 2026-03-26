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

test("trace summary rolls up model tool and context insights", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-trace-rollup-"));
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });

  try {
    const runTrace = await traceService.startRun({
      runId: "run-rollup",
      taskId: "task-rollup",
      name: "trace rollup",
      inputSummary: "Inspect trace rollups."
    });
    const contextTrace = await runTrace.startChild({
      name: "planner:context",
      spanType: "context",
      inputSummary: "Assemble planner context.",
      metadata: {
        role: "planner",
        sectionIds: ["task-objective", "constraints"],
        omittedSectionIds: ["known-failures"],
        truncatedSectionIds: ["external-context:spec"],
        omittedForBudgetSectionIds: ["external-context:tests"],
        maxPromptChars: 16000,
        maxPromptTokens: 3200,
        maxOutputTokens: 800,
        usedPromptChars: 15000,
        usedPromptTokens: 2900,
        promptLength: 128,
        rollingSummarySource: "result",
        externalContextKinds: ["spec", "test_result"],
        selectedFiles: [
          {
            path: "src/runtime.ts",
            source: "task_input",
            reason: "Explicitly referenced by the operator."
          }
        ]
      },
      tags: ["context", "role:planner"]
    });
    await contextTrace.end({
      status: "completed",
      outputSummary: "Assembled planner context."
    });

    const modelTrace = await runTrace.startChild({
      name: "model:gpt-4o-mini",
      spanType: "model",
      inputSummary: "Plan the next step.",
      metadata: {
        provider: "openai",
        modelId: "gpt-4o-mini",
        inputTokens: 120,
        outputTokens: 18,
        totalTokens: 138,
        providerLatencyMs: 812,
        firstTokenLatencyMs: 201,
        estimatedCostUsd: null,
        estimatedCostStatus: "unavailable"
      },
      tags: ["model", "provider:openai", "model:gpt-4o-mini"]
    });
    await modelTrace.end({
      status: "completed",
      outputSummary: "Planned the next step."
    });

    const toolTrace = await runTrace.startChild({
      name: "tool:search_repo",
      spanType: "tool",
      inputSummary: "Search the repo for runtime status.",
      metadata: {
        toolName: "search_repo",
        toolCategory: "inspection",
        toolTags: ["repo-tool", "tool:search_repo", "tool-category:inspection"],
        selectedFiles: [
          {
            path: "src/runtime.ts",
            source: "repo_tool",
            reason: "Matched the search query."
          }
        ]
      },
      tags: ["repo-tool", "tool:search_repo", "tool-category:inspection"]
    });
    await toolTrace.end({
      status: "completed",
      outputSummary: "Found runtime.ts."
    });

    await runTrace.end({
      status: "completed",
      outputSummary: "Run completed."
    });
    await waitForTraceFlush(traceService);

    const trace = traceService.getRunTrace("run-rollup");

    assert.ok(trace);
    assert.equal(trace?.summary.model.callCount, 1);
    assert.equal(trace?.summary.model.models[0]?.modelId, "gpt-4o-mini");
    assert.equal(trace?.summary.tools.categories[0], "inspection");
    assert.equal(trace?.summary.tools.byTool[0]?.name, "search_repo");
    assert.equal(trace?.summary.context.roleCount, 1);
    assert.equal(trace?.summary.context.roles[0]?.role, "planner");
    assert.equal(trace?.summary.context.roles[0]?.sectionCount, 2);
    assert.equal(trace?.summary.context.roles[0]?.truncatedSectionCount, 1);
    assert.equal(trace?.summary.context.roles[0]?.omittedForBudgetSectionCount, 1);
    assert.equal(trace?.summary.context.roles[0]?.maxPromptTokens, 3200);
    assert.equal(trace?.summary.context.roles[0]?.maxOutputTokens, 800);
    assert.equal(trace?.summary.context.roles[0]?.usedPromptTokens, 2900);
    assert.equal(trace?.summary.context.roles[0]?.externalContextKinds[0], "spec");
    assert.equal(trace?.summary.context.totalPromptTokens, 2900);
    assert.equal(trace?.summary.files.selectedBySource[0]?.source, "repo_tool");
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
        externalContext: [
          {
            id: "spec",
            kind: "spec",
            title: "Runtime summary spec",
            content: "S".repeat(8_000),
            source: "docs/runtime-spec.md",
            format: "markdown"
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
    assert.equal(trace?.summary.context.roleCount, 3);
    assert.deepEqual(
      trace?.summary.context.roles.map((role) => role.role).sort(),
      ["executor", "planner", "verifier"]
    );
    assert.ok(
      trace?.summary.context.roles.every((role) => role.externalContextKinds.includes("spec"))
    );
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
    assert.equal(trace?.summary.controlPlane?.status, "completed");
    assert.ok((trace?.summary.controlPlane?.artifactCount ?? 0) >= 3);
    assert.ok(trace?.summary.controlPlane?.artifactKinds.includes("requirements"));
    assert.ok(trace?.summary.controlPlane?.artifactKinds.includes("subtask_breakdown"));
    assert.ok((trace?.summary.controlPlane?.handoffCount ?? 0) >= 3);
    assert.ok((trace?.summary.controlPlane?.workPacketCount ?? 0) >= 3);
    assert.equal(trace?.summary.controlPlane?.conflictCount, 0);
    assert.equal(trace?.summary.controlPlane?.openConflictCount, 0);
    assert.equal(trace?.summary.controlPlane?.mergeDecisionCount, 0);
    assert.ok(
      trace?.spans
        .flatMap((span) => span.events)
        .some((event) => event.name === "control_plane_artifact_recorded")
    );
    assert.ok(
      trace?.spans
        .flatMap((span) => span.events)
        .some((event) => event.name === "control_plane_handoff_recorded")
    );
  } finally {
    await waitForTraceFlush(traceService);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime trace summary captures rebuild targets and intervention evidence", async () => {
  const { instructionRuntime, assembler } = await createHarness();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-rebuild-trace-"));
  const traceService = createTraceService({
    logPath: path.join(tempDir, "traces.jsonl"),
    env: {}
  });
  const attempts = new Map<string, number>();
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    contextAssembler: assembler,
    traceService,
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

  try {
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

    await waitForRunStatus(runtimeService, run.id, "completed");
    await waitForTraceFlush(traceService);
    const trace = traceService.getRunTrace(run.id);

    assert.equal(trace?.summary.roleFlow, "ship-rebuild");
    assert.equal(trace?.summary.rebuild?.status, "completed");
    assert.equal(trace?.summary.rebuild?.shipId, "ship-scopex");
    assert.equal(trace?.summary.rebuild?.label, "Scopex rebuild");
    assert.equal(trace?.summary.rebuild?.baseBranch, "main");
    assert.deepEqual(trace?.summary.rebuild?.entryPaths, [
      "client/src/App.tsx",
      "server/src/index.ts"
    ]);
    assert.equal(trace?.summary.rebuild?.validationStatus, "passed");
    assert.ok((trace?.summary.rebuild?.artifactCount ?? 0) >= 1);
    assert.ok(trace?.summary.rebuild?.artifactKinds.includes("task_result"));
    assert.ok(trace?.summary.rebuild?.artifactKinds.includes("validation_report"));
    assert.equal(trace?.summary.rebuild?.interventionCount, 1);
    assert.ok(trace?.summary.rebuild?.interventionKinds.includes("retry"));
    assert.equal(trace?.summary.phaseExecution?.completedTasks, 1);
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
    assert.equal(trace?.summary.tools.categories[0], "mutation");
    assert.equal(trace?.summary.tools.byTool[0]?.successCount, 1);
    assert.ok(trace?.summary.tools.byTool[0]?.tags.includes("tool-category:mutation"));
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
    assert.equal(trace?.summary.retries.count, 1);
    assert.equal(trace?.summary.rollbacks.successCount, 1);
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
