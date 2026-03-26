import path from "node:path";

import { selectSkillSections } from "../context/selectSkillSections";
import { loadSpecialistSkills } from "../instructions/loadSpecialistSkills";
import { loadSkill } from "../instructions/loadSkill";
import type {
  AgentInstructionRuntime,
  AgentRole,
  InstructionPrecedenceLayer,
  RoleSkillView
} from "../instructions/types";
import { createSpecialistAgentRegistry, listTeamSkillRefs } from "./agentRegistry";

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
  const workspaceRoot =
    options.rootDir ??
    (options.skillPath && path.isAbsolute(options.skillPath)
      ? path.dirname(options.skillPath)
      : process.cwd());
  const skill = await loadSkill(options.skillPath, workspaceRoot);
  const specialistAgentRegistry = createSpecialistAgentRegistry();
  const teamSkills = await loadSpecialistSkills(listTeamSkillRefs(specialistAgentRegistry), workspaceRoot);
  const roles: AgentRole[] = ["planner", "executor", "verifier"];

  const roleViews = Object.fromEntries(
    roles.map((role) => [role, selectSkillSections(skill, role)])
  ) as Record<AgentRole, RoleSkillView>;

  return {
    loadedAt: new Date().toISOString(),
    instructionPrecedence,
    skill,
    roleViews,
    teamSkills
  };
}
