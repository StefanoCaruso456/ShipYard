import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createAgentRuntime } from "../runtime/createAgentRuntime";
import { createContextAssembler, runtimeContextPrecedence } from "../context/createContextAssembler";
import { createControlPlaneState } from "../runtime/controlPlane";
import { normalizePhaseExecutionInput } from "../runtime/phaseExecution";
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

test("planner payload assembly includes external context in deterministic role order", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("planner", {
    run: createRunRecord({
      context: {
        objective: "Plan the next step.",
        constraints: [],
        relevantFiles: [],
        externalContext: [
          {
            id: "tests",
            kind: "test_result",
            title: "Failing tests",
            content: "FAIL src/example.test.ts",
            source: "pnpm test",
            format: "text"
          },
          {
            id: "schema",
            kind: "schema",
            title: "Task schema",
            content: JSON.stringify({ type: "object", properties: { id: { type: "string" } } }, null, 2),
            source: "docs/schema.json",
            format: "json"
          },
          {
            id: "spec",
            kind: "spec",
            title: "Feature spec",
            content: "# Spec\n\n- Keep the flow scoped.",
            source: "docs/spec.md",
            format: "markdown"
          }
        ],
        validationTargets: []
      },
      toolRequest: null
    }),
    runtimeStatus: createRuntimeStatus()
  });

  const externalSectionIds = payload.sections
    .filter((section) => section.id.startsWith("external-context:"))
    .map((section) => section.id);
  const specSection = payload.sections.find((section) => section.id === "external-context:spec");

  assert.deepEqual(externalSectionIds, [
    "external-context:spec",
    "external-context:schema",
    "external-context:tests"
  ]);
  assert.equal(specSection?.precedence, "live execution context");
  assert.equal(specSection?.metadata?.contextKind, "spec");
});

test("executor payload truncates oversized external context and records budget metadata", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("executor", {
    run: createRunRecord({
      context: {
        objective: "Use the injected prior output.",
        constraints: [],
        relevantFiles: [],
        externalContext: [
          {
            id: "prior-output",
            kind: "prior_output",
            title: "Previous draft",
            content: "A".repeat(10_000),
            source: "run-previous",
            format: "text"
          }
        ],
        validationTargets: []
      },
      toolRequest: null
    }),
    runtimeStatus: createRuntimeStatus()
  });

  const externalSection = payload.sections.find(
    (section) => section.id === "external-context:prior-output"
  );

  assert.ok(externalSection);
  assert.equal(externalSection?.metadata?.truncated, true);
  assert.ok(payload.budget.truncatedSectionIds.includes("external-context:prior-output"));
  assert.ok(payload.budget.usedPromptChars <= payload.budget.maxPromptChars);
  assert.ok(payload.budget.usedPromptTokens <= payload.budget.maxPromptTokens);
  assert.ok(payload.budget.maxOutputTokens > 0);
  assert.match(externalSection?.content ?? "", /\[Truncated for executor context budget\./);
});

