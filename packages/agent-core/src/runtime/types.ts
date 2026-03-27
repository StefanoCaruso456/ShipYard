import type { AgentInstructionRuntime } from "../instructions/types";
import type {
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
  RunTerminalCommandInput,
  RunTerminalCommandResult,
  RepoToolErrorCode,
  RepoToolName,
  SearchRepoInput,
  SearchRepoResult
} from "../tools/repo/types";
import type {
  RollbackResult,
  RunEvent,
  ValidationResult,
  ValidationStatus
} from "../validation/types";
import type { TraceService, TraceValue } from "../observability/types";

export type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed";

export type RuntimeWorkerState = "idle" | "running";

export type RequestedOperatingMode =
  | "auto"
  | "build"
  | "review"
  | "debug"
  | "refactor"
  | "factory";

export type OperatingMode = Exclude<RequestedOperatingMode, "auto">;

export type RunAttachmentKind =
  | "image"
  | "text"
  | "code"
  | "csv"
  | "json"
  | "pdf"
  | "document"
  | "audio"
  | "video"
  | "archive"
  | "binary"
  | "unknown";

export type RunAttachment = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  kind: RunAttachmentKind;
  analysis: {
    status: "analyzed" | "metadata_only";
    summary: string;
    excerpt: string | null;
    warnings: string[];
  };
};

export type RepoMutationToolRequest =
  | {
      toolName: "edit_file_region";
      input: EditFileRegionInput;
    }
  | {
      toolName: "create_file";
      input: CreateFileInput;
    }
  | {
      toolName: "delete_file";
      input: DeleteFileInput;
    };

export type RepoExecutionToolRequest = {
  toolName: "run_terminal_command";
  input: RunTerminalCommandInput;
};

export type RepoInspectionToolRequest =
  | {
      toolName: "list_files";
      input: ListFilesInput;
    }
  | {
      toolName: "read_file";
      input: ReadFileInput;
    }
  | {
      toolName: "read_file_range";
      input: ReadFileRangeInput;
    }
  | {
      toolName: "search_repo";
      input: SearchRepoInput;
    };

export type RepoToolRequest =
  | RepoInspectionToolRequest
  | RepoMutationToolRequest
  | RepoExecutionToolRequest;

export type RepoMutationToolResult =
  | EditFileRegionResult
  | CreateFileResult
  | DeleteFileResult;

export type RepoInspectionToolResult =
  | ListFilesResult
  | ReadFileResult
  | ReadFileRangeResult
  | SearchRepoResult;

export type RepoToolResult =
  | RepoInspectionToolResult
  | RepoMutationToolResult
  | RunTerminalCommandResult;

export type PhaseStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export type ValidationGateKind =
  | "task_completed"
  | "all_tasks_completed"
  | "all_user_stories_completed"
  | "tool_result_ok"
  | "validation_passed"
  | "result_summary_includes"
  | "response_text_includes"
  | "evidence_includes"
  | "event_type_present";

export type ValidationGate = {
  id: string;
  description: string;
  kind: ValidationGateKind;
  expectedValue?: string | null;
};

export type ValidationGateResult = {
  gateId: string;
  description: string;
  kind: ValidationGateKind;
  success: boolean;
  message: string;
  expectedValue?: string | null;
};

export type OrchestrationStepKind = "repo_tool" | "model_response";

export type OrchestrationAction = "plan" | "continue" | "retry_step" | "replan" | "fail";

export type OrchestrationStatus =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

export type PlannerStep = {
  id: string;
  title: string;
  kind: OrchestrationStepKind;
  rationale: string;
  summary: string;
  successCriteria: string[];
  requiredInputs: string[];
  requiredTool?: RepoToolName | null;
  toolRequest?: RepoToolRequest | null;
  validationTargets: string[];
};

export type PlannerStepResult = {
  role: "planner";
  at: string;
  summary: string;
  step: PlannerStep;
  consumedContextSectionIds: string[];
};

export type ExecutorStepResult = {
  role: "executor";
  at: string;
  stepId: string;
  success: boolean;
  mode: AgentRunResult["mode"] | null;
  summary: string;
  responseText?: string | null;
  toolResult?: RepoToolResult | null;
  changedFiles: string[];
  validationTargets: string[];
  consumedContextSectionIds: string[];
  error?: AgentRunFailure | null;
};

export type VerifierDecision = Extract<
  OrchestrationAction,
  "continue" | "retry_step" | "replan" | "fail"
>;

export type VerifierStepResult = {
  role: "verifier";
  at: string;
  stepId: string;
  decision: VerifierDecision;
  summary: string;
  reasons: string[];
  intentMatched: boolean;
  targetMatched: boolean;
  validationPassed: boolean | null;
  sideEffectsDetected: boolean;
  validationGateResults?: ValidationGateResult[] | null;
  consumedContextSectionIds: string[];
};

export type OrchestrationState = {
  status: OrchestrationStatus;
  iteration: number;
  stepRetryCount: number;
  replanCount: number;
  maxStepRetries: number;
  maxReplans: number;
  nextAction: OrchestrationAction | null;
  currentStep: PlannerStep | null;
  lastPlannerResult: PlannerStepResult | null;
  lastExecutorResult: ExecutorStepResult | null;
  lastVerifierResult: VerifierStepResult | null;
};

export type RelevantFileContext = {
  path: string;
  excerpt?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  source?: string | null;
  reason?: string | null;
};

export type ExternalContextKind =
  | "spec"
  | "schema"
  | "prior_output"
  | "test_result"
  | "diff_summary"
  | "validation_target";

export type ExternalContextFormat = "text" | "markdown" | "json";

export type ExternalContextInput = {
  id: string;
  kind: ExternalContextKind;
  title: string;
  content: string;
  source?: string | null;
  format?: ExternalContextFormat | null;
};

