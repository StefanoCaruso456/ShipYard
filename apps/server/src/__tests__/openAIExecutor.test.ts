import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentRuntime,
  createFactoryRunState,
  type AgentRunRecord
} from "@shipyard/agent-core";
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
  assert.equal(fallbackConfig.modelId, "gpt-5.4");
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

test("createOpenAIExecutor keeps factory prompts focused on the active local bootstrap task", async () => {
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
        text: "Repository foundation scaffolded.",
        usage: {
          inputTokens: 10,
          outputTokens: 7,
          totalTokens: 17
        },
        totalUsage: {
          inputTokens: 10,
          outputTokens: 7,
          totalTokens: 17
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const factoryState = createFactoryRunState({
    input: {
      appName: "Pong",
      stackTemplateId: "nextjs_supabase_vercel",
      repository: {
        provider: "github",
        owner: "acme",
        name: "pong",
        visibility: "private",
        baseBranch: "main"
      },
      deployment: {
        provider: "vercel",
        projectName: "pong",
        environment: "production"
      }
    },
    productBrief: "Build a simple ping game back and forth.",
    workspacePath: "/tmp/factory-pong"
  });
  factoryState.currentStage = "bootstrap";

  await executor(
    createRun("build a pong video game research how", {
      requestedOperatingMode: "factory",
      operatingMode: "factory",
      factory: factoryState,
      phaseExecution: createPhaseExecutionState({
        phaseId: "factory-bootstrap",
        phaseName: "Factory bootstrap",
        storyId: "story-repository-bootstrap",
        storyTitle: "Repository bootstrap",
        taskId: "task-repository-bootstrap",
        taskInstruction:
          "Inside the connected runtime folder, scaffold the initial repository foundation for Pong. Create the top-level files, configuration, starter structure, and setup docs needed to run the application locally with Next.js + Supabase + Vercel. When complete, explicitly say \"Repository foundation scaffolded.\"",
        expectedOutcome: "Repository foundation scaffolded."
      })
    }),
    {
      instructionRuntime
    }
  );

  assert.match(capturedPrompt, /Current phase task id: task-repository-bootstrap/);
  assert.match(
    capturedPrompt,
    /Task instruction:\nInside the connected runtime folder, scaffold the initial repository foundation for Pong/
  );
  assert.match(capturedPrompt, /Original operator request:\nbuild a pong video game research how/);
  assert.match(capturedPrompt, /Remote repository setup is deferred until an explicit later step\./);
  assert.doesNotMatch(capturedPrompt, /Repository target:/);
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

test("createOpenAIExecutor applies workspace plans for runtime-backed Factory projects even when the project is live", async () => {
  let capturedPrompt = "";
  let capturedMaxOutputTokens: number | undefined;
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
    generateTextImpl: (async (input: { prompt?: string; maxOutputTokens?: number }) => {
      capturedPrompt = input.prompt ?? "";
      capturedMaxOutputTokens = input.maxOutputTokens;

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
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "vendorflow",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-implementation",
          phaseName: "Factory implementation",
          storyId: "story-supabase-flow",
          storyTitle: "Supabase flow",
          taskId: "task-supabase-flow",
          taskInstruction: "Implement the first product flow.",
          expectedOutcome: "Core product flow implemented."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.match(capturedPrompt, /Runtime workspace execution contract/);
    assert.match(capturedPrompt, /Do not append a <local-file-plan> block to the visible response/);
    assert.match(capturedPrompt, /Completion contract:/);
    assert.match(
      capturedPrompt,
      /Only when the current task is actually complete, include this exact final standalone line: Core product flow implemented\./
    );
    assert.equal(
      await readFile(path.join(runtimeRoot, "src/app/page.tsx"), "utf8"),
      'export default function Page() { return "VendorFlow"; }\n'
    );
    assert.equal(capturedMaxOutputTokens, undefined);
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

test("createOpenAIExecutor appends the exact Factory completion outcome after runtime workspace edits", async () => {
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
    generateTextImpl: (async () => ({
      text:
        "Built the Jira landing route and shared shell.\n\n<local-file-plan>\n{\"operations\":[{\"kind\":\"write_file\",\"path\":\"src/app/page.tsx\",\"content\":\"export default function Page() { return \\\"Jira\\\"; }\\n\"}]}\n</local-file-plan>",
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

  try {
    const result = await executor(
      createRun("Build the Jira shell", {
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "jira",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-implementation",
          phaseName: "Factory implementation",
          storyId: "story-nextjs-shell",
          storyTitle: "Next.js shell",
          taskId: "task-nextjs-shell",
          taskInstruction: "Build the primary Next.js application shell.",
          expectedOutcome: "Application shell implemented."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.equal(
      result.responseText,
      "Built the Jira landing route and shared shell.\n\nApplication shell implemented."
    );
    assert.deepEqual(result.appliedWorkspacePlan?.changedFiles, ["src/app/page.tsx"]);
    assert.match(result.summary, /Application shell implemented\./);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor still appends the bootstrap completion outcome when the response includes next steps", async () => {
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
    generateTextImpl: (async () => ({
      text:
        "Scaffolded the Jira repository foundation and setup notes.\n\nNext step: begin the first implementation slice.\n\n<local-file-plan>\n{\"operations\":[{\"kind\":\"write_file\",\"path\":\"README.md\",\"content\":\"# Jira\\n\"},{\"kind\":\"mkdir\",\"path\":\"src/app\"}]}\n</local-file-plan>",
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

  try {
    const result = await executor(
      createRun("Scaffold the Jira repository", {
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "jira",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-bootstrap",
          phaseName: "Factory bootstrap",
          storyId: "story-repository-bootstrap",
          storyTitle: "Repository bootstrap",
          taskId: "task-repository-bootstrap",
          taskInstruction: "Scaffold the initial repository foundation.",
          expectedOutcome: "Repository foundation scaffolded."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.equal(
      result.responseText,
      "Scaffolded the Jira repository foundation and setup notes.\n\nNext step: begin the first implementation slice.\n\nRepository foundation scaffolded."
    );
    assert.deepEqual(result.appliedWorkspacePlan?.changedFiles, ["README.md"]);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor still appends the bootstrap completion outcome when the response mentions remaining work for later stages", async () => {
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
    generateTextImpl: (async () => ({
      text:
        "Scaffolded the Jira repository foundation and starter structure.\n\nRemaining work for later stages: implement issue boards, workflows, and reporting.\n\n<local-file-plan>\n{\"operations\":[{\"kind\":\"write_file\",\"path\":\"README.md\",\"content\":\"# Jira clone\\n\"},{\"kind\":\"write_file\",\"path\":\"shipyard.factory.json\",\"content\":\"{\\\"app\\\":\\\"jira\\\"}\\n\"}]}\n</local-file-plan>",
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

  try {
    const result = await executor(
      createRun("Scaffold the Jira repository", {
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "jira",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-bootstrap",
          phaseName: "Factory bootstrap",
          storyId: "story-repository-bootstrap",
          storyTitle: "Repository bootstrap",
          taskId: "task-repository-bootstrap",
          taskInstruction: "Scaffold the initial repository foundation.",
          expectedOutcome: "Repository foundation scaffolded."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.equal(
      result.responseText,
      "Scaffolded the Jira repository foundation and starter structure.\n\nRemaining work for later stages: implement issue boards, workflows, and reporting.\n\nRepository foundation scaffolded."
    );
    assert.deepEqual(result.appliedWorkspacePlan?.changedFiles, ["README.md", "shipyard.factory.json"]);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor generates a structured runtime workspace plan for prose-only Factory bootstrap responses", async () => {
  let callCount = 0;
  let structuredPlanPrompt = "";
  const recordedMaxOutputTokens: Array<number | undefined> = [];
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
    generateTextImpl: (async (input: {
      prompt?: string;
      output?: unknown;
      maxOutputTokens?: number;
    }) => {
      callCount += 1;
      recordedMaxOutputTokens.push(input.maxOutputTokens);

      if (callCount === 1) {
        return {
          text:
            "Scaffolded the Jira repository foundation and setup notes.\n\nNext step: begin the first implementation slice.",
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
      }

      structuredPlanPrompt = input.prompt ?? "";

      return {
        text: "",
        output: {
          operations: [
            {
              kind: "write_file",
              path: "README.md",
              content: "# Jira\n"
            },
            {
              kind: "mkdir",
              path: "src/app"
            }
          ]
        },
        usage: {
          inputTokens: 6,
          outputTokens: 14,
          totalTokens: 20
        },
        totalUsage: {
          inputTokens: 6,
          outputTokens: 14,
          totalTokens: 20
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();

  try {
    const result = await executor(
      createRun("Scaffold the Jira repository", {
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "jira",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-bootstrap",
          phaseName: "Factory bootstrap",
          storyId: "story-repository-bootstrap",
          storyTitle: "Repository bootstrap",
          taskId: "task-repository-bootstrap",
          taskInstruction: "Scaffold the initial repository foundation.",
          expectedOutcome: "Repository foundation scaffolded."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.equal(callCount, 2);
    assert.deepEqual(recordedMaxOutputTokens, [undefined, undefined]);
    assert.match(structuredPlanPrompt, /Generate only the machine-readable runtime workspace plan/);
    assert.equal(await readFile(path.join(runtimeRoot, "README.md"), "utf8"), "# Jira\n");
    assert.equal(
      result.responseText,
      "Scaffolded the Jira repository foundation and setup notes.\n\nNext step: begin the first implementation slice.\n\nRepository foundation scaffolded."
    );
    assert.deepEqual(result.appliedWorkspacePlan?.changedFiles, ["README.md"]);
    assert.equal(result.appliedWorkspacePlan?.operationCount, 2);
    assert.equal(result.usage?.inputTokens, 18);
    assert.equal(result.usage?.outputTokens, 32);
    assert.equal(result.usage?.totalTokens, 50);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor falls back to a bootstrap scaffold plan when the structured runtime workspace plan is empty", async () => {
  let callCount = 0;
  let structuredPlanPrompt = "";
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
    generateTextImpl: (async (input: { prompt?: string; output?: unknown }) => {
      callCount += 1;

      if (callCount === 1) {
        return {
          text:
            "Scaffolded the Pong repository foundation with local starter files and setup notes.",
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
      }

      structuredPlanPrompt = input.prompt ?? "";

      return {
        text: "",
        output: input.output
          ? {
              operations: []
            }
          : undefined,
        usage: {
          inputTokens: 6,
          outputTokens: 14,
          totalTokens: 20
        },
        totalUsage: {
          inputTokens: 6,
          outputTokens: 14,
          totalTokens: 20
        }
      };
    }) as unknown as typeof generateText
  });
  const instructionRuntime = await createInstructionRuntimeForTests();
  const factoryState = createFactoryRunState({
    input: {
      appName: "Pong",
      stackTemplateId: "nextjs_supabase_vercel",
      repository: {
        provider: "github",
        owner: "acme",
        name: "pong",
        visibility: "private",
        baseBranch: "main"
      },
      deployment: {
        provider: "vercel",
        projectName: "pong",
        environment: "production"
      }
    },
    productBrief: "Build a fast arcade pong experience with a playful landing page.",
    workspacePath: runtimeRoot
  });
  factoryState.currentStage = "bootstrap";

  try {
    const result = await executor(
      createRun("build a pong video game research how", {
        requestedOperatingMode: "factory",
        operatingMode: "factory",
        factory: factoryState,
        project: {
          id: "project-runtime",
          name: "Runtime project",
          kind: "live",
          environment: "Factory workspace",
          description: "Connected runtime workspace",
          folder: {
            name: "pong",
            displayPath: runtimeRoot,
            status: "connected",
            provider: "runtime"
          }
        },
        phaseExecution: createPhaseExecutionState({
          phaseId: "factory-bootstrap",
          phaseName: "Factory bootstrap",
          storyId: "story-repository-bootstrap",
          storyTitle: "Repository bootstrap",
          taskId: "task-repository-bootstrap",
          taskInstruction:
            "Inside the connected runtime folder, scaffold the initial repository foundation for Pong. Create the top-level files, configuration, starter structure, and setup docs needed to run the application locally with Next.js + Supabase + Vercel. When complete, explicitly say \"Repository foundation scaffolded.\"",
          expectedOutcome: "Repository foundation scaffolded."
        })
      }),
      {
        instructionRuntime
      }
    );

    assert.equal(callCount, 2);
    assert.match(structuredPlanPrompt, /Bootstrap scaffold guidance:/);
    assert.match(structuredPlanPrompt, /At minimum include package\.json/);
    assert.match(result.responseText ?? "", /Repository foundation scaffolded\./);
    assert.equal(result.appliedWorkspacePlan?.changedFiles.includes("package.json"), true);
    assert.equal(result.appliedWorkspacePlan?.changedFiles.includes("app/page.tsx"), true);
    assert.match(await readFile(path.join(runtimeRoot, "package.json"), "utf8"), /"next"/);
    assert.match(await readFile(path.join(runtimeRoot, "app/page.tsx"), "utf8"), /Bootstrap scaffold for Pong/);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("createOpenAIExecutor rejects Factory implementation responses when both the visible response and structured plan pass miss the runtime workspace plan", async () => {
  let callCount = 0;
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
    generateTextImpl: (async (input: { output?: unknown }) => {
      callCount += 1;

      return {
        text: callCount === 1 ? "Built the Jira landing route and shared shell.\n\nApplication shell implemented." : "",
        output: input.output
          ? {
              operations: []
            }
          : undefined,
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
    await assert.rejects(
      executor(
        createRun("Build the Jira shell", {
          project: {
            id: "project-runtime",
            name: "Runtime project",
            kind: "live",
            environment: "Factory workspace",
            description: "Connected runtime workspace",
            folder: {
              name: "jira",
              displayPath: runtimeRoot,
              status: "connected",
              provider: "runtime"
            }
          },
          phaseExecution: createPhaseExecutionState({
            phaseId: "factory-implementation",
            phaseName: "Factory implementation",
            storyId: "story-nextjs-shell",
            storyTitle: "Next.js shell",
            taskId: "task-nextjs-shell",
            taskInstruction: "Build the primary Next.js application shell.",
            expectedOutcome: "Application shell implemented."
          })
        }),
        {
          instructionRuntime
        }
      ),
      /The visible response and structured plan pass both failed to produce a valid workspace plan/
    );
    assert.equal(callCount, 2);
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

function createPhaseExecutionState(input: {
  phaseId: string;
  phaseName: string;
  storyId: string;
  storyTitle: string;
  taskId: string;
  taskInstruction: string;
  expectedOutcome: string;
}): NonNullable<AgentRunRecord["phaseExecution"]> {
  return {
    status: "in_progress",
    activeApprovalGateId: null,
    current: {
      phaseId: input.phaseId,
      storyId: input.storyId,
      taskId: input.taskId
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
        id: input.phaseId,
        name: input.phaseName,
        description: "Build the first product flow.",
        approvalGate: null,
        status: "in_progress",
        completionCriteria: [],
        verificationCriteria: [],
        failureReason: null,
        lastValidationResults: null,
        userStories: [
          {
            id: input.storyId,
            title: input.storyTitle,
            description: "Implement the core product flow.",
            acceptanceCriteria: [input.expectedOutcome],
            validationGates: [],
            preferredSpecialistAgentTypeId: null,
            status: "in_progress",
            retryCount: 0,
            failureReason: null,
            lastValidationResults: null,
            tasks: [
              {
                id: input.taskId,
                instruction: input.taskInstruction,
                expectedOutcome: input.expectedOutcome,
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
