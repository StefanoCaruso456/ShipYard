import assert from "node:assert/strict";
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

  assert.match(capturedPrompt, /Local workspace file action contract/);
  assert.match(capturedPrompt, /<local-file-plan>/);
  assert.equal(result.summary, "Scaffold plan ready.");
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
