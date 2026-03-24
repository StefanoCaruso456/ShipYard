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
  mode: "placeholder-execution" | "ai-sdk-openai" | "repo-tool";
  summary: string;
  instructionEcho: string;
  skillId: string;
  completedAt: string;
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
