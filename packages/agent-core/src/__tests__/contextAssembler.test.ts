import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createAgentRuntime } from "../runtime/createAgentRuntime";
import { createContextAssembler, runtimeContextPrecedence } from "../context/createContextAssembler";
import type { AgentRunRecord, AgentRuntimeStatus } from "../runtime/types";

test("planner payload assembly stays role-scoped and omits raw tool results", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("planner", {
    run: createRunRecord(),
    runtimeStatus: createRuntimeStatus()
  });

  assert.equal(payload.role, "planner");
  assert.deepEqual(payload.precedence, runtimeContextPrecedence);
  assert.equal(payload.sections[0]?.precedence, "runtime/system contract");
  assert.ok(payload.sections.some((section) => section.id === "task-objective"));
  assert.ok(payload.sections.some((section) => section.id === "project-rules"));
  assert.ok(payload.omittedSections.some((section) => section.id === "recent-tool-results"));
  assert.ok(payload.prompt.includes("# Planner Context Payload"));
});

test("executor payload assembly includes files, validation targets, and tool results", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("executor", {
    run: createRunRecord({
      result: {
        mode: "repo-tool",
        summary: "Edited src/example.ts.",
        instructionEcho: "Edit example",
        skillId: "coding-agent",
        completedAt: "2026-03-24T12:00:00.000Z",
        toolResult: {
          ok: true,
          toolName: "create_file",
          data: {
            rootDir: "/tmp/repo",
            path: "src/example.ts",
            status: "success",
            lineCount: 2,
            validationResult: {
              success: true,
              type: "file",
              path: "src/example.ts",
              checks: {
                fileExists: true
              }
            }
          }
        }
      }
    }),
    runtimeStatus: createRuntimeStatus()
  });

  assert.equal(payload.role, "executor");
  assert.ok(payload.sections.some((section) => section.id === "relevant-files"));
  assert.ok(payload.sections.some((section) => section.id === "recent-tool-results"));
  assert.ok(payload.sections.some((section) => section.id === "validation-targets"));
  assert.ok(payload.prompt.includes("Executor Context Payload"));
});

test("verifier payload assembly includes failures and rolling summary", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("verifier", {
    run: createRunRecord({
      status: "failed",
      rollingSummary: {
        text: "Run failed while validating src/example.ts.",
        updatedAt: "2026-03-24T12:10:00.000Z",
        source: "failure"
      },
      error: {
        message: "Validation failed after edit.",
        code: "validation_failed",
        path: "src/example.ts"
      },
      events: [
        {
          at: "2026-03-24T12:09:00.000Z",
          type: "validation_failed",
          message: "Validation failed after edit.",
          path: "src/example.ts",
          retryCount: 1
        }
      ]
    }),
    runtimeStatus: createRuntimeStatus()
  });

  assert.equal(payload.role, "verifier");
  assert.ok(payload.sections.some((section) => section.id === "known-failures"));
  assert.ok(payload.sections.some((section) => section.id === "rolling-summary"));
  assert.ok(payload.prompt.includes("Run failed while validating src/example.ts."));
});

test("rolling summary defaults to omitted when no prior step state exists", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("executor", {
    run: createRunRecord({
      rollingSummary: null
    }),
    runtimeStatus: createRuntimeStatus()
  });

  assert.ok(payload.omittedSections.some((section) => section.id === "rolling-summary"));
});

async function createAssemblerForTests() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );

  const instructionRuntime = await createAgentRuntime({ skillPath });

  return createContextAssembler({
    instructionRuntime,
    projectRules: {
      sourcePath: "/tmp/project-rules.md",
      loadedAt: "2026-03-24T12:00:00.000Z",
      content: "# Project Rules\n\n- Keep changes minimal.\n- Validate every meaningful edit."
    }
  });
}

function createRunRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run-123",
    title: "Implement context assembly",
    instruction: "Build the context assembler and expose it through a debug route.",
    simulateFailure: false,
    toolRequest: {
      toolName: "edit_file_region",
      input: {
        path: "src/example.ts",
        anchor: "export function greet",
        currentText: "before",
        replacementText: "after"
      }
    },
    attachments: overrides.attachments ?? [],
    context: {
      objective: "Assemble role-scoped runtime context.",
      constraints: ["Do not build orchestration yet.", "Keep the payload inspectable."],
      relevantFiles: [
        {
          path: "src/example.ts",
          excerpt: "export function greet() {}",
          startLine: 1,
          endLine: 1,
          source: "read_file_range",
          reason: "Target file for the next edit."
        }
      ],
      validationTargets: ["pnpm --filter @shipyard/server typecheck"]
    },
    status: "completed",
    createdAt: "2026-03-24T12:00:00.000Z",
    startedAt: "2026-03-24T12:01:00.000Z",
    completedAt: "2026-03-24T12:02:00.000Z",
    retryCount: 0,
    validationStatus: "passed",
    lastValidationResult: {
      success: true,
      type: "file",
      path: "src/example.ts",
      checks: {
        unchangedOutsideRegion: true
      }
    },
    rollingSummary: {
      text: "Edited src/example.ts and validated the change.",
      updatedAt: "2026-03-24T12:02:00.000Z",
      source: "result"
    },
    events: [],
    error: null,
    result: {
      mode: "placeholder-execution",
      summary: "Context assembly completed.",
      instructionEcho: "Build the context assembler.",
      skillId: "coding-agent",
      completedAt: "2026-03-24T12:02:00.000Z"
    },
    ...overrides
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
      running: 0,
      completed: 1,
      failed: 0
    },
    instructions: {
      skillId: "coding-agent",
      loadedAt: "2026-03-24T11:59:00.000Z"
    }
  };
}
