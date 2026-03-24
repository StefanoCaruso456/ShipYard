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

async function createInstructionRuntimeForTests() {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );

  return createAgentRuntime({ skillPath });
}

function createRun(instruction: string): AgentRunRecord {
  return {
    id: "run-test",
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
    result: null
  };
}