export type RunContextInput = {
  objective?: string | null;
  constraints: string[];
  relevantFiles: RelevantFileContext[];
  externalContext?: ExternalContextInput[];
  validationTargets: string[];
  specialistAgentTypeId?: SpecialistAgentTypeId | null;
};

export type SpecialistAgentTypeId =
  | "frontend_dev"
  | "backend_dev"
  | "repo_tools_dev"
  | "observability_dev"
  | "rebuild_dev";

export type TeamSkillId =
  | "production_lead"
  | "execution_subagent"
  | SpecialistAgentTypeId;

export type SpecialistAgentSkillRef = {
  id: TeamSkillId;
  title: string;
  relativePath: string;
};

export type SpecialistAgentToolScope = {
  allowedToolNames: RepoToolName[];
};

export type SpecialistAgentDefinition = {
  agentTypeId: SpecialistAgentTypeId;
  label: string;
  description: string;
  domainTags: string[];
  skillRefs: SpecialistAgentSkillRef[];
  toolScope: SpecialistAgentToolScope;
  allowedHandoffTargets: ControlPlaneRole[];
  canSpawnExecutionSubagents: boolean;
  defaultValidationFocus: string[];
};

export type SpecialistAgentRegistry = {
  version: 1;
  definitions: SpecialistAgentDefinition[];
};

export type TaskInput = {
  id: string;
  instruction: string;
  expectedOutcome: string;
  toolRequest?: RepoToolRequest | null;
  context?: RunContextInput | null;
  validationGates?: ValidationGate[];
  requiredSpecialistAgentTypeId?: SpecialistAgentTypeId | null;
  allowedToolNames?: RepoToolName[] | null;
};

export type UserStoryInput = {
  id: string;
  title: string;
  description: string;
  tasks: TaskInput[];
  acceptanceCriteria: string[];
  validationGates?: ValidationGate[];
  preferredSpecialistAgentTypeId?: SpecialistAgentTypeId | null;
};

export type PhaseInput = {
  id: string;
  name: string;
  description: string;
  approvalGate?: ApprovalGateInput | null;
  completionCriteria?: string[];
  verificationCriteria?: string[];
  userStories: UserStoryInput[];
};

export type PhaseExecutionRetryPolicy = {
  maxTaskRetries: number;
  maxStoryRetries: number;
  maxReplans: number;
};

export type PhaseExecutionInput = {
  phases: PhaseInput[];
  retryPolicy?: Partial<PhaseExecutionRetryPolicy> | null;
};

export type ApprovalGateKind = "architecture" | "implementation" | "deployment";

export type ApprovalDecision = "approve" | "reject" | "request_retry";

export type ApprovalGateStatus = "pending" | "waiting" | "approved" | "rejected";

export type ApprovalDecisionRecord = {
  id: string;
  decision: ApprovalDecision;
  comment: string | null;
  decidedAt: string;
};

export type ApprovalGateInput = {
  id?: string;
  kind: ApprovalGateKind;
  title?: string | null;
  instructions?: string | null;
};

export type ApprovalGateState = {
  id: string;
  kind: ApprovalGateKind;
  title: string;
  instructions: string | null;
  status: ApprovalGateStatus;
  waitingAt: string | null;
  resolvedAt: string | null;
  decisions: ApprovalDecisionRecord[];
};

export type Task = {
  id: string;
  instruction: string;
  expectedOutcome: string;
  status: TaskStatus;
  toolRequest: RepoToolRequest | null;
  context: RunContextInput | null;
  validationGates: ValidationGate[];
  requiredSpecialistAgentTypeId: SpecialistAgentTypeId | null;
  allowedToolNames: RepoToolName[] | null;
  retryCount: number;
  failureReason: string | null;
  lastValidationResults: ValidationGateResult[] | null;
  result: AgentRunResult | null;
};

export type UserStory = {
  id: string;
  title: string;
  description: string;
  tasks: Task[];
  acceptanceCriteria: string[];
  validationGates: ValidationGate[];
  preferredSpecialistAgentTypeId: SpecialistAgentTypeId | null;
  status: PhaseStatus;
  retryCount: number;
  failureReason: string | null;
  lastValidationResults: ValidationGateResult[] | null;
};

export type Phase = {
  id: string;
  name: string;
  description: string;
  approvalGate: ApprovalGateState | null;
  status: PhaseStatus;
  completionCriteria?: string[];
  verificationCriteria?: string[];
  userStories: UserStory[];
  failureReason: string | null;
  lastValidationResults: ValidationGateResult[] | null;
};

export type PhaseExecutionProgress = {
  totalPhases: number;
  completedPhases: number;
  totalStories: number;
  completedStories: number;
  totalTasks: number;
  completedTasks: number;
};

export type PhaseExecutionPointer = {
  phaseId: string | null;
  storyId: string | null;
  taskId: string | null;
};

export type PhaseExecutionState = {
  status: PhaseStatus;
  phases: Phase[];
  activeApprovalGateId: string | null;
  current: PhaseExecutionPointer;
  progress: PhaseExecutionProgress;
  retryPolicy: PhaseExecutionRetryPolicy;
  lastFailureReason: string | null;
};

export type ControlPlaneRole =
  | "orchestrator"
  | "production_lead"
  | "specialist_dev"
  | "execution_subagent";

export type ControlPlaneAgentStatus = "available" | "assigned" | "active" | "blocked";

export type ControlPlaneEntityKind = "phase" | "story" | "task";

export type ControlPlaneEntityStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";

export type ControlPlaneArtifactKind =
  | "plan"
  | "requirements"
  | "architecture_decision"
  | "user_flow_spec"
  | "data_flow_spec"
  | "subtask_breakdown"
  | "delegation_brief"
  | "task_result"
  | "validation_report"
  | "delivery_summary"
  | "failure_report";

export type ControlPlaneHandoffStatus = "created" | "accepted" | "completed";

export type ControlPlaneConflictKind =
  | "scope_overlap"
  | "boundary_violation"
  | "validation_failure"
  | "intent_mismatch"
  | "retry_cap_exceeded"
  | "replan_cap_exceeded";

