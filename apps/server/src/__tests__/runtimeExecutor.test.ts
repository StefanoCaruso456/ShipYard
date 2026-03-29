import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentRuntime,
  createPersistentRuntimeService,
  createRepoToolset,
  type AgentRunRecord
} from "@shipyard/agent-core";
import { generateText } from "ai";

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

test("runtime executor can process a read_file task through the persistent runtime service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-read-file-"));
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
      instruction: "Read the greet file.",
      toolRequest: {
        toolName: "read_file",
        input: {
          path: "src/example.ts"
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(completedRun.result?.toolResult?.toolName, "read_file");
    assert.equal(completedRun.validationStatus, "not_run");
    assert.equal(completedRun.lastValidationResult, null);
    assert.deepEqual(completedRun.orchestration?.lastExecutorResult?.changedFiles, []);
    assert.ok(completedRun.result?.responseText?.includes("export function greet"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime executor can process a read_file_range task through the persistent runtime service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-read-range-"));
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
        "  const message = `Hello ${name}`;",
        "  return message;",
        "}"
      ].join("\n"),
      "utf8"
    );

    const run = await runtimeService.submitTask({
      instruction: "Read the body of the greet file.",
      toolRequest: {
        toolName: "read_file_range",
        input: {
          path: "src/example.ts",
          startLine: 2,
          endLine: 3
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(completedRun.result?.toolResult?.toolName, "read_file_range");
    assert.equal(completedRun.validationStatus, "not_run");
    assert.deepEqual(completedRun.orchestration?.lastExecutorResult?.changedFiles, []);
    assert.ok(completedRun.result?.responseText?.includes("const message"));
    assert.ok(completedRun.result?.responseText?.includes("return message"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime executor can process a search_repo task through the persistent runtime service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-search-"));
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
      instruction: "Search for greet.",
      toolRequest: {
        toolName: "search_repo",
        input: {
          query: "greet"
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(completedRun.result?.toolResult?.toolName, "search_repo");
    assert.equal(completedRun.validationStatus, "not_run");
    assert.deepEqual(completedRun.orchestration?.lastExecutorResult?.changedFiles, []);
    assert.ok(completedRun.result?.responseText?.includes("src/example.ts:1:17"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime executor can process a terminal git command through the persistent runtime service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-terminal-"));
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
    const run = await runtimeService.submitTask({
      instruction: "Initialize a git repository for this runtime workspace.",
      toolRequest: {
        toolName: "run_terminal_command",
        input: {
          commandLine: "git init -b main",
          category: "git"
        }
      },
      project: {
        id: "shipyard-runtime",
        kind: "live",
        folder: {
          name: "terminal-workspace",
          displayPath: tempDir,
          provider: "runtime",
          status: "connected"
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(completedRun.result?.toolResult?.toolName, "run_terminal_command");
    if (completedRun.result?.toolResult?.ok) {
      assert.equal(completedRun.result.toolResult.data.category, "git");
      assert.equal(completedRun.result.toolResult.data.commandLine, "git init -b main");
      assert.equal(completedRun.result.toolResult.data.exitCode, 0);
    }
    assert.equal(completedRun.validationStatus, "not_run");
    assert.deepEqual(completedRun.orchestration?.lastExecutorResult?.changedFiles, []);
    await access(path.join(tempDir, ".git"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime executor routes factory repo tools into the runtime workspace folder", async () => {
  const defaultDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-default-"));
  const factoryDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-factory-"));
  const instructionRuntime = await createInstructionRuntimeForTests();
  const repoToolset = createRepoToolset({ rootDir: defaultDir });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({}),
      repoToolset
    })
  });

  try {
    const run = await runtimeService.submitTask({
      instruction: "Create the initial factory README.",
      toolRequest: {
        toolName: "create_file",
        input: {
          path: "README.md",
          content: "# Factory app\n"
        }
      },
      project: {
        id: "shipyard-runtime",
        kind: "live",
        folder: {
          name: "factory-app",
          displayPath: factoryDir,
          provider: "runtime",
          status: "connected"
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "repo-tool");
    assert.equal(completedRun.result?.toolResult?.ok, true);
    assert.equal(
      await readFile(path.join(factoryDir, "README.md"), "utf8"),
      "# Factory app\n"
    );
    await assert.rejects(() => readFile(path.join(defaultDir, "README.md"), "utf8"));
  } finally {
    await rm(defaultDir, { recursive: true, force: true });
    await rm(factoryDir, { recursive: true, force: true });
  }
});

test("runtime executor applies workspace file plans for runtime-backed model responses", async () => {
  const defaultDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-plan-default-"));
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-plan-runtime-"));
  const instructionRuntime = await createInstructionRuntimeForTests();
  const repoToolset = createRepoToolset({ rootDir: defaultDir });
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({
        OPENAI_KEY: "test-key"
      }),
      repoToolset,
      generateTextImpl: (async () =>
        ({
          text:
            'Repository foundation scaffolded.\n\n<local-file-plan>\n{"operations":[{"kind":"mkdir","path":"src"},{"kind":"write_file","path":"src/index.ts","content":"export const ready = true;\\n"}]}\n</local-file-plan>',
          usage: {
            inputTokens: 11,
            outputTokens: 17,
            totalTokens: 28
          },
          totalUsage: {
            inputTokens: 11,
            outputTokens: 17,
            totalTokens: 28
          }
        })) as unknown as typeof generateText
    })
  });

  try {
    const run = await runtimeService.submitTask({
      instruction: "Scaffold the runtime workspace foundation.",
      project: {
        id: "shipyard-runtime",
        kind: "live",
        folder: {
          name: "runtime-plan-app",
          displayPath: runtimeDir,
          provider: "runtime",
          status: "connected"
        }
      }
    });

    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed");

    assert.equal(completedRun.result?.mode, "ai-sdk-openai");
    assert.equal(completedRun.validationStatus, "not_run");
    assert.equal(completedRun.result?.workspacePlan?.target, "runtime-folder");
    assert.deepEqual(completedRun.result?.workspacePlan?.writtenFiles, ["src/index.ts"]);
    assert.match(completedRun.result?.summary ?? "", /Applied workspace file plan/);
    assert.equal(
      await readFile(path.join(runtimeDir, "src/index.ts"), "utf8"),
      "export const ready = true;\n"
    );
    await assert.rejects(() => readFile(path.join(defaultDir, "src/index.ts"), "utf8"));
  } finally {
    await rm(defaultDir, { recursive: true, force: true });
    await rm(runtimeDir, { recursive: true, force: true });
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
