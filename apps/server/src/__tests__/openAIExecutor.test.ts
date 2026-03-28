import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentRuntime, type AgentRunRecord } from "@shipyard/agent-core";
import { generateText } from "ai";

import {
  createOpenAIExecutor,
  resolveOpenAIExecutorConfig,
  type OpenAIExecutorConfig
} from "../runtime/createOpenAIExecutor";

test("resolveOpenAIExecutorConfig prefers OPENAI_KEY and falls back to OPENAI_API_KEY", () => {
  const preferredConfig = resolveOpenAIExecutorConfig({
    OPENAI_KEY: "primary-key",
    OPENAI_API_KEY: "compat-key",
    OPENAI_MODEL: "gpt-4.1-mini"
  });

  assert.equal(preferredConfig.configured, true);
  assert.equal(preferredConfig.apiKey, "primary-key");
  assert.equal(preferredConfig.apiKeySource, "OPENAI_KEY");
  assert.equal(preferredConfig.modelId, "gpt-4.1-mini");

  const fallbackConfig = resolveOpenAIExecutorConfig({
    OPENAI_API_KEY: "compat-key"
  });

  assert.equal(fallbackConfig.apiKey, "compat-key");
  assert.equal(fallbackConfig.apiKeySource, "OPENAI_API_KEY");
  assert.equal(fallbackConfig.modelId, "gpt-4o-mini");
});

test("createOpenAIExecutor returns a placeholder result when no key is configured", async () => {
  const executor = createOpenAIExecutor({
    config: resolveOpenAIExecutorConfig({})
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const result = await executor(createRun("Summarize runtime status"), {
    instructionRuntime
  });

  assert.equal(result.mode, "placeholder-execution");
  assert.match(result.summary, /OPENAI_KEY is not configured/);
  assert.match(result.responseText ?? "", /Configure OPENAI_KEY/);
});

test("createOpenAIExecutor maps AI SDK text into the runtime result", async () => {
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    generateTextImpl: (async () =>
      ({
        text: "Implementation plan ready.\n\nNext step: wire the runtime endpoint.",
        usage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        },
        totalUsage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        }
      })) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const result = await executor(createRun("Plan the next backend step"), {
    instructionRuntime
  });

  assert.equal(result.mode, "ai-sdk-openai");
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-4o-mini");
  assert.equal(result.responseText, "Implementation plan ready.\n\nNext step: wire the runtime endpoint.");
  assert.match(result.summary, /Implementation plan ready/);
  assert.equal(result.usage?.inputTokens, 12);
  assert.equal(result.usage?.outputTokens, 18);
  assert.equal(result.usage?.totalTokens, 30);
});

