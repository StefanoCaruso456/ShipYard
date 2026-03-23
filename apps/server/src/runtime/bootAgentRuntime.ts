import { createAgentRuntime, type AgentInstructionRuntime } from "@shipyard/agent-core";

export async function bootAgentRuntime(): Promise<AgentInstructionRuntime> {
  return createAgentRuntime({
    rootDir: process.cwd(),
    skillPath: "skill.md"
  });
}

