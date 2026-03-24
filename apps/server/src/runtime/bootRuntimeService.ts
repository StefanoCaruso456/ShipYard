import {
  createContextAssembler,
  createFileRunStore,
  createPersistentRuntimeService,
  createRepoToolset,
  type ContextAssembler,
  type PersistentAgentRuntimeService
} from "@shipyard/agent-core";

import path from "node:path";

import { bootAgentRuntime } from "./bootAgentRuntime";
import {
  createAudioTranscriber,
  resolveAudioTranscriptionConfig
} from "./createAudioTranscriber";
import {
  resolveOpenAIExecutorConfig,
  type OpenAIExecutorConfig
} from "./createOpenAIExecutor";
import { createRuntimeExecutor } from "./createRuntimeExecutor";
import { loadProjectRules } from "./loadProjectRules";
import { resolveWorkspaceRoot } from "./resolveWorkspaceRoot";

export type BootedRuntimeService = {
  runtimeService: PersistentAgentRuntimeService;
  contextAssembler: ContextAssembler;
  openAI: OpenAIExecutorConfig;
  audioTranscriber: ReturnType<typeof createAudioTranscriber>;
  runtimeStatePath: string;
};

export async function bootRuntimeService(): Promise<BootedRuntimeService> {
  const rootDir = await resolveWorkspaceRoot();
  const instructionRuntime = await bootAgentRuntime(rootDir);
  const projectRules = await loadProjectRules(rootDir);
  const openAI = resolveOpenAIExecutorConfig();
  const audioTranscriber = createAudioTranscriber({
    config: resolveAudioTranscriptionConfig()
  });
  const runtimeStatePath = resolveRuntimeStatePath(rootDir);
  const repoToolset = createRepoToolset({
    rootDir
  });
  const contextAssembler = createContextAssembler({
    instructionRuntime,
    projectRules
  });

  return {
    runtimeService: createPersistentRuntimeService({
      instructionRuntime,
      contextAssembler,
      store: createFileRunStore({
        filePath: runtimeStatePath
      }),
      executeRun: createRuntimeExecutor({
        openAI,
        repoToolset
      })
    }),
    contextAssembler,
    openAI,
    audioTranscriber,
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