export type ControlPlaneConflictStatus = "open" | "resolved";

export type ControlPlaneMergeResolution = "accept" | "retry" | "reassign" | "reject";

export type ControlPlaneApprovalGate = {
  id: string;
  kind: ApprovalGateKind;
  phaseId: string;
  phaseName: string;
  title: string;
  instructions: string | null;
  status: ApprovalGateStatus;
  waitingAt: string | null;
  resolvedAt: string | null;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
  decisions: ApprovalDecisionRecord[];
};

export type ControlPlaneInterventionKind = "retry" | "replan" | "manual_review" | "rollback";

export type ControlPlaneTransition = {
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  fromStatus: ControlPlaneEntityStatus | null;
  toStatus: ControlPlaneEntityStatus;
  at: string;
  reason: string;
};

export type ControlPlaneValidationState = {
  status: ValidationStatus;
  lastResults: ValidationGateResult[] | null;
  updatedAt: string | null;
};

export type ControlPlaneAgent = {
  id: string;
  role: ControlPlaneRole;
  label: string;
  status: ControlPlaneAgentStatus;
  assignedEntityIds: string[];
  agentTypeId: TeamSkillId | null;
  skillIds: TeamSkillId[];
  allowedToolNames: RepoToolName[];
  allowedHandoffTargets: ControlPlaneRole[];
  specialtyTags: string[];
  parentAgentId: string | null;
};

export type ControlPlaneRoutingDecisionSource =
  | "story_preference"
  | "task_requirement"
  | "registry_default";

export type ControlPlanePlanArtifactPayload = {
  kind: "plan";
  version: 1;
  phaseIds: string[];
  storyIds: string[];
  taskIds: string[];
  validationTargets: string[];
};

export type ControlPlaneRequirementsArtifactPayload = {
  kind: "requirements";
  version: 1;
  scopeSummary: string;
  constraints: string[];
  fileTargets: string[];
  domainTargets: string[];
  validationTargets: string[];
  storyIds: string[];
  taskIds: string[];
  approvalGateKind: ApprovalGateKind | null;
};

export type ControlPlaneArchitectureDecisionArtifactPayload = {
  kind: "architecture_decision";
  version: 1;
  storyId: string;
  selectedSpecialistAgentTypeId: SpecialistAgentTypeId;
  decisionSource: ControlPlaneRoutingDecisionSource;
  rationale: string;
  domainTargets: string[];
  fileTargets: string[];
  allowedToolNames: RepoToolName[];
  validationTargets: string[];
  taskIds: string[];
};

export type ControlPlaneDecomposedTask = {
  taskId: string;
  instruction: string;
  expectedOutcome: string;
  dependencyIds: string[];
  specialistAgentTypeId: SpecialistAgentTypeId;
  allowedToolNames: RepoToolName[];
  validationTargets: string[];
  relevantFiles: string[];
  constraints: string[];
};

export type ControlPlaneSubtaskBreakdownArtifactPayload = {
  kind: "subtask_breakdown";
  version: 1;
  storyId: string;
  dependencyStrategy: "sequential";
  tasks: ControlPlaneDecomposedTask[];
};

export type ControlPlaneDelegationBriefArtifactPayload = {
  kind: "delegation_brief";
  version: 1;
  scopeSummary: string;
  acceptanceCriteria: string[];
  acceptanceTargetIds: string[];
  verificationTargetIds: string[];
  validationTargets: string[];
  dependencyIds: string[];
  backlogItemIds: string[];
  delegationPath: "orchestrator_to_production_lead" | "production_lead_to_specialist" | "specialist_to_execution";
  specialistAgentTypeId: SpecialistAgentTypeId | null;
};

export type ControlPlaneUserFlowAudience = "end_user" | "operator" | "developer";

export type ControlPlaneUserFlowSpecArtifactPayload = {
  kind: "user_flow_spec";
  version: 1;
  storyId: string;
  primaryAudience: ControlPlaneUserFlowAudience;
  entryPoints: string[];
  journeySteps: string[];
  successOutcome: string;
  notes: string[];
};

export type ControlPlaneDataFlowSpecArtifactPayload = {
  kind: "data_flow_spec";
  version: 1;
  storyId: string;
  inputSignals: string[];
  processingSteps: string[];
  outputs: string[];
  stores: string[];
  integrations: string[];
  fileTargets: string[];
  domainTargets: string[];
};

export type DeliverySummaryLinkKind =
  | "repository"
  | "pull_request"
  | "deployment"
  | "project"
  | "workspace"
  | "factory_artifact";

export type ControlPlaneDeliverySummaryLink = {
  kind: DeliverySummaryLinkKind;
  label: string;
  url: string;
  provider: string | null;
};

export type ControlPlaneDeliverySummaryArtifactPayload = {
  kind: "delivery_summary";
  version: 1;
  headline: string;
  outputs: string[];
  links: ControlPlaneDeliverySummaryLink[];
  risks: string[];
  followUps: string[];
};

export type ControlPlaneFailureReportArtifactPayload = {
  kind: "failure_report";
  version: 1;
  headline: string;
  risks: string[];
  followUps: string[];
  validationFailures: string[];
};

export type ControlPlaneArtifactPayload =
  | ControlPlanePlanArtifactPayload
  | ControlPlaneRequirementsArtifactPayload
  | ControlPlaneArchitectureDecisionArtifactPayload
  | ControlPlaneUserFlowSpecArtifactPayload
  | ControlPlaneDataFlowSpecArtifactPayload
  | ControlPlaneSubtaskBreakdownArtifactPayload
  | ControlPlaneDelegationBriefArtifactPayload
  | ControlPlaneDeliverySummaryArtifactPayload
  | ControlPlaneFailureReportArtifactPayload;

