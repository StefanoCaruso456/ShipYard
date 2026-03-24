import {
  createPersistentRuntimeService,
  type PersistentAgentRuntimeService
} from "@shipyard/agent-core";

import { bootAgentRuntime } from "./bootAgentRuntime";
import {
  createOpenAIExecutor,
  resolveOpenAIExecutorConfig,
  type OpenAIExecutorConfig
} from "./createOpenAIExecutor";

export type BootedRuntimeService = {
  runtimeService: PersistentAgentRuntimeService;
  openAI: OpenAIExecutorConfig;
};

export async function bootRuntimeService(): Promise<BootedRuntimeService> {
  const instructionRuntime = await bootAgentRuntime();
  const openAI = resolveOpenAIExecutorConfig();

  return {
    runtimeService: createPersistentRuntimeService({
      instructionRuntime,
      executeRun: createOpenAIExecutor({
        config: openAI
      })
    }),
    openAI
  };
}
