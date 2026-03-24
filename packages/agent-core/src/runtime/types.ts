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

export type SubmitTaskInput = {
  instruction: string;
  title?: string;
  simulateFailure?: boolean;
  toolRequest?: RepoMutationToolRequest | null;
  attachments?: RunAttachment[];
  context?: RunContextInput | null;
  phaseExecution?: PhaseExecutionInput | null;
};

export type AgentRunFailure = {
  message: string;
  code?: RepoToolErrorCode | "execution_failed";
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
  phaseExecution?: PhaseExecutionState | null;
  responseText?: string | null;
  provider?: "openai" | null;
  modelId?: string | null;
  toolResult?: RepoMutationToolResult | null;
};

export type AgentRunRecord = {
  id: string;
  title: string | null;
  instruction: string;
  simulateFailure: boolean;
  toolRequest: RepoMutationToolRequest | null;
  attachments: RunAttachment[];
  context: RunContextInput;
  status: AgentRunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  validationStatus: ValidationStatus;
  lastValidationResult: ValidationResult | null;
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
  }
) => Promise<AgentRunResult>;

export type AgentRunStore = {
  create(run: AgentRunRecord): void;
  update(run: AgentRunRecord): void;
  get(id: string): AgentRunRecord | null;
  list(): AgentRunRecord[];
};

export type PersistentAgentRuntimeService = {
  instructionRuntime: AgentInstructionRuntime;
  submitTask(input: SubmitTaskInput): AgentRunRecord;
  getRun(id: string): AgentRunRecord | null;
  listRuns(): AgentRunRecord[];
  getStatus(): AgentRuntimeStatus;
};

export function cloneRunRecord(run: AgentRunRecord): AgentRunRecord {
  return structuredClone(run);
}