export type ControlPlaneArtifact = {
  id: string;
  kind: ControlPlaneArtifactKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  createdAt: string;
  producerRole: ControlPlaneRole;
  producerId: string;
  producerAgentTypeId: TeamSkillId | null;
  path?: string | null;
  payload: ControlPlaneArtifactPayload | null;
};

export type ControlPlaneWorkPacket = {
  version: 1;
  sourceArtifactIds: string[];
  flowArtifactIds: string[];
  scopeSummary: string;
  constraints: string[];
  fileTargets: string[];
  domainTargets: string[];
  acceptanceCriteria: string[];
  acceptanceTargetIds: string[];
  verificationTargetIds: string[];
  validationTargets: string[];
  dependencyIds: string[];
  taskIds: string[];
  ownerAgentTypeId: TeamSkillId | null;
};

export type ControlPlaneHandoff = {
  id: string;
  fromRole: ControlPlaneRole;
  fromId: string;
  fromAgentTypeId: TeamSkillId | null;
  toRole: ControlPlaneRole;
  toId: string;
  toAgentTypeId: TeamSkillId | null;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  correlationId: string;
  artifactIds: string[];
  dependencyIds: string[];
  acceptanceCriteria: string[];
  acceptanceTargetIds: string[];
  verificationTargetIds: string[];
  validationTargets: string[];
  purpose: string;
  workPacket: ControlPlaneWorkPacket | null;
  status: ControlPlaneHandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
};

export type ControlPlaneConflict = {
  id: string;
  kind: ControlPlaneConflictKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  stepId: string | null;
  summary: string;
  status: ControlPlaneConflictStatus;
  detectedAt: string;
  resolvedAt: string | null;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
  sourceHandoffId: string | null;
  relatedHandoffIds: string[];
  conflictingPaths: string[];
  expectedPaths: string[];
  conflictingAgentTypeIds: TeamSkillId[];
  resolutionDecisionId: string | null;
  metadata: TraceValue | null;
};

export type ControlPlaneMergeDecision = {
  id: string;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  conflictIds: string[];
  outcome: ControlPlaneMergeResolution;
  summary: string;
  decidedAt: string;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
  targetHandoffId: string | null;
  reassignedToAgentTypeId: TeamSkillId | null;
  notes: string | null;
};

export type ControlPlaneIntervention = {
  id: string;
  kind: ControlPlaneInterventionKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  createdAt: string;
  resolvedAt: string | null;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
};

export type ControlPlaneBlocker = {
  id: string;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
};

type ControlPlaneNodeBase = {
  status: ControlPlaneEntityStatus;
  ownerRole: ControlPlaneRole;
  ownerId: string;
  ownerAgentTypeId: TeamSkillId | null;
  failureReason: string | null;
  validation: ControlPlaneValidationState;
  blockerIds: string[];
  artifactIds: string[];
  handoffIds: string[];
  conflictIds: string[];
  mergeDecisionIds: string[];
  interventionIds: string[];
  transitionLog: ControlPlaneTransition[];
};

export type ControlPlaneTaskNode = ControlPlaneNodeBase & {
  id: string;
  title: string;
  instruction: string;
  expectedOutcome: string;
  retryCount: number;
};

export type ControlPlaneStoryNode = ControlPlaneNodeBase & {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  retryCount: number;
  tasks: ControlPlaneTaskNode[];
};

export type ControlPlanePhaseNode = ControlPlaneNodeBase & {
  id: string;
  name: string;
  description: string;
  userStories: ControlPlaneStoryNode[];
};

export type ControlPlaneState = {
  version: 1;
  status: ControlPlaneEntityStatus;
  runOwnerId: string;
  agents: ControlPlaneAgent[];
  specialistAgentRegistry: SpecialistAgentRegistry;
  activeApprovalGateId: string | null;
  current: PhaseExecutionPointer;
  progress: PhaseExecutionProgress;
  retryPolicy: PhaseExecutionRetryPolicy;
  phases: ControlPlanePhaseNode[];
  approvalGates: ControlPlaneApprovalGate[];
  artifacts: ControlPlaneArtifact[];
  handoffs: ControlPlaneHandoff[];
  conflicts: ControlPlaneConflict[];
  mergeDecisions: ControlPlaneMergeDecision[];
  interventions: ControlPlaneIntervention[];
  blockers: ControlPlaneBlocker[];
  lastFailureReason: string | null;
  updatedAt: string;
};

export type OperatorRunStageId =
  | "queued"
  | "coordination"
  | "execution"
  | "validation"
  | "rebuild"
  | "delivery";

export type OperatorRunStageStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped";

export type OperatorJournalTone = "default" | "info" | "success" | "warning" | "danger";

export type OperatorRunStage = {
  id: OperatorRunStageId;
  label: string;
  status: OperatorRunStageStatus;
  detail: string;
};

export type OperatorRunOwner = {
  id: string | null;
  role:
    | ControlPlaneRole
    | "planner"
    | "executor"
    | "verifier"
    | "runtime_worker"
    | "system"
    | null;
  label: string;
  agentTypeId: TeamSkillId | null;
};

export type OperatorRunCurrentWork = {
  entityKind: ControlPlaneEntityKind | "run" | "orchestration_step" | "rebuild" | null;
  entityId: string | null;
  label: string | null;
  status: string | null;
};

export type OperatorRunProgress = {
  totalPhases: number;
  completedPhases: number;
  totalStories: number;
  completedStories: number;
  totalTasks: number;
  completedTasks: number;
};

export type OperatorRunRetrySummary = {
  runRetries: number;
  storyRetries: number;
  taskRetries: number;
  totalRetries: number;
  maxStoryRetries: number | null;
  maxTaskRetries: number | null;
  note: string | null;
};

export type OperatorRunBlocker = {
  id: string;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  ownerLabel: string;
  createdAt: string;
};

export type OperatorRunPlanningArtifact = {
  id: string;
  kind: ControlPlaneArtifactKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  createdAt: string;
  producerLabel: string;
  path: string | null;
  highlights: string[];
};

