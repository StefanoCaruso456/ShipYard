import type { AgentInstructionRuntime } from "../instructions/types";
import type {
  CreateFileInput,
  CreateFileResult,
  DeleteFileInput,
  DeleteFileResult,
  EditFileRegionInput,
  EditFileRegionResult,
  RepoToolErrorCode,
  RepoToolName
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

export type RepoMutationToolResult =
  | EditFileRegionResult
  | CreateFileResult
  | DeleteFileResult;

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
  toolRequest?: RepoMutationToolRequest | null;
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
  toolResult?: RepoMutationToolResult | null;
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

export type RunContextInput = {
  objective?: string | null;
  constraints: string[];
  relevantFiles: RelevantFileContext[];
  validationTargets: string[];
};

export type TaskInput = {
  id: string;
  instruction: string;
  expectedOutcome: string;
  toolRequest?: RepoMutationToolRequest | null;
  context?: RunContextInput | null;
  validationGates?: ValidationGate[];
};

export type UserStoryInput = {
  id: string;
  title: string;
  description: string;
  tasks: TaskInput[];
  acceptanceCriteria: string[];
  validationGates?: ValidationGate[];
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
  toolRequest: RepoMutationToolRequest | null;
  context: RunContextInput | null;
  validationGates: ValidationGate[];
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
  toolRequest?: RepoMutationToolRequest | null;
  attachments?: RunAttachment[];
  project?: RunProjectInput | null;
  context?: RunContextInput | null;
  phaseExecution?: PhaseExecutionInput | null;
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
  mode: "placeholder-execution" | "ai-sdk-openai" | "repo-tool" | "phase-execution";
  summary: string;
  instructionEcho: string;
  skillId: string;
  completedAt: string;
  orchestration?: OrchestrationState | null;
  phaseExecution?: PhaseExecutionState | null;
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
  toolResult?: RepoMutationToolResult | null;
};

export type AgentRunRecord = {
  id: string;
  threadId: string;
  parentRunId: string | null;
  title: string | null;
  instruction: string;
  simulateFailure: boolean;
  toolRequest: RepoMutationToolRequest | null;
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
