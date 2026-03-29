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
import { prepareFactoryTaskSubmission } from "../runtime/prepareFactoryTaskSubmission";
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

test("runtime executor can complete a prepared Factory submission and apply runtime workspace plans", async () => {
  const defaultDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-default-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "shipyard-factory-e2e-"));
  const instructionRuntime = await createInstructionRuntimeForTests();
  const repoToolset = createRepoToolset({ rootDir: defaultDir });
  const structuredPlanTaskIds = new Set<string>();
  const runtimeService = await createPersistentRuntimeService({
    instructionRuntime,
    executeRun: createRuntimeExecutor({
      openAI: resolveOpenAIExecutorConfig({
        OPENAI_KEY: "test-key"
      }),
      repoToolset,
      generateTextImpl: (async (input: {
        prompt?: string;
        output?: unknown;
      }) => {
        const prompt = input.prompt ?? "";
        const expectedOutcome = extractExpectedOutcome(prompt);

        if (input.output) {
          const taskId = extractTaskId(prompt);

          structuredPlanTaskIds.add(taskId);

          return {
            text: "",
            output: {
              operations: buildFactoryWorkspaceOperations({
                taskId,
                expectedOutcome,
                appName: extractFactoryAppName(prompt),
                repositoryName: extractFactoryRepositoryName(prompt)
              })
            },
            usage: {
              inputTokens: 20,
              outputTokens: 30,
              totalTokens: 50
            },
            totalUsage: {
              inputTokens: 20,
              outputTokens: 30,
              totalTokens: 50
            }
          };
        }

        return {
          text: [
            `Completed ${extractCurrentTaskLabel(prompt)} for the current Factory stage.`,
            expectedOutcome
          ].join("\n\n"),
          usage: {
            inputTokens: 40,
            outputTokens: 60,
            totalTokens: 100
          },
          totalUsage: {
            inputTokens: 40,
            outputTokens: 60,
            totalTokens: 100
          }
        };
      }) as unknown as typeof generateText
    })
  });

  try {
    const submission = await prepareFactoryTaskSubmission(
      {
        instruction: [
          "Build a Jira-style project management application in Factory Mode.",
          "",
          "Initial slice:",
          "- application shell",
          "- backlog view",
          "- issue detail surface"
        ].join("\n"),
        project: {
          id: "shipyard-runtime",
          kind: "live"
        },
        operatingMode: "factory",
        factory: {
          appName: "Jira",
          stackTemplateId: "nextjs_supabase_vercel",
          repository: {
            provider: "github",
            owner: "acme",
            name: "jira",
            visibility: "private",
            baseBranch: "main"
          }
        }
      },
      {
        workspaceRoot
      }
    );

    const runtimeWorkspace = submission.project?.folder?.displayPath;

    assert.ok(runtimeWorkspace);

    const run = await runtimeService.submitTask(submission);
    const completedRun = await waitForRunStatus(runtimeService, run.id, "completed", {
      attempts: 800,
      delayMs: 5
    });

    assert.equal(completedRun.status, "completed");
    assert.equal(completedRun.result?.mode, "phase-execution");
    assert.equal(completedRun.phaseExecution?.status, "completed");
    assert.equal(completedRun.validationStatus, "passed");
    assert.ok(structuredPlanTaskIds.has("task-repository-bootstrap"));
    assert.ok(
      structuredPlanTaskIds.size >= 2,
      "expected structured workspace plans for at least bootstrap and one implementation task"
    );
    assert.ok(completedRun.events.some((event) => event.type === "validation_gate_passed"));
    assert.ok(
      completedRun.factory?.phaseVerificationResults.every((result) => result.status === "passed")
    );
    const packageManifest = await readFile(path.join(runtimeWorkspace, "package.json"), "utf8");

    assert.match(packageManifest, /"private": true/);
    assert.match(packageManifest, /"build": "node -e/);
    assert.match(packageManifest, /"typecheck": "node -e/);
    assert.match(
      await readFile(path.join(runtimeWorkspace, "src/app/page.tsx"), "utf8"),
      /export default function Page/
    );
    assert.match(
      await readFile(
        path.join(runtimeWorkspace, "factory-output/task-nextjs-shell.md"),
        "utf8"
      ),
      /Application shell implemented\./
    );
  } finally {
    await rm(defaultDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
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
  expectedStatus: AgentRunRecord["status"],
  options: {
    attempts?: number;
    delayMs?: number;
  } = {}
) {
  const maxAttempts = options.attempts ?? 50;
  const delayMs = options.delayMs ?? 0;
  let lastSeenRun: AgentRunRecord | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const run = runtimeService.getRun(runId);

    if (run) {
      lastSeenRun = run;
    }

    if (run?.status === expectedStatus) {
      return run;
    }

    if (
      expectedStatus !== "failed" &&
      expectedStatus !== "paused" &&
      (run?.status === "failed" || run?.status === "paused")
    ) {
      assert.fail(
        `Run ${runId} reached ${run.status} before ${expectedStatus}: ${run.error?.message ?? "no error"}`
      );
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  assert.fail(
    `Timed out waiting for run ${runId} to reach ${expectedStatus}. Last status: ${lastSeenRun?.status ?? "missing"}${lastSeenRun?.error?.message ? ` (${lastSeenRun.error.message})` : ""}.`
  );
}

function extractExpectedOutcome(prompt: string) {
  const match =
    prompt.match(/include this exact final standalone line: ([^\n]+)/) ??
    prompt.match(/Expected outcome:\n([^\n]+)/);

  return match?.[1]?.trim() || "Completed the current Factory task.";
}

function extractTaskId(prompt: string) {
  const match = prompt.match(/Task id: ([^\n]+)/);

  return match?.[1]?.trim() || "task-runtime-workspace";
}

function extractFactoryAppName(prompt: string) {
  const match = prompt.match(/App: ([^\n]+)/);

  return match?.[1]?.trim() || "Factory App";
}

function extractFactoryRepositoryName(prompt: string) {
  const match =
    prompt.match(/Repository target: (?:[^/\n]+\/)?([^\n]+)/) ??
    prompt.match(/Planned repository name: (?:[^/\n]+\/)?([^\n]+)/);

  return match?.[1]?.trim() || "factory-app";
}

function extractCurrentTaskLabel(prompt: string) {
  const taskId = extractTaskId(prompt);

  if (taskId !== "task-runtime-workspace") {
    return taskId;
  }

  const phaseMatch = prompt.match(/Current phase: ([^\n]+)/);

  return phaseMatch?.[1]?.trim() || "the current task";
}

function buildFactoryWorkspaceOperations(input: {
  taskId: string;
  expectedOutcome: string;
  appName: string;
  repositoryName: string;
}) {
  const safeTaskId = sanitizeTaskPathSegment(input.taskId);

  if (input.taskId === "task-repository-bootstrap") {
    return [
      {
        kind: "write_file" as const,
        path: "package.json",
        content: JSON.stringify(
          {
            name: input.repositoryName,
            private: true,
            scripts: {
              dev: "node -e \"console.log('dev ready')\"",
              build: "node -e \"console.log('build ready')\"",
              typecheck: "node -e \"console.log('typecheck ready')\""
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        kind: "write_file" as const,
        path: "src/app/page.tsx",
        content: `export default function Page() {\n  return "${input.appName}";\n}\n`
      }
    ];
  }

  return [
    {
      kind: "write_file" as const,
      path: `factory-output/${safeTaskId}.md`,
      content: `# ${input.taskId}\n\n${input.expectedOutcome}\n`
    }
  ];
}

function sanitizeTaskPathSegment(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