export type OperatorRunDelegationPacket = {
  id: string;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  routeLabel: string;
  purpose: string;
  status: ControlPlaneHandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  ownerLabel: string;
  artifactIds: string[];
  dependencyIds: string[];
  acceptanceCriteria: string[];
  validationTargets: string[];
  workPacket:
    | (ControlPlaneWorkPacket & {
        ownerLabel: string | null;
      })
    | null;
};

export type OperatorRunConflict = {
  id: string;
  kind: ControlPlaneConflictKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  status: ControlPlaneConflictStatus;
  detectedAt: string;
  resolvedAt: string | null;
  ownerLabel: string;
  routeLabel: string | null;
  conflictingPaths: string[];
  expectedPaths: string[];
  conflictingAgentLabels: string[];
  resolutionDecisionId: string | null;
};

export type OperatorRunMergeDecision = {
  id: string;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  outcome: ControlPlaneMergeResolution;
  summary: string;
  decidedAt: string;
  ownerLabel: string;
  targetHandoffLabel: string | null;
  reassignedToLabel: string | null;
  conflictIds: string[];
  notes: string | null;
};

export type OperatorRunDeliveryLink = {
  kind: DeliverySummaryLinkKind;
  label: string;
  url: string;
  provider: string | null;
};

export type OperatorRunDeliverySummary = {
  status: "completed" | "failed" | "in_progress";
  headline: string;
  outputs: string[];
  links: OperatorRunDeliveryLink[];
  risks: string[];
  followUps: string[];
  sourceArtifactIds: string[];
  updatedAt: string | null;
};

export type OperatorRunEvaluationScorecard = {
  blockerCount: number;
  openBlockerCount: number;
  retryCount: number;
  approvalGateCount: number;
  approvalDecisionCount: number;
  interventionCount: number;
  conflictCount: number;
  openConflictCount: number;
  mergeDecisionCount: number;
  failureReportCount: number;
};

export type OperatorRunEvaluationBottleneck = {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warning" | "danger";
  metric: number;
};

export type OperatorRunEvaluation = {
  scorecard: OperatorRunEvaluationScorecard;
  bottlenecks: OperatorRunEvaluationBottleneck[];
  failurePatterns: string[];
};

export type OperatorRunComparativeAnalysisSectionId =
  | "executive_summary"
  | "delivery_and_outputs"
  | "validation_and_quality"
  | "interventions_and_retries"
  | "blockers_and_conflicts"
  | "risks_and_follow_ups"
  | "recommended_improvements";

export type OperatorRunComparativeAnalysisSection = {
  id: OperatorRunComparativeAnalysisSectionId;
  title: string;
  summary: string;
  highlights: string[];
};

export type OperatorRunComparativeAnalysis = {
  status: "completed" | "failed";
  headline: string;
  sections: OperatorRunComparativeAnalysisSection[];
  sourceArtifactIds: string[];
  updatedAt: string | null;
};

export type OperatorRunJournalEntry = {
  id: string;
  kind: "run" | "event" | "handoff" | "blocker" | "intervention" | "artifact";
  at: string;
  label: string;
  detail: string;
  tone: OperatorJournalTone;
  meta: string[];
};

export type OperatorRunApprovalGate = {
  id: string;
  kind: ApprovalGateKind;
  phaseId: string;
  phaseName: string;
  title: string;
  instructions: string | null;
  status: ApprovalGateStatus;
  waitingAt: string | null;
  resolvedAt: string | null;
  ownerLabel: string;
  decisions: ApprovalDecisionRecord[];
};

export type OperatorRunView = {
  summary: string;
  stage: OperatorRunStage;
  stages: OperatorRunStage[];
  owner: OperatorRunOwner;
  current: OperatorRunCurrentWork;
  nextAction: string | null;
  progress: OperatorRunProgress | null;
  retries: OperatorRunRetrySummary;
  approval: {
    activeGateId: string | null;
    activeGate: OperatorRunApprovalGate | null;
    gates: OperatorRunApprovalGate[];
  } | null;
  blockers: OperatorRunBlocker[];
  conflicts: OperatorRunConflict[];
  mergeDecisions: OperatorRunMergeDecision[];
  delivery: OperatorRunDeliverySummary | null;
  evaluation: OperatorRunEvaluation | null;
  comparativeAnalysis: OperatorRunComparativeAnalysis | null;
  planningArtifacts: OperatorRunPlanningArtifact[];
  delegationPackets: OperatorRunDelegationPacket[];
  journal: OperatorRunJournalEntry[];
};

export type RebuildScope = "ship" | "project" | "workspace";

export type RebuildTargetInput = {
  scope?: RebuildScope | null;
  shipId: string;
  label?: string | null;
  objective?: string | null;
  projectId?: string | null;
  rootPath?: string | null;
  baseBranch?: string | null;
  entryPaths?: string[] | null;
  acceptanceSummary?: string | null;
};

export type RebuildTarget = {
  scope: RebuildScope;
  shipId: string;
  label: string | null;
  objective: string | null;
  projectId: string | null;
  rootPath: string | null;
  baseBranch: string | null;
  entryPaths: string[];
  acceptanceSummary: string | null;
};

export type RebuildStatus = "queued" | "rebuilding" | "completed" | "failed";

export type RebuildArtifactRecord = {
  id: string;
  sourceArtifactId: string;
  kind: ControlPlaneArtifactKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  createdAt: string;
  producerRole: ControlPlaneRole;
  producerId: string;
  path: string | null;
};

export type RebuildInterventionRecord = {
  id: string;
  sourceInterventionId: string;
  kind: ControlPlaneInterventionKind;
  entityKind: ControlPlaneEntityKind;
  entityId: string;
  summary: string;
  createdAt: string;
  resolvedAt: string | null;
  ownerRole: ControlPlaneRole;
  ownerId: string;
};

export type RebuildInput = {
  target: RebuildTargetInput;
};

