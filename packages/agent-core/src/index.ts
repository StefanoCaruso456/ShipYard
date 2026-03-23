export type DecisionStatus = "pending" | "proposed" | "locked";

export type ArchitectureDecision = {
  area: string;
  status: DecisionStatus;
  note: string;
};

export const starterDecisionBoard: ArchitectureDecision[] = [
  {
    area: "Persistent agent runtime",
    status: "pending",
    note: "Will be finalized during PRESEARCH before implementation deepens."
  },
  {
    area: "Surgical file editing strategy",
    status: "pending",
    note: "Unified diff, anchor replace, AST editing, and line-range replacement still need research."
  },
  {
    area: "Context injection format",
    status: "pending",
    note: "The repo is scaffolded for runtime context, but the contract will be locked after research."
  },
  {
    area: "Multi-agent orchestration",
    status: "pending",
    note: "The initial monorepo shape supports parallel agents, but the coordination model is still open."
  }
];

export type {
  AgentInstructionRuntime,
  AgentRole,
  InstructionPrecedenceLayer,
  InstructionSection,
  ParsedSkill,
  RoleSkillView,
  SkillMeta
} from "./instructions/types";
export { loadSkill } from "./instructions/loadSkill";
export { parseFrontmatter } from "./instructions/parseFrontmatter";
export { parseMarkdownSections } from "./instructions/parseMarkdownSections";
export { selectSkillSections } from "./context/selectSkillSections";
export { createAgentRuntime, instructionPrecedence } from "./runtime/createAgentRuntime";
