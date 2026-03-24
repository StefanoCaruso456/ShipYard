import { createAgentRuntime, type AgentInstructionRuntime } from "@shipyard/agent-core";

import { resolveWorkspaceRoot } from "./resolveWorkspaceRoot";

export async function bootAgentRuntime(rootDir?: string): Promise<AgentInstructionRuntime> {
  const workspaceRoot = rootDir ?? (await resolveWorkspaceRoot());

  return createAgentRuntime({
    rootDir: workspaceRoot,
    skillPath: "skill.md"
  });
}