export type RebuildState = {
  version: 1;
  status: RebuildStatus;
  target: RebuildTarget;
  current: PhaseExecutionPointer;
  progress: PhaseExecutionProgress | null;
  retryPolicy: PhaseExecutionRetryPolicy | null;
  artifactLog: RebuildArtifactRecord[];
  interventionLog: RebuildInterventionRecord[];
  validationStatus: ValidationStatus | null;
  lastArtifactAt: string | null;
  lastInterventionAt: string | null;
  lastFailureReason: string | null;
  updatedAt: string;
};

export type FactoryStackTemplateId =
  | "nextjs_supabase_vercel"
  | "nextjs_railway_postgres"
  | "react_express_railway";

export type FactoryRepositoryProviderId = "github";

export type FactoryRepositoryVisibility = "private" | "public";

export type FactoryDeploymentProviderId = "vercel" | "railway" | "manual";

export type FactoryStageId = "intake" | "bootstrap" | "implementation" | "delivery";

export type FactoryArtifactKind =
  | "repository"
  | "bootstrap_plan"
  | "deployment_handoff"
  | "delivery_summary";

export type FactoryArtifactStatus = "planned" | "active" | "ready" | "completed";

export type FactoryContractEvidenceKind =
  | "phase_status"
  | "artifact_status"
  | "task_evidence"
  | "backlog_item_status"
  | "delivery_summary"
  | "result_summary"
  | "repository_link";

export type FactoryCompletionCriterion = {
  id: string;
  description: string;
};

export type FactoryVerificationCriterion = {
  id: string;
  description: string;
  evidenceKind: FactoryContractEvidenceKind;
  target: string;
  expectedValue?: string | null;
};

export type FactoryRunInput = {
  appName: string;
  stackTemplateId: FactoryStackTemplateId;
  repository: {
    provider?: FactoryRepositoryProviderId | null;
    owner?: string | null;
    name: string;
    visibility?: FactoryRepositoryVisibility | null;
    baseBranch?: string | null;
  };
  deployment: {
    provider: FactoryDeploymentProviderId;
    projectName?: string | null;
    environment?: string | null;
    url?: string | null;
  };
};

export type FactoryStackSummary = {
  templateId: FactoryStackTemplateId;
  label: string;
  frontend: string;
  backend: string;
  data: string;
  deployment: string;
};

export type FactoryRepositoryState = {
  provider: FactoryRepositoryProviderId;
  owner: string | null;
  name: string;
  visibility: FactoryRepositoryVisibility;
  baseBranch: string;
  url: string | null;
  localPath: string | null;
};

export type FactoryDeploymentState = {
  provider: FactoryDeploymentProviderId;
  projectName: string | null;
  environment: string | null;
  url: string | null;
};

export type FactoryAppSpec = {
  appName: string;
  productBrief: string;
  stack: FactoryStackSummary;
  repository: {
    provider: FactoryRepositoryProviderId;
    owner: string | null;
    name: string;
    visibility: FactoryRepositoryVisibility;
    baseBranch: string;
  };
  deployment: {
    provider: FactoryDeploymentProviderId;
    projectName: string | null;
    environment: string | null;
  };
};

export type FactoryPhaseContract = {
  phaseId: string;
  stageId: FactoryStageId;
  name: string;
  completionCriteria: FactoryCompletionCriterion[];
  verificationCriteria: FactoryVerificationCriterion[];
};

export type FactoryDefinitionOfDone = {
  summary: string;
  completionCriteria: FactoryCompletionCriterion[];
  verificationCriteria: FactoryVerificationCriterion[];
};

export type FactoryCompletionContract = {
  version: 1;
  appSpec: FactoryAppSpec;
  definitionOfDone: FactoryDefinitionOfDone;
  phases: FactoryPhaseContract[];
};

export type FactoryBacklogItemStatus = "planned" | "active" | "completed" | "failed";

export type FactoryBacklogItemSource = "seed" | "expansion";

export type FactoryStagePlanStatus = "planned" | "active" | "completed" | "failed";

export type FactoryExpansionDecisionOutcome = "expanded" | "complete" | "no_change";

export type FactoryDelegationPath =
  | "orchestrator_to_production_lead"
  | "production_lead_to_specialist"
  | "specialist_to_execution";

export type FactoryDelegationStatus =
  | "planned"
  | "created"
  | "accepted"
  | "completed"
  | "failed";

export type FactoryOwnershipAssignment = {
  entityKind: "story" | "task";
  entityId: string;
  storyId: string;
  taskId: string | null;
  backlogItemIds: string[];
  ownerRole: Extract<ControlPlaneRole, "specialist_dev" | "execution_subagent">;
  ownerAgentId: string;
  ownerAgentTypeId: TeamSkillId | null;
  specialistAgentTypeId: SpecialistAgentTypeId | null;
  acceptanceCriteria: string[];
  acceptanceTargetIds: string[];
  verificationTargetIds: string[];
  validationTargets: string[];
  dependencyIds: string[];
};

export type FactoryOwnershipPlan = {
  stageId: FactoryStageId;
  phaseId: string;
  summary: string;
  productionLeadAgentId: string;
  productionLeadAgentTypeId: "production_lead";
  storyAssignments: FactoryOwnershipAssignment[];
  taskAssignments: FactoryOwnershipAssignment[];
  updatedAt: string;
};

export type FactoryDependencyGraphNode = {
  id: string;
  entityKind: "story" | "task";
  entityId: string;
  storyId: string;
  taskId: string | null;
  backlogItemIds: string[];
  label: string;
};

export type FactoryDependencyGraphEdge = {
  fromNodeId: string;
  toNodeId: string;
  dependencyIds: string[];
  rationale: string;
};

export type FactoryDependencyGraph = {
  stageId: FactoryStageId;
  phaseId: string;
  nodes: FactoryDependencyGraphNode[];
  edges: FactoryDependencyGraphEdge[];
  updatedAt: string;
};

