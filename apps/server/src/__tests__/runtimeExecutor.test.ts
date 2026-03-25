import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentRuntime,
  createPersistentRuntimeService,
  createRepoToolset,
  type AgentRunRecord
} from "@shipyard/agent-core";

import { resolveOpenAIExecutorConfig } from "../runtime/createOpenAIExecutor";
import { createRuntimeExecutor } from "../runtime/createRuntimeExecutor";

test("runtime executor can process an edit task through the persistent runtime service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-edit-"));
  const filePath = path.join(tempDir, "src/example.ts");
  const instructionRuntime = await createInstructionRuntimeForTests();
  const repoToolset = createRepoToolset({ rootDir: tempDir });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({}),
      repoToolset
    })
  });

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      [
        "export function greet(name: string) {",
        "  return `Hello ${name}`;",
        "}"
      ].join("\n"),
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

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(completedRun.validationStatus, "passed");
    assert.equal(completedRun.lastValidationResult?.success, true);
    assert.equal(completedRun.retryCount, 0);
    assert.ok(completedRun.events.some((event) => event.type === "validation_succeeded"));
    assert.equal(
      await readFile(filePath, "utf8"),
      [
        "export function greet(name: string) {",
        "  return `Hi ${name}`;",
        "}"
      ].join("\n")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime executor can process a phase execution plan that uses repo tools", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-phase-"));
  const filePath = path.join(tempDir, "src/example.ts");
  const instructionRuntime = await createInstructionRuntimeForTests();
  const repoToolset = createRepoToolset({ rootDir: tempDir });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({}),
      repoToolset
    })
  });

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      [
        "export function greet(name: string) {",
        "  return `Hello ${name}`;",
        "}"
      ].join("\n"),
      "utf8"
    );

    const run = await runtimeService.submitTask({
      instruction: "Execute the runtime editing phase.",
      phaseExecution: {
        phases: [
          {
            id: "phase-edit",
            name: "Edit code",
            description: "Run the repo tool through a task plan.",
            userStories: [
              {
                id: "story-edit",
                title: "Update greeting",
                description: "Change the greeting text through the runtime executor.",
                acceptanceCriteria: [
                  "Edited src/example.ts surgically around the provided anchor."
                ],
                tasks: [
                  {
                    id: "task-edit",
                    instruction: "Edit the greeting text.",
                    expectedOutcome: "Edited src/example.ts surgically around the provided anchor.",
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
    assert.equal(completedRun.validationStatus, "passed");
    assert.ok(completedRun.events.some((event) => event.type === "validation_gate_passed"));
    assert.equal(
      await readFile(filePath, "utf8"),
      [
        "export function greet(name: string) {",
        "  return `Hi ${name}`;",
        "}"
      ].join("\n")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
