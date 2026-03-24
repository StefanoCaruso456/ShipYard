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
export { buildExecutorContext } from "./context/buildExecutorContext";
export { buildPlannerContext } from "./context/buildPlannerContext";
export { buildVerifierContext } from "./context/buildVerifierContext";
export { createContextAssembler, runtimeContextPrecedence } from "./context/createContextAssembler";
export { selectSkillSections } from "./context/selectSkillSections";
export { createAgentRuntime, instructionPrecedence } from "./runtime/createAgentRuntime";
export { createFileRunStore } from "./runtime/createFileRunStore";
export { createInMemoryRunStore } from "./runtime/createInMemoryRunStore";
export { createPersistentRuntimeService } from "./runtime/createPersistentRuntimeService";
export {
  executeOrchestrationLoop,
  planNextStep,
  verifyStepResult
} from "./runtime/orchestration";
export {
  executePhaseExecutionRun,
  normalizePhaseExecutionInput,
  normalizePhaseExecutionState
} from "./runtime/phaseExecution";
export { createRepoToolset } from "./tools/repo/createRepoToolset";
export type {
  ContextAssembler,
  ContextAssemblerRunInput,
  ContextPayloadSection,
  ContextSectionFormat,
  OmittedContextSection,
  ProjectRulesDocument,
  RoleContextPayload,
  RuntimeContextPrecedenceLayer,
  SharedRoleContext
} from "./context/types";
export type {
  RollbackResult,
  RunEvent,
  RunEventType,
  ValidationResult,
  ValidationStatus,
  ValidationType
} from "./validation/types";
export type {
  AgentRunRecord,
  AgentRunResult,
  AgentRunStatus,
  AgentRunStore,
  AgentRuntimeStatus,
  ExecutorStepResult,
  ExecuteRun,
  OrchestrationAction,
  OrchestrationState,
  OrchestrationStatus,
  OrchestrationStepKind,
  Phase,
  PhaseExecutionInput,
  PhaseExecutionPointer,
  PhaseExecutionProgress,
  PhaseExecutionRetryPolicy,
  PhaseExecutionState,
  PhaseStatus,
  PlannerStep,
  PlannerStepResult,
  PersistentAgentRuntimeService,
  RelevantFileContext,
  RunAttachment,
  RunAttachmentKind,
  RepoMutationToolRequest,
  RepoMutationToolResult,
  RollingSummary,
  RunContextInput,
  RuntimeWorkerState,
  SubmitTaskInput,
  Task,
  TaskInput,
  TaskStatus,
  UserStory,
  UserStoryInput,
  ValidationGate,
  ValidationGateKind,
  ValidationGateResult,
  VerifierDecision,
  VerifierStepResult
} from "./runtime/types";
export type {
  CreateFileInput,
  CreateFileResult,
  DeleteFileInput,
  DeleteFileResult,
  EditFileRegionInput,
  EditFileRegionResult,
  ListFilesInput,
  ListFilesResult,
  ReadFileInput,
  ReadFileRangeInput,
  ReadFileRangeResult,
  ReadFileResult,
  RepoToolError,
  RepoToolErrorCode,
  RepoToolFailure,
  RepoToolMutationResult,
  RepoToolName,
  RepoToolset,
  RepoToolSuccess,
  SearchRepoInput,
  SearchRepoResult
} from "./tools/repo/types";
