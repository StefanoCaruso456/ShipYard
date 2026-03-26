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
  SkillMeta,
  TeamSkillDocument
} from "./instructions/types";
export { loadSkill } from "./instructions/loadSkill";
export { loadSpecialistSkills } from "./instructions/loadSpecialistSkills";
export { parseFrontmatter } from "./instructions/parseFrontmatter";
export { parseMarkdownSections } from "./instructions/parseMarkdownSections";
export { buildExecutorContext } from "./context/buildExecutorContext";
export { buildPlannerContext } from "./context/buildPlannerContext";
export { buildVerifierContext } from "./context/buildVerifierContext";
export { countTextTokens, getRoleContextPolicy } from "./context/policy";
export { createContextAssembler, runtimeContextPrecedence } from "./context/createContextAssembler";
export { selectSkillSections } from "./context/selectSkillSections";
export { getActiveTraceScope, runWithTraceScope } from "./observability/traceScope";
export { invokeExecutorAgent } from "./runtime/agents/executorAgent";
export { invokePlannerAgent } from "./runtime/agents/plannerAgent";
export { invokeVerifierAgent } from "./runtime/agents/verifierAgent";
export {
  createAgentHandoff,
  createAgentInvocation
} from "./runtime/coordinator/handoffs";
export { createAgentRuntime, instructionPrecedence } from "./runtime/createAgentRuntime";
export { createFileRunStore } from "./runtime/createFileRunStore";
export { createInMemoryRunStore } from "./runtime/createInMemoryRunStore";
export { createPostgresRunStore } from "./runtime/createPostgresRunStore";
export { createPersistentRuntimeService } from "./runtime/createPersistentRuntimeService";
export {
  createSpecialistAgentRegistry,
  DEFAULT_SPECIALIST_AGENT_REGISTRY,
  getSpecialistDefinition,
  listTeamSkillRefs,
  resolveSpecialistAgentType
} from "./runtime/agentRegistry";
export {
  createControlPlaneState,
  normalizeControlPlaneState,
  recordPhaseCompleted,
  recordPhaseFailed,
  recordPhaseStarted,
  recordStoryCompleted,
  recordStoryFailed,
  recordStoryRetry,
  recordStoryStarted,
  recordTaskCompleted,
  recordTaskFailed,
  recordTaskStarted,
  syncControlPlaneState
} from "./runtime/controlPlane";
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
export {
  createRebuildState,
  normalizeRebuildState
} from "./runtime/rebuildState";
export {
  controlPlaneArtifactSchema,
  controlPlaneHandoffSchema,
  normalizeRunContextInputValue,
  runContextInputSchema,
  safeParseRunContextInput
} from "./runtime/schemas";
export { createRepoToolset } from "./tools/repo/createRepoToolset";
export type {
  AgentExecutionStatus,
  AgentInvocation,
  AgentResult,
  ExecutorAgentInput,
  ExecutorAgentOutput,
  OrchestrationAgentRole,
  PlannerAgentInput,
  VerifierAgentInput
} from "./runtime/agents/types";
export type {
  EndTraceSpanInput,
  StartTraceRunInput,
  StartTraceSpanInput,
  TraceMetadata,
  TraceRunLog,
  TraceRunSummary,
  TraceService,
  TraceServiceStatus,
  TraceSpan,
  TraceSpanEvent,
  TraceSpanSnapshot,
  TraceSpanStatus,
  TraceSpanType,
  TraceValue
} from "./observability/types";
export type {
  AgentHandoff
} from "./runtime/coordinator/handoffs";
export type {
  ConflictRecord
} from "./runtime/coordinator/conflicts";
export type {
  ContextAssembler,
  ContextAssemblerRunInput,
  ContextPayloadSection,
  ContextSectionFormat,
  OmittedContextSection,
  ProjectRulesDocument,
  RoleContextBudget,
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
  ControlPlaneAgent,
  ControlPlaneAgentStatus,
  ControlPlaneArtifact,
  ControlPlaneArtifactKind,
  ControlPlaneBlocker,
  ControlPlaneEntityKind,
  ControlPlaneEntityStatus,
  ControlPlaneHandoff,
  ControlPlaneHandoffStatus,
  ControlPlaneIntervention,
  ControlPlaneInterventionKind,
  ControlPlanePhaseNode,
  ControlPlaneRole,
  ControlPlaneState,
  ControlPlaneStoryNode,
  ControlPlaneTaskNode,
  ControlPlaneTransition,
  ControlPlaneValidationState,
  ExecutorStepResult,
  ExecuteRun,
  ExternalContextFormat,
  ExternalContextInput,
  ExternalContextKind,
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
  RebuildArtifactRecord,
  RebuildInput,
  RebuildInterventionRecord,
  RebuildScope,
  RebuildState,
  RebuildStatus,
  RebuildTarget,
  RebuildTargetInput,
  RunAttachment,
  RunAttachmentKind,
  RepoInspectionToolRequest,
  RepoInspectionToolResult,
  RepoMutationToolRequest,
  RepoMutationToolResult,
  RepoToolRequest,
  RepoToolResult,
  RollingSummary,
  RuntimeObservability,
  RunContextInput,
  RuntimeWorkerState,
  SpecialistAgentDefinition,
  SpecialistAgentRegistry,
  SpecialistAgentSkillRef,
  SpecialistAgentToolScope,
  SpecialistAgentTypeId,
  SubmitTaskInput,
  Task,
  TaskInput,
  TaskStatus,
  TeamSkillId,
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
