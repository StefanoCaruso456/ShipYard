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
import type { TraceService } from "../observability/types";

export type AgentRunStatus = "pending" | "running" | "completed" | "failed";

export type RuntimeWorkerState = "idle" | "running";

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

export type RepoToolRequest = RepoInspectionToolRequest | RepoMutationToolRequest;

export type RepoMutationToolResult =
  | EditFileRegionResult
  | CreateFileResult
  | DeleteFileResult;

export type RepoInspectionToolResult =
  | ListFilesResult
  | ReadFileResult
  | ReadFileRangeResult
  | SearchRepoResult;

export type RepoToolResult = RepoInspectionToolResult | RepoMutationToolResult;

export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed";

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
  status: PhaseStatus;
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
  | "delegation_brief"
  | "task_result"
  | "validation_report"
  | "delivery_summary"
  | "failure_report";

export type ControlPlaneHandoffStatus = "created" | "accepted" | "completed";

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
  validationTargets: string[];
  purpose: string;
  status: ControlPlaneHandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
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
  current: PhaseExecutionPointer;
  progress: PhaseExecutionProgress;
  retryPolicy: PhaseExecutionRetryPolicy;
  phases: ControlPlanePhaseNode[];
  artifacts: ControlPlaneArtifact[];
  handoffs: ControlPlaneHandoff[];
  interventions: ControlPlaneIntervention[];
  blockers: ControlPlaneBlocker[];
  lastFailureReason: string | null;
  updatedAt: string;
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

export type RollingSummary = {
  text: string;
  updatedAt: string;
  source: "result" | "failure" | "retry";
};

export type RunProjectInput = {
  id: string;
  name?: string | null;
  kind?: "live" | "local";
  environment?: string | null;
  description?: string | null;
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
  simulateFailure?: boolean;
  toolRequest?: RepoToolRequest | null;
  attachments?: RunAttachment[];
  project?: RunProjectInput | null;
  context?: RunContextInput | null;
  phaseExecution?: PhaseExecutionInput | null;
  rebuild?: RebuildInput | null;
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
};

export type AgentRunRecord = {
  id: string;
  threadId: string;
  parentRunId: string | null;
  title: string | null;
  instruction: string;
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
  getRun(id: string): AgentRunRecord | null;
  listRuns(): AgentRunRecord[];
  getStatus(): AgentRuntimeStatus;
};

export type RuntimeObservability = {
  traceService?: TraceService;
};

export function cloneRunRecord(run: AgentRunRecord): AgentRunRecord {
  return structuredClone(run);
}