test("verifier payload records budget-driven section omissions deterministically", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("verifier", {
    run: createRunRecord({
      toolRequest: null,
      rollingSummary: null,
      context: {
        objective: "Verify the result against external evidence.",
        constraints: [],
        relevantFiles: [],
        externalContext: Array.from({ length: 8 }, (_, index) => ({
          id: `evidence-${index + 1}`,
          kind: "test_result" as const,
          title: `Evidence ${index + 1}`,
          content: "B".repeat(9_000),
          source: `test-run-${index + 1}`,
          format: "text" as const
        })),
        validationTargets: []
      }
    }),
    runtimeStatus: createRuntimeStatus()
  });

  assert.ok(payload.budget.omittedForBudgetSectionIds.length > 0);
  assert.ok(
    payload.omittedSections.some((section) =>
      section.reason.includes("context budget of")
    )
  );
  assert.ok(payload.budget.usedPromptChars <= payload.budget.maxPromptChars);
  assert.ok(payload.budget.usedPromptTokens <= payload.budget.maxPromptTokens);
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

test("executor payload reflects the active phase execution task", async () => {
  const assembler = await createAssemblerForTests();
  const payload = assembler.buildRolePayload("executor", {
    run: createRunRecord({
      instruction: "Top-level execution plan",
      phaseExecution: {
        status: "in_progress",
        activeApprovalGateId: null,
        current: {
          phaseId: "phase-a",
          storyId: "story-a",
          taskId: "task-a"
        },
        progress: {
          totalPhases: 1,
          completedPhases: 0,
          totalStories: 1,
          completedStories: 0,
          totalTasks: 1,
          completedTasks: 0
        },
        retryPolicy: {
          maxTaskRetries: 1,
          maxStoryRetries: 1,
          maxReplans: 1
        },
        lastFailureReason: null,
        phases: [
          {
            id: "phase-a",
            name: "Phase A",
            description: "Phase A description",
            approvalGate: null,
            status: "in_progress",
            failureReason: null,
            lastValidationResults: null,
            userStories: [
              {
                id: "story-a",
                title: "Story A",
                description: "Story A description",
                acceptanceCriteria: ["Ship the scoped task"],
                preferredSpecialistAgentTypeId: null,
                validationGates: [],
                status: "in_progress",
                retryCount: 0,
                failureReason: null,
                lastValidationResults: null,
                tasks: [
                  {
                    id: "task-a",
                    instruction: "Ship the scoped task",
                    expectedOutcome: "Ship the scoped task",
                    status: "running",
                    toolRequest: null,
                    context: null,
                    requiredSpecialistAgentTypeId: null,
                    allowedToolNames: null,
                    validationGates: [],
                    retryCount: 0,
                    failureReason: null,
                    lastValidationResults: null,
                    result: null
                  }
                ]
              }
            ]
          }
        ]
      }
    }),
    runtimeStatus: createRuntimeStatus()
  });

  const objectiveSection = payload.sections.find((section) => section.id === "task-objective");
  const stateSection = payload.sections.find((section) => section.id === "current-run-state");

  assert.equal(objectiveSection?.content, "Ship the scoped task");
  assert.match(stateSection?.content ?? "", /"phaseExecution"/);
  assert.match(stateSection?.content ?? "", /"taskId": "task-a"/);
});

test("executor payload includes assigned specialist guidance for the active execution subagent", async () => {
  const assembler = await createAssemblerForTests();
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "phase-specialist",
        name: "Specialist",
        description: "Exercise specialist assignment.",
        userStories: [
          {
            id: "story-specialist",
            title: "Backend delivery",
            description: "Route the work to backend specialists.",
            preferredSpecialistAgentTypeId: "backend_dev",
            acceptanceCriteria: ["Deliver the backend change"],
            tasks: [
              {
                id: "task-specialist",
                instruction: "Apply the backend change.",
                expectedOutcome: "Deliver the backend change"
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
    phaseId: "phase-specialist",
    storyId: "story-specialist",
    taskId: "task-specialist"
  };

  const controlPlane = createControlPlaneState(phaseExecution);
  const payload = assembler.buildRolePayload("executor", {
    run: createRunRecord({
      phaseExecution,
      controlPlane,
      status: "running"
    }),
    runtimeStatus: createRuntimeStatus()
  });

  const specialistSection = payload.sections.find(
    (section) => section.id === "specialist-skill-guidance"
  );

  assert.ok(specialistSection);
  assert.match(specialistSection?.title ?? "", /Execution Subagent/);
  assert.match(specialistSection?.content ?? "", /Backend Dev/);
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
  const baseContext = {
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
    externalContext: [],
    validationTargets: ["pnpm --filter @shipyard/server typecheck"]
  };

  const baseResult: NonNullable<AgentRunRecord["result"]> = {
    mode: "placeholder-execution",
    summary: "Context assembly completed.",
    instructionEcho: "Build the context assembler.",
    skillId: "coding-agent",
    completedAt: "2026-03-24T12:02:00.000Z"
  };

  return {
    id: overrides.id ?? "run-123",
    threadId: overrides.threadId ?? overrides.id ?? "run-123",
    parentRunId: overrides.parentRunId ?? null,
    title: overrides.title ?? "Implement context assembly",
    instruction:
      overrides.instruction ??
      "Build the context assembler and expose it through a debug route.",
    simulateFailure: overrides.simulateFailure ?? false,
    toolRequest: overrides.toolRequest ?? {
      toolName: "edit_file_region",
      input: {
        path: "src/example.ts",
        anchor: "export function greet",
        currentText: "before",
        replacementText: "after"
      }
    },
    attachments: overrides.attachments ?? [],
    context: overrides.context ?? baseContext,
    status: overrides.status ?? "completed",
    createdAt: overrides.createdAt ?? "2026-03-24T12:00:00.000Z",
    startedAt: overrides.startedAt ?? "2026-03-24T12:01:00.000Z",
    completedAt: overrides.completedAt ?? "2026-03-24T12:02:00.000Z",
    retryCount: overrides.retryCount ?? 0,
    validationStatus: overrides.validationStatus ?? "passed",
    lastValidationResult:
      "lastValidationResult" in overrides
        ? overrides.lastValidationResult ?? null
        : {
      success: true,
      type: "file",
      path: "src/example.ts",
      checks: {
        unchangedOutsideRegion: true
      }
    },
    orchestration: overrides.orchestration ?? null,
    phaseExecution: overrides.phaseExecution ?? undefined,
    rollingSummary:
      "rollingSummary" in overrides
        ? overrides.rollingSummary ?? null
        : {
      text: "Edited src/example.ts and validated the change.",
      updatedAt: "2026-03-24T12:02:00.000Z",
      source: "result"
    },
    events: overrides.events ?? [],
    controlPlane: "controlPlane" in overrides ? overrides.controlPlane ?? null : null,
    error: overrides.error ?? null,
    result: "result" in overrides ? overrides.result ?? null : baseResult
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
      paused: 0,
      completed: 1,
      failed: 0
    },
    instructions: {
      skillId: "coding-agent",
      loadedAt: "2026-03-24T11:59:00.000Z"
    }
  };
}
