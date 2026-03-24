import type { AgentRole, RoleSkillView } from "../instructions/types";
import type {
  AgentRunRecord,
  AgentRuntimeStatus,
  RelevantFileContext,
  RepoMutationToolResult
} from "../runtime/types";

export type RuntimeContextPrecedenceLayer =
  | "runtime/system contract"
  | "task objective and current task input"
  | "project rules"
  | "skill/runtime behavior guidance"
  | "live execution context"
  | "rolling summary / prior step state";

export type ProjectRulesDocument = {
  sourcePath: string;
  loadedAt: string;
  content: string;
};

export type ContextSectionFormat = "text" | "markdown" | "json";

export type ContextPayloadSection = {
  id: string;
  title: string;
  precedence: RuntimeContextPrecedenceLayer;
  source: string;
  format: ContextSectionFormat;
  content: string;
  metadata?: Record<string, string | number | boolean | null | string[]>;
};

export type OmittedContextSection = {
  id: string;
  title: string;
  precedence: RuntimeContextPrecedenceLayer;
  source: string;
  reason: string;
};

export type RoleContextPayload = {
  role: AgentRole;
  runId: string;
  assembledAt: string;
  precedence: readonly RuntimeContextPrecedenceLayer[];
  sections: ContextPayloadSection[];
  omittedSections: OmittedContextSection[];
  prompt: string;
};

export type ContextAssemblerRunInput = {
  run: AgentRunRecord;
  runtimeStatus: AgentRuntimeStatus;
};

export type ContextAssembler = {
  projectRules: ProjectRulesDocument;
  precedence: readonly RuntimeContextPrecedenceLayer[];
  buildRolePayload(role: AgentRole, input: ContextAssemblerRunInput): RoleContextPayload;
};

export type SharedRoleContext = {
  runtimeContract: string;
  projectRules: ProjectRulesDocument;
  roleSkillView: RoleSkillView;
  run: AgentRunRecord;
  runtimeStatus: AgentRuntimeStatus;
  taskObjective: string;
  constraints: string[];
  relevantFiles: RelevantFileContext[];
  recentToolResults: RepoMutationToolResult[];
  validationTargets: string[];
  knownFailures: string[];
  rollingSummary: string | null;
};
