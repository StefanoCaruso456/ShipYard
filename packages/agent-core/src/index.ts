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
  findControlPlaneHandoff,
  findOpenScopeConflictsForHandoff,
  normalizeControlPlaneState,
  recordMergeGovernanceDecision,
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
  normalizeExternalSyncState,
  normalizeProjectLinks,
  reconcileExternalSyncState
} from "./runtime/externalRecordSync";
export {
  buildFactoryImplementationScopeCriteria,
  buildInitialFactoryStagePlans,
  createFactoryStoryFromBacklogItem,
  normalizeFactoryStagePlans,
  syncFactoryStagePlans
} from "./runtime/factoryBacklog";
export {
  buildFactoryAutonomyApprovalGate,
  buildFactoryAutonomyPolicy,
  findFactoryPauseReason,
  findFactoryRiskEscalationRules,
  summarizeFactoryAutonomyPolicy
} from "./runtime/factoryAutonomy";
export {
  buildFactoryTaskDelegationRuntimeContext,
  findFactoryDelegationBrief,
  findFactoryDependencyGraph,
  findFactoryOwnershipPlan,
  findFactoryPhaseContract,
  syncFactoryDelegationState
} from "./runtime/factoryDelegation";
export { syncFactoryMergeGovernanceState } from "./runtime/factoryMergeGovernance";
export {
  evaluateFactoryPhaseVerification,
  findFactoryPhaseUnlockDecision,
  findFactoryPhaseVerificationResult,
  syncFactoryQualityGateState
} from "./runtime/factoryQualityGates";
export {
  completeFactoryParallelExecutionWindow,
  openFactoryParallelExecutionWindow,
  syncFactoryParallelismState
} from "./runtime/factoryParallelism";
export {
  applyFactoryStageExpansion,
  detectFactoryStageMissingWork
} from "./runtime/factoryPlanner";
export {
  compileFactoryTaskSubmission,
  createFactoryRunState,
  factoryDeploymentProviderIds,
  factoryRepositoryVisibilityOptions,
  factoryStackTemplateIds,
  getFactoryStackSummary,
  isFactoryDeploymentProviderId,
  isFactoryRepositoryVisibility,
  isFactoryStackTemplateId,
  normalizeFactoryRunInput,
  normalizeFactoryRunState,
  syncFactoryRunState
} from "./runtime/factoryMode";
export {
  getOperatingModePolicy,
  isOperatingMode,
  isRequestedOperatingMode,
  normalizeRequestedOperatingMode,
  operatingModes,
  requestedOperatingModes,
  resolveOperatingMode
} from "./runtime/operatingMode";
export { deriveOperatorRunView } from "./runtime/operatorView";
export { deriveRunCloseout } from "./runtime/runCloseout";
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
  buildRepoIntelligenceIndex,
  clearRepoIntelligenceCache,
  resolveRelevantFilesForRun,
  suggestRelevantFilesFromRepo
} from "./runtime/repoIntelligence";
export {
  controlPlaneArtifactSchema,
  controlPlaneConflictSchema,
  controlPlaneHandoffSchema,
  controlPlaneMergeDecisionSchema,
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
  RepoIntelligenceIndexedFile,
  RepoIntelligenceSnapshot,
  RepoIntelligenceSymbol,
  RepoIntelligenceSymbolKind,
  RepoRelevantFileSuggestion
} from "./runtime/repoIntelligence";
export type {
  RollbackResult,
  RunEvent,
  RunEventType,
  ValidationResult,
  ValidationStatus,
  ValidationType
} from "./validation/types";
export type {
  ApprovalDecision,
  ApprovalDecisionRecord,
  ApprovalGateInput,
  ApprovalGateKind,
  ApprovalGateState,
  ApprovalGateStatus,
  AppliedWorkspacePlanSummary,
  AgentRunRecord,
  AgentRunResult,
  AgentRunStatus,
  AgentRunStore,
  AgentRuntimeStatus,
  ControlPlaneAgent,
  ControlPlaneAgentStatus,
  ControlPlaneApprovalGate,
  ControlPlaneArtifact,
  ControlPlaneArtifactKind,
  ControlPlaneArtifactPayload,
  ControlPlaneBlocker,
  ControlPlaneConflict,
  ControlPlaneConflictKind,
  ControlPlaneConflictStatus,
  ControlPlaneDeliverySummaryArtifactPayload,
  ControlPlaneDeliverySummaryLink,
  ControlPlaneDecomposedTask,
  ControlPlaneDelegationBriefArtifactPayload,
  ControlPlaneDataFlowSpecArtifactPayload,
  ControlPlaneEntityKind,
  ControlPlaneEntityStatus,
  ControlPlaneFailureReportArtifactPayload,
  ControlPlaneHandoff,
  ControlPlaneHandoffStatus,
  ControlPlaneIntervention,
  ControlPlaneInterventionKind,
  ControlPlaneMergeDecision,
  ControlPlaneMergeResolution,
  ControlPlaneArchitectureDecisionArtifactPayload,
  ControlPlanePlanArtifactPayload,
  ControlPlanePhaseNode,
  ControlPlaneRequirementsArtifactPayload,
  ControlPlaneRole,
  ControlPlaneRoutingDecisionSource,
  ControlPlaneState,
  ControlPlaneStoryNode,
  ControlPlaneSubtaskBreakdownArtifactPayload,
  ControlPlaneTaskNode,
  ControlPlaneTransition,
  ControlPlaneUserFlowAudience,
  ControlPlaneUserFlowSpecArtifactPayload,
  ControlPlaneValidationState,
  ControlPlaneWorkPacket,
  DeliverySummaryLinkKind,
  ExecutorStepResult,
  ExecuteRun,
  FactoryArtifact,
  FactoryArtifactKind,
  FactoryArtifactStatus,
  FactoryBacklogItem,
  FactoryBacklogItemSource,
  FactoryBacklogItemStatus,
  FactoryAutonomyPolicy,
  FactoryDelegationBrief,
  FactoryDelegationPath,
  FactoryDelegationStatus,
  FactoryDeploymentState,
  FactoryDeploymentProviderId,
  FactoryDependencyGraph,
  FactoryDependencyGraphEdge,
  FactoryDependencyGraphNode,
  FactoryExpansionDecision,
  FactoryExpansionDecisionOutcome,
  FactoryIntegrationBlocker,
  FactoryIntegrationBlockerKind,
  FactoryMergeDecision,
  FactoryOwnershipAssignment,
  FactoryOwnershipPlan,
  FactoryPhaseRecoveryAction,
  FactoryPhaseUnlockDecision,
  FactoryPhaseUnlockOutcome,
  FactoryPhaseVerificationResult,
  FactoryPhaseVerificationStatus,
  FactoryQualityGateResult,
  FactoryQualityGateStatus,
  PauseReason,
  FactoryRepositoryProviderId,
  FactoryRepositoryState,
  FactoryRepositoryVisibility,
  FactoryReassignmentDecision,
  FactoryWorkPacket,
  FactoryWorkPacketStatus,
  ParallelExecutionMode,
  ParallelExecutionWindow,
  ParallelExecutionWindowStatus,
  RiskEscalationRule,
  FactoryRunInput,
  FactoryRunState,
  ScopeLock,
  ScopeLockStatus,
  ScopeLockTargetKind,
  FactoryStagePlan,
  FactoryStagePlanStatus,
  FactoryStackSummary,
  FactoryStackTemplateId,
  FactoryStageId,
  ExternalContextFormat,
  ExternalContextInput,
  ExternalContextKind,
  ExternalRecordEntityKind,
  ExternalRecordLink,
  ExternalRecordLinkKind,
  ExternalRecordMirror,
  ExternalRecordMirrorDetail,
  ExternalRecordProviderId,
  ExternalRecordStatus,
  ExternalRecordSyncService,
  ExternalRecordSyncServiceDescriptor,
  ExternalRecordUpdate,
  ExternalSyncAction,
  ExternalSyncActionKind,
  ExternalSyncActionPayload,
  ExternalSyncActionStatus,
  ExternalSyncAppendUpdatePayload,
  ExternalSyncAttachLinkPayload,
  ExternalSyncState,
  ExternalSyncUpsertRecordPayload,
  ExternalSyncUpdateKind,
  OrchestrationAction,
  OrchestrationState,
  OrchestrationStatus,
  OperatorJournalTone,
  OperatorRunBlocker,
  OperatorRunApprovalGate,
  OperatorRunConflict,
  OperatorRunCurrentWork,
  OperatorRunDeliveryLink,
  OperatorRunDeliverySummary,
  OperatorRunDelegationPacket,
  OperatorRunEvaluation,
  OperatorRunEvaluationBottleneck,
  OperatorRunEvaluationScorecard,
  OperatorRunJournalEntry,
  OperatorRunMergeDecision,
  OperatorRunOwner,
  OperatorRunPlanningArtifact,
  OperatorRunProgress,
  OperatorRunRetrySummary,
  OperatorRunStage,
  OperatorRunStageId,
  OperatorRunStageStatus,
  OperatorRunView,
  OperatingMode,
  RequestedOperatingMode,
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
  RunProjectLinkInput,
  RepoInspectionToolRequest,
  RepoInspectionToolResult,
  RepoMutationToolRequest,
  RepoMutationToolResult,
  RepoToolRequest,
  RepoToolResult,
  ResolveApprovalGateInput,
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
  RunTerminalCommandInput,
  RunTerminalCommandResult,
  SearchRepoInput,
  SearchRepoResult,
  TerminalCommandCategory
} from "./tools/repo/types";
