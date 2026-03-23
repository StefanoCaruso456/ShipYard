import { selectSkillSections } from "../context/selectSkillSections";
import { loadSkill } from "../instructions/loadSkill";
import type {
  AgentInstructionRuntime,
  AgentRole,
  InstructionPrecedenceLayer,
  RoleSkillView
} from "../instructions/types";

export const instructionPrecedence: readonly InstructionPrecedenceLayer[] = [
  "runtime/system contract",
  "task prompt",
  "project rules",
  "skill",
  "live execution context"
] as const;

type CreateAgentRuntimeOptions = {
  rootDir?: string;
  skillPath?: string;
};

export async function createAgentRuntime(
  options: CreateAgentRuntimeOptions = {}
): Promise<AgentInstructionRuntime> {
  const skill = await loadSkill(options.skillPath, options.rootDir);
  const roles: AgentRole[] = ["planner", "executor", "verifier"];

  const roleViews = Object.fromEntries(
    roles.map((role) => [role, selectSkillSections(skill, role)])
  ) as Record<AgentRole, RoleSkillView>;

  return {
    loadedAt: new Date().toISOString(),
    instructionPrecedence,
    skill,
    roleViews
  };
}

