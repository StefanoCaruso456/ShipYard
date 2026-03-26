export type AgentRole = "planner" | "executor" | "verifier";

export type SkillMeta = {
  id: string;
  kind: "skill";
  name: string;
  version: number;
  target: "product-agent";
  appliesTo: AgentRole[];
  format: "markdown-sectioned";
};

export type InstructionSection = {
  id: string;
  title: string;
  depth: number;
  path: string[];
  content: string;
};

export type ParsedSkill = {
  meta: SkillMeta;
  sourcePath: string;
  rawText: string;
  sections: InstructionSection[];
  sectionIndex: Record<string, InstructionSection>;
};

export type RoleSkillView = {
  role: AgentRole;
  sectionIds: string[];
  sections: InstructionSection[];
  renderedText: string;
};

export type TeamSkillDocument = {
  id: string;
  title: string;
  sourcePath: string;
  content: string;
};

export type InstructionPrecedenceLayer =
  | "runtime/system contract"
  | "task prompt"
  | "project rules"
  | "skill"
  | "live execution context";

export type AgentInstructionRuntime = {
  loadedAt: string;
  instructionPrecedence: readonly InstructionPrecedenceLayer[];
  skill: ParsedSkill;
  roleViews: Record<AgentRole, RoleSkillView>;
  teamSkills: Record<string, TeamSkillDocument>;
};
