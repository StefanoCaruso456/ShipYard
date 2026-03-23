import {
  createPersistentRuntimeService,
  type PersistentAgentRuntimeService
} from "@shipyard/agent-core";

import { bootAgentRuntime } from "./bootAgentRuntime";

export async function bootRuntimeService(): Promise<PersistentAgentRuntimeService> {
  const instructionRuntime = await bootAgentRuntime();

  return createPersistentRuntimeService({
    instructionRuntime
  });
}
