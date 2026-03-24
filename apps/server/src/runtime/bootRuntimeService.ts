import {
  createFileRunStore,
  createPersistentRuntimeService,
  createRepoToolset,
  type PersistentAgentRuntimeService
} from "@shipyard/agent-core";

import path from "node:path";

import { bootAgentRuntime } from "./bootAgentRuntime";
import {
  resolveOpenAIExecutorConfig,
  type OpenAIExecutorConfig
} from "./createOpenAIExecutor";
import { createRuntimeExecutor } from "./createRuntimeExecutor";

export type BootedRuntimeService = {
  runtimeService: PersistentAgentRuntimeService;
  openAI: OpenAIExecutorConfig;
};

export async function bootRuntimeService(): Promise<BootedRuntimeService> {
  const instructionRuntime = await bootAgentRuntime();
  const openAI = resolveOpenAIExecutorConfig();
  const runtimeStatePath = resolveRuntimeStatePath();
  const repoToolset = createRepoToolset({
    rootDir: process.cwd()
  });

  return {
    runtimeService: createPersistentRuntimeService({
      instructionRuntime,
      store: createFileRunStore({
        filePath: runtimeStatePath
      }),
      executeRun: createRuntimeExecutor({
        openAI,
        repoToolset
      })
    }),
    openAI
  };
}

function resolveRuntimeStatePath(env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = env.SHIPYARD_RUNTIME_STATE_PATH?.trim();

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  if (env.NODE_ENV === "production") {
    return path.resolve("/tmp/shipyard/runtime/runs.json");
  }

  return path.resolve(process.cwd(), ".shipyard/runtime/runs.json");
}