export type FactoryDelegationBrief = {
  id: string;
  stageId: FactoryStageId;
  phaseId: string;
  entityKind: "story" | "task";
  entityId: string;
  storyId: string;
  taskId: string | null;
  backlogItemIds: string[];
  delegationPath: FactoryDelegationPath;
  status: FactoryDelegationStatus;
  fromRole: ControlPlaneRole;
  fromAgentId: string;
  fromAgentTypeId: TeamSkillId | null;
  toRole: ControlPlaneRole;
  toAgentId: string;
  toAgentTypeId: TeamSkillId | null;
  specialistAgentTypeId: SpecialistAgentTypeId | null;
  scopeSummary: string;
  acceptanceCriteria: string[];
  acceptanceTargetIds: string[];
  verificationTargetIds: string[];
  validationTargets: string[];
  dependencyIds: string[];
  artifactId: string;
  handoffId: string;
  createdAt: string;
  updatedAt: string;
};

export type FactoryBacklogItem = {
  id: string;
  stageId: FactoryStageId;
  title: string;
  description: string;
  instruction: string;
  expectedOutcome: string;
  storyId: string | null;
  taskId: string | null;
  acceptanceCriteria: string[];
  completionCriterionIds: string[];
  verificationCriterionIds: string[];
  preferredSpecialistAgentTypeId: SpecialistAgentTypeId | null;
  requiredSpecialistAgentTypeId: SpecialistAgentTypeId | null;
  source: FactoryBacklogItemSource;
  status: FactoryBacklogItemStatus;
  rationale: string;
  createdAt: string;
  insertedAt: string | null;
  completedAt: string | null;
};

export type FactoryStagePlan = {
  stageId: FactoryStageId;
  phaseId: string;
  title: string;
  summary: string;
  status: FactoryStagePlanStatus;
  backlog: FactoryBacklogItem[];
  lastExpandedAt: string | null;
  updatedAt: string;
};

export type FactoryExpansionDecision = {
  id: string;
  stageId: FactoryStageId;
  phaseId: string;
  outcome: FactoryExpansionDecisionOutcome;
  summary: string;
  rationale: string;
  missingCompletionCriterionIds: string[];
  missingVerificationCriterionIds: string[];
  addedBacklogItemIds: string[];
  decidedAt: string;
};

export type FactoryArtifact = {
  id: string;
  kind: FactoryArtifactKind;
  title: string;
  summary: string;
  status: FactoryArtifactStatus;
  url: string | null;
  path: string | null;
  provider: string | null;
  updatedAt: string;
};

export type FactoryRunState = {
  version: 1;
  mode: "factory";
  appName: string;
  productBrief: string;
  stack: FactoryStackSummary;
  repository: FactoryRepositoryState;
  deployment: FactoryDeploymentState;
  completionContract: FactoryCompletionContract;
  stagePlans: FactoryStagePlan[];
  expansionDecisions: FactoryExpansionDecision[];
  ownershipPlans: FactoryOwnershipPlan[];
  dependencyGraphs: FactoryDependencyGraph[];
  delegationBriefs: FactoryDelegationBrief[];
  currentStage: FactoryStageId;
  artifacts: FactoryArtifact[];
  deliverySummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RollingSummary = {
  text: string;
  updatedAt: string;
  source: "result" | "failure" | "retry";
};

export type ExternalRecordProviderId = "file_mirror";

export type ExternalRecordEntityKind = "run" | ControlPlaneEntityKind;

export type ExternalRecordLinkKind = "repository" | "pull_request" | "deployment";

export type RunProjectLinkInput = {
  id?: string | null;
  kind: ExternalRecordLinkKind;
  url: string;
  title?: string | null;
  provider?: string | null;
  entityKind?: ExternalRecordEntityKind | null;
  entityId?: string | null;
};

export type ExternalRecordLink = {
  id: string;
  kind: ExternalRecordLinkKind;
  url: string;
  title: string | null;
  provider: string | null;
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  syncedAt: string | null;
};

export type ExternalRecordStatus = AgentRunStatus | PhaseStatus;

export type ExternalSyncUpdateKind =
  | "status"
  | "approval"
  | "blocker"
  | "completion"
  | "failure"
  | "retry"
  | "link";

export type ExternalRecordUpdate = {
  id: string;
  kind: ExternalSyncUpdateKind;
  summary: string;
  status: ExternalRecordStatus | null;
  at: string;
  actionId: string;
};

export type ExternalRecordMirror = {
  externalId: string;
  provider: ExternalRecordProviderId;
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  title: string;
  status: ExternalRecordStatus;
  summary: string;
  parentExternalId: string | null;
  childExternalIds: string[];
  links: ExternalRecordLink[];
  lastSyncedAt: string | null;
  lastUpdateSummary: string | null;
  updateCount: number;
};

export type ExternalRecordMirrorDetail = ExternalRecordMirror & {
  runId: string;
  updates: ExternalRecordUpdate[];
};

export type ExternalSyncActionKind = "upsert_record" | "append_update" | "attach_link";

export type ExternalSyncActionStatus = "pending" | "completed" | "failed";

export type ExternalSyncUpsertRecordPayload = {
  kind: "upsert_record";
  title: string;
  status: ExternalRecordStatus;
  summary: string;
  parentEntityKind: ExternalRecordEntityKind | null;
  parentEntityId: string | null;
};

export type ExternalSyncAppendUpdatePayload = {
  kind: "append_update";
  updateKind: ExternalSyncUpdateKind;
  summary: string;
  status: ExternalRecordStatus | null;
  occurredAt: string;
};

export type ExternalSyncAttachLinkPayload = {
  kind: "attach_link";
  link: Omit<ExternalRecordLink, "syncedAt">;
};

export type ExternalSyncActionPayload =
  | ExternalSyncUpsertRecordPayload
  | ExternalSyncAppendUpdatePayload
  | ExternalSyncAttachLinkPayload;

export type ExternalSyncAction = {
  id: string;
  dedupeKey: string;
  provider: ExternalRecordProviderId;
  entityKind: ExternalRecordEntityKind;
  entityId: string;
  kind: ExternalSyncActionKind;
  status: ExternalSyncActionStatus;
  payload: ExternalSyncActionPayload;
  attempts: number;
  lastAttemptAt: string | null;
  completedAt: string | null;
  error: string | null;
  externalRecordId: string | null;
};

export type ExternalSyncState = {
  version: 1;
  provider: ExternalRecordProviderId;
  status: "idle" | "ready" | "degraded";
  lastSyncedAt: string | null;
  lastError: string | null;
  actions: ExternalSyncAction[];
  records: ExternalRecordMirror[];
};

export type RunProjectInput = {
  id: string;
  name?: string | null;
  kind?: "live" | "local";
  environment?: string | null;
  description?: string | null;
  links?: RunProjectLinkInput[] | null;
  folder?: {
    name?: string | null;
    displayPath?: string | null;
    status?: "connected" | "needs-access" | null;
    provider?: "runtime" | "browser-file-system-access" | null;
  } | null;
};

export type SubmitTaskInput = {
  instruction: string;
  title?: string;
  threadId?: string;
  parentRunId?: string | null;
  operatingMode?: RequestedOperatingMode | null;
  simulateFailure?: boolean;
  toolRequest?: RepoToolRequest | null;
  attachments?: RunAttachment[];
  project?: RunProjectInput | null;
  context?: RunContextInput | null;
  phaseExecution?: PhaseExecutionInput | null;
  rebuild?: RebuildInput | null;
  factory?: FactoryRunInput | null;
};

export type AgentRunFailure = {
  message: string;
  code?: RepoToolErrorCode | "execution_failed" | "planning_failed" | "verification_failed";
  toolName?: RepoToolName;
  path?: string;
  validationResult?: ValidationResult | null;
  rollback?: RollbackResult | null;
};

export type AgentRunResult = {
  mode:
    | "placeholder-execution"
    | "ai-sdk-openai"
    | "repo-tool"
    | "phase-execution"
    | "ship-rebuild";
  summary: string;
  instructionEcho: string;
  skillId: string;
  completedAt: string;
  orchestration?: OrchestrationState | null;
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  rebuild?: RebuildState | null;
  factory?: FactoryRunState | null;
  requestedOperatingMode?: RequestedOperatingMode | null;
  operatingMode?: OperatingMode | null;
  responseText?: string | null;
  provider?: "openai" | null;
  modelId?: string | null;
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    providerLatencyMs: number | null;
    estimatedCostUsd: number | null;
  } | null;
  toolResult?: RepoToolResult | null;
  paused?: {
    reason: "approval_gate";
    gateId: string;
    gateKind: ApprovalGateKind;
    phaseId: string;
    summary: string;
  } | null;
};

