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
import { resolveWorkspaceRoot } from "./resolveWorkspaceRoot";

export type BootedRuntimeService = {
  runtimeService: PersistentAgentRuntimeService;
  openAI: OpenAIExecutorConfig;
  runtimeStatePath: string;
};

export async function bootRuntimeService(): Promise<BootedRuntimeService> {
  const rootDir = await resolveWorkspaceRoot();
  const instructionRuntime = await bootAgentRuntime(rootDir);
  const openAI = resolveOpenAIExecutorConfig();
  const runtimeStatePath = resolveRuntimeStatePath(rootDir);
  const repoToolset = createRepoToolset({
    rootDir
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
    openAI,
    runtimeStatePath
  };
}

function resolveRuntimeStatePath(rootDir: string, env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = env.SHIPYARD_RUNTIME_STATE_PATH?.trim();

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  if (env.NODE_ENV === "production") {
    return path.resolve("/tmp/shipyard/runtime/runs.json");
  }

  return path.resolve(rootDir, ".shipyard/runtime/runs.json");
}