test("createOpenAIExecutor adds local file plan instructions for browser-backed projects", async () => {
  let capturedPrompt = "";
  let capturedMaxOutputTokens: number | undefined;
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    generateTextImpl: (async (input: { prompt?: string; maxOutputTokens?: number }) => {
      capturedPrompt = input.prompt ?? "";
      capturedMaxOutputTokens = input.maxOutputTokens;

      return {
        text:
          "Scaffold plan ready.\n\n<local-file-plan>\n{\"operations\":[{\"kind\":\"mkdir\",\"path\":\"src\"},{\"kind\":\"write_file\",\"path\":\"src/index.ts\",\"content\":\"export {};\\n\"}]}\n</local-file-plan>",
        usage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        },
        totalUsage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const result = await executor(
    createRun("Create the initial project scaffold", {
      project: {
        id: "project-local",
        name: "Local project",
        kind: "local",
        environment: "Browser workspace",
        description: "Connected local folder",
        folder: {
          name: "1st project",
          displayPath: "1st project",
          status: "connected",
          provider: "browser-file-system-access"
        }
      }
    }),
    {
      instructionRuntime
    }
  );

  assert.match(capturedPrompt, /Workspace file action contract/);
  assert.match(capturedPrompt, /<local-file-plan>/);
  assert.match(capturedPrompt, /Response style:/);
  assert.match(capturedPrompt, /Avoid internal runtime labels such as "Runtime result"/);
  assert.equal(capturedMaxOutputTokens, 1400);
  assert.equal(result.summary, "Scaffold plan ready.");
});

test("createOpenAIExecutor injects operating mode guidance into prompts", async () => {
  let capturedSystem = "";
  let capturedPrompt = "";
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    generateTextImpl: (async (input: { system?: string; prompt?: string }) => {
      capturedSystem = input.system ?? "";
      capturedPrompt = input.prompt ?? "";

      return {
        text: "Findings ready.",
        usage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        },
        totalUsage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();

  await executor(
    createRun("Review the runtime task route for risks.", {
      requestedOperatingMode: "review",
      operatingMode: "review"
    }),
    {
      instructionRuntime
    }
  );

  assert.match(capturedSystem, /Current operating mode: Review mode\./);
  assert.match(capturedPrompt, /Requested: Review mode/);
  assert.match(capturedPrompt, /Resolved: Review mode/);
  assert.match(capturedPrompt, /Stay review-focused and read-only/);
});

test("createOpenAIExecutor uses a local file plan summary when the response is plan-only", async () => {
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    generateTextImpl: (async () =>
      ({
        text:
          "<local-file-plan>\n{\"operations\":[{\"kind\":\"mkdir\",\"path\":\"src\"}]}\n</local-file-plan>",
        usage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        },
        totalUsage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        }
      })) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const result = await executor(createRun("Prepare a local file plan"), {
    instructionRuntime
  });

  assert.equal(result.summary, "Prepared a local file plan for the connected workspace.");
});

test("createOpenAIExecutor applies workspace plans for runtime-backed projects", async () => {
  let capturedPrompt = "";
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-plan-"));
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    generateTextImpl: (async (input: { prompt?: string }) => {
      capturedPrompt = input.prompt ?? "";

      return {
        text:
          "Implemented the first VendorFlow product flow.\n\nCore product flow implemented.\n\n<local-file-plan>\n{\"operations\":[{\"kind\":\"mkdir\",\"path\":\"src/app\"},{\"kind\":\"write_file\",\"path\":\"src/app/page.tsx\",\"content\":\"export default function Page() { return \\\"VendorFlow\\\"; }\\n\"}]}\n</local-file-plan>",
        usage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        },
        totalUsage: {
          inputTokens: 12,
          outputTokens: 18,
          totalTokens: 30
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();

  try {
    const result = await executor(
      createRun("Implement the first product flow", {
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "local",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "vendorflow",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState("Core product flow implemented.")
      }),
      {
        instructionRuntime
      }
    );

    assert.match(capturedPrompt, /Workspace file action contract/);
    assert.match(capturedPrompt, /runtime applies the plan during execution/);
    assert.match(capturedPrompt, /Completion contract:/);
    assert.match(
      capturedPrompt,
      /Only when the current task is actually complete, include this exact final standalone line: Core product flow implemented\./
    );
    assert.equal(
      await readFile(path.join(runtimeRoot, "src/app/page.tsx"), "utf8"),
      'export default function Page() { return "VendorFlow"; }\n'
    );
    assert.equal(
      result.responseText,
      "Implemented the first VendorFlow product flow.\n\nCore product flow implemented."
    );
    assert.equal(result.appliedWorkspacePlan?.provider, "runtime");
    assert.deepEqual(result.appliedWorkspacePlan?.changedFiles, ["src/app/page.tsx"]);
    assert.equal(result.appliedWorkspacePlan?.operationCount, 2);
    assert.match(result.summary, /Core product flow implemented/);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor injects repo-intelligence relevant files when none are attached", async () => {
  let capturedPrompt = "";
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );
  const repoRoot = path.dirname(skillPath);
  const config: OpenAIExecutorConfig = {
    provider: "openai",
    configured: true,
    apiKey: "test-key",
    apiKeySource: "OPENAI_KEY",
    modelId: "gpt-4o-mini"
  };
  const executor = createOpenAIExecutor({
    config,
    repoRoot,
    generateTextImpl: (async (input: { prompt?: string }) => {
      capturedPrompt = input.prompt ?? "";

      return {
        text: "Focused on the runtime service.",
        usage: {
          inputTokens: 10,
          outputTokens: 8,
          totalTokens: 18
        },
        totalUsage: {
          inputTokens: 10,
          outputTokens: 8,
          totalTokens: 18
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();

  await executor(
    createRun("Update createPersistentRuntimeService queue handling."),
    {
      instructionRuntime
    }
  );

  assert.match(capturedPrompt, /Relevant files:/);
  assert.match(
    capturedPrompt,
    /packages\/agent-core\/src\/runtime\/createPersistentRuntimeService\.ts/
  );
});

async function createInstructionRuntimeForTests() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );

  return createAgentRuntime({ skillPath });
}

function createRun(
  instruction: string,
  overrides: Partial<AgentRunRecord> = {}
): AgentRunRecord {
  return {
    id: "run-test",
    threadId: "thread-test",
    parentRunId: null,
    title: "Test",
    instruction,
    simulateFailure: false,
    toolRequest: null,
    attachments: [],
    context: {
      objective: null,
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: []
    },
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    retryCount: 0,
    validationStatus: "not_run",
    lastValidationResult: null,
    orchestration: null,
    rollingSummary: null,
    events: [],
    error: null,
    result: null,
    ...overrides
  };
}

function createPhaseExecutionState(expectedOutcome: string): NonNullable<AgentRunRecord["phaseExecution"]> {
  return {
    status: "in_progress",
    activeApprovalGateId: null,
    current: {
      phaseId: "phase-implementation",
      storyId: "story-core-flow",
      taskId: "task-core-flow"
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
        id: "phase-implementation",
        name: "Implementation",
        description: "Build the first product flow.",
        approvalGate: null,
        status: "in_progress",
        completionCriteria: [],
        verificationCriteria: [],
        failureReason: null,
        lastValidationResults: null,
        userStories: [
          {
            id: "story-core-flow",
            title: "Core flow",
            description: "Implement the core product flow.",
            acceptanceCriteria: [expectedOutcome],
            validationGates: [],
            preferredSpecialistAgentTypeId: null,
            status: "in_progress",
            retryCount: 0,
            failureReason: null,
            lastValidationResults: null,
            tasks: [
              {
                id: "task-core-flow",
                instruction: "Implement the core product flow.",
                expectedOutcome,
                status: "running",
                toolRequest: null,
                context: null,
                validationGates: [],
                requiredSpecialistAgentTypeId: null,
                allowedToolNames: null,
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
  };
}