export type AgentRunRecord = {
  id: string;
  threadId: string;
  parentRunId: string | null;
  title: string | null;
  instruction: string;
  requestedOperatingMode?: RequestedOperatingMode | null;
  operatingMode?: OperatingMode | null;
  simulateFailure: boolean;
  toolRequest: RepoToolRequest | null;
  attachments: RunAttachment[];
  project?: RunProjectInput | null;
  context: RunContextInput;
  status: AgentRunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  validationStatus: ValidationStatus;
  lastValidationResult: ValidationResult | null;
  orchestration: OrchestrationState | null;
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  rebuild?: RebuildState | null;
  factory?: FactoryRunState | null;
  externalSync?: ExternalSyncState | null;
  rollingSummary: RollingSummary | null;
  events: RunEvent[];
  error: AgentRunFailure | null;
  result: AgentRunResult | null;
};

export type AgentRuntimeStatus = {
  startedAt: string;
  workerState: RuntimeWorkerState;
  activeRunId: string | null;
  queuedRuns: number;
  totalRuns: number;
  runsByStatus: Record<AgentRunStatus, number>;
  instructions: {
    skillId: string;
    loadedAt: string;
  };
};

export type ExecuteRun = (
  run: AgentRunRecord,
  context: {
    instructionRuntime: AgentInstructionRuntime;
    roleContextPrompt?: string | null;
    roleContextSectionIds?: string[];
    maxOutputTokens?: number | null;
    plannedStep?: PlannerStep | null;
  }
) => Promise<AgentRunResult>;

export type AgentRunStore = {
  load(): Promise<AgentRunRecord[]>;
  create(run: AgentRunRecord): Promise<void>;
  update(run: AgentRunRecord): Promise<void>;
  get(id: string): Promise<AgentRunRecord | null>;
  list(): Promise<AgentRunRecord[]>;
};

export type PersistentAgentRuntimeService = {
  instructionRuntime: AgentInstructionRuntime;
  submitTask(input: SubmitTaskInput): Promise<AgentRunRecord>;
  resolveApprovalGate(input: ResolveApprovalGateInput): Promise<AgentRunRecord>;
  getRun(id: string): AgentRunRecord | null;
  listRuns(): AgentRunRecord[];
  getStatus(): AgentRuntimeStatus;
};

export type ExternalRecordSyncServiceDescriptor = {
  providerId: ExternalRecordProviderId;
  location: string | null;
};

export type ExternalRecordSyncService = {
  descriptor: ExternalRecordSyncServiceDescriptor;
  syncRun(run: AgentRunRecord): Promise<ExternalSyncState>;
  listRecords(): Promise<ExternalRecordMirrorDetail[]>;
  getRecord(externalId: string): Promise<ExternalRecordMirrorDetail | null>;
};

export type ResolveApprovalGateInput = {
  runId: string;
  gateId: string;
  decision: ApprovalDecision;
  comment?: string | null;
};

export type RuntimeObservability = {
  traceService?: TraceService;
};

export function cloneRunRecord(run: AgentRunRecord): AgentRunRecord {
  return structuredClone(run);
}
