export type DecisionStatus = "pending" | "proposed" | "locked";

export type ArchitectureDecision = {
  area: string;
  status: DecisionStatus;
  note: string;
};

export type ProjectPayload = {
  name: string;
  tagline: string;
  what: string[];
  why: string[];
  how: string[];
  outcome: string[];
  nextStep: string;
  agentDecisions: ArchitectureDecision[];
};

export type RuntimeHealthResponse = {
  status: string;
  service: string;
  instructions: {
    status: string;
    skillId: string;
    loadedAt: string;
  };
  runtime: {
    workerState: RuntimeWorkerState;
    activeRunId: string | null;
    queuedRuns: number;
    totalRuns: number;
  };
  model?: {
    provider: "openai";
    configured: boolean;
    modelId: string;
    apiKeySource: "OPENAI_KEY" | "OPENAI_API_KEY" | null;
  };
  audioTranscription?: {
    provider: "openai";
    configured: boolean;
    modelId: string;
    apiKeySource: "OPENAI_KEY" | "OPENAI_API_KEY" | null;
  };
};

export type RuntimeWorkerState = "idle" | "running";

export type RuntimeStatusResponse = {
  startedAt: string;
  workerState: RuntimeWorkerState;
  activeRunId: string | null;
  queuedRuns: number;
  totalRuns: number;
  runsByStatus: Record<RuntimeTaskStatus, number>;
  instructions: {
    skillId: string;
    loadedAt: string;
  };
  model?: {
    provider: "openai";
    configured: boolean;
    modelId: string;
    apiKeySource: "OPENAI_KEY" | "OPENAI_API_KEY" | null;
  };
  audioTranscription?: {
    provider: "openai";
    configured: boolean;
    modelId: string;
    apiKeySource: "OPENAI_KEY" | "OPENAI_API_KEY" | null;
  };
};

export type RuntimeTaskStatus = "pending" | "running" | "completed" | "failed";

export type AttachmentKind =
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

export type AttachmentAnalysis = {
  status: "analyzed" | "metadata_only";
  summary: string;
  excerpt: string | null;
  warnings: string[];
};

export type RuntimeAttachment = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  kind: AttachmentKind;
  analysis: AttachmentAnalysis;
};

export type AttachmentCard = {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  kind: AttachmentKind;
  summary: string;
  excerpt: string | null;
  previewUrl: string | null;
  source: "local" | "runtime";
};

export type RuntimeTaskProject = {
  id: string;
  name: string | null;
  kind: WorkspaceProjectKind;
  environment: string | null;
  description: string | null;
  folder: {
    name: string | null;
    displayPath: string | null;
    status: WorkspaceProjectFolderStatus | null;
    provider: WorkspaceProjectFolder["provider"] | null;
  } | null;
};

export type RuntimeTaskContext = {
  objective: string | null;
  constraints: string[];
  relevantFiles: Array<{
    path: string;
    excerpt?: string | null;
    startLine?: number | null;
    endLine?: number | null;
    source?: string | null;
    reason?: string | null;
  }>;
  externalContext: Array<{
    id: string;
    kind:
      | "spec"
      | "schema"
      | "prior_output"
      | "test_result"
      | "diff_summary"
      | "validation_target";
    title: string;
    content: string;
    source?: string | null;
    format?: "text" | "markdown" | "json" | null;
  }>;
  validationTargets: string[];
};

export type RuntimeTaskSubmitContext = RuntimeTaskContext;

export type RuntimeTask = {
  id: string;
  threadId: string;
  parentRunId: string | null;
  title: string | null;
  instruction: string;
  simulateFailure: boolean;
  toolRequest?: unknown;
  attachments: RuntimeAttachment[];
  project: RuntimeTaskProject | null;
  context?: RuntimeTaskContext;
  status: RuntimeTaskStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount?: number;
  validationStatus?: string;
  lastValidationResult?: unknown;
  rollingSummary?: {
    text: string;
    updatedAt: string;
    source: "result" | "failure" | "retry";
  } | null;
  events?: Array<{
    at: string;
    type: string;
    message: string;
    path?: string | null;
    toolName?: string | null;
  }>;
  error: {
    message: string;
  } | null;
  rebuild?: {
    status: "queued" | "rebuilding" | "completed" | "failed";
    target: {
      scope: "ship" | "project" | "workspace";
      shipId: string;
      label: string | null;
      objective: string | null;
      projectId: string | null;
      rootPath: string | null;
      baseBranch: string | null;
      entryPaths: string[];
      acceptanceSummary: string | null;
    };
    artifactLog: Array<{
      id: string;
      sourceArtifactId: string;
      kind: string;
      entityKind: string;
      entityId: string;
      summary: string;
      createdAt: string;
      path: string | null;
    }>;
    interventionLog: Array<{
      id: string;
      sourceInterventionId: string;
      kind: string;
      entityKind: string;
      entityId: string;
      summary: string;
      createdAt: string;
      resolvedAt: string | null;
    }>;
    validationStatus: string | null;
    lastFailureReason: string | null;
    updatedAt: string;
  } | null;
  result: {
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
    responseText?: string | null;
    provider?: "openai" | null;
    modelId?: string | null;
    toolResult?: unknown;
  } | null;
};

export type RuntimeTaskListResponse = {
  total: number;
  tasks: RuntimeTask[];
};

export type RuntimeTaskResponse = {
  task: RuntimeTask;
};

export type RuntimeTraceSpanType =
  | "run"
  | "phase"
  | "story"
  | "task"
  | "coordinator"
  | "handoff"
  | "merge"
  | "context"
  | "role"
  | "tool"
  | "validation"
  | "retry"
  | "rollback"
  | "model";

export type RuntimeTraceSpanStatus = "running" | "completed" | "failed";

export type RuntimeTraceSpanEvent = {
  id: string;
  at: string;
  name: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
};

export type RuntimeTraceSpan = {
  id: string;
  runId: string;
  parentId: string | null;
  name: string;
  spanType: RuntimeTraceSpanType;
  status: RuntimeTraceSpanStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  events: RuntimeTraceSpanEvent[];
};

export type RuntimeTraceRunLog = {
  runId: string;
  rootSpanId: string | null;
  updatedAt: string;
  summary: {
    status: RuntimeTraceSpanStatus | null;
    totalDurationMs: number | null;
    queueDelayMs: number | null;
    roleFlow: string | null;
    model: {
      provider: string | null;
      modelId: string | null;
    };
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      providerLatencyMs: number | null;
      estimatedCostUsd: number | null;
      estimatedCostStatus: string | null;
    };
    files: {
      selectedCount: number;
      selectedPaths: string[];
      changedCount: number;
      changedPaths: string[];
    };
    tools: {
      count: number;
      names: string[];
    };
    validation: {
      status: string | null;
      checks: string[];
      failureCount: number;
    };
    retries: {
      count: number;
    };
    rollbacks: {
      count: number;
    };
    attachments: {
      count: number;
      kinds: string[];
    };
    orchestration: {
      status: string | null;
      iteration: number | null;
      currentStepId: string | null;
      nextAction: string | null;
      stepRetryCount: number | null;
      maxStepRetries: number | null;
      replanCount: number | null;
      maxReplans: number | null;
    } | null;
    phaseExecution: {
      status: string | null;
      currentPhaseId: string | null;
      currentStoryId: string | null;
      currentTaskId: string | null;
      totalPhases: number | null;
      completedPhases: number | null;
      totalStories: number | null;
      completedStories: number | null;
      totalTasks: number | null;
      completedTasks: number | null;
      maxTaskRetries: number | null;
      maxStoryRetries: number | null;
      maxReplans: number | null;
    } | null;
    rebuild: {
      status: string | null;
      scope: string | null;
      shipId: string | null;
      label: string | null;
      objective: string | null;
      projectId: string | null;
      rootPath: string | null;
      baseBranch: string | null;
      entryPaths: string[];
      validationStatus: string | null;
      artifactCount: number;
      artifactKinds: string[];
      interventionCount: number;
      interventionKinds: string[];
      lastFailureReason: string | null;
    } | null;
  };
  spans: RuntimeTraceSpan[];
};

export type RuntimeTraceResponse = {
  runId: string;
  observability: {
    enabled: boolean;
    backend: "local" | "local+langsmith";
    localLogPath: string | null;
    langsmithEnabled: boolean;
    langsmithProject: string | null;
    workspaceScoped: boolean;
  } | null;
  trace: RuntimeTraceRunLog;
};

export type AgentActivityItem = {
  id: string;
  kind: "span" | "event" | "summary";
  badge: string;
  label: string;
  detail: string;
  timestamp: string;
  tone: "default" | "info" | "success" | "warning" | "danger";
  depth: number;
  surface?: "primary" | "secondary";
  status?: RuntimeTraceSpanStatus;
  sourceType?: RuntimeTraceSpanType | "summary";
  sourceName?: string | null;
  meta?: string[];
};

export type RuntimeInstructionResponse = {
  loadedAt: string;
  instructionPrecedence: string[];
  skill: {
    sourcePath: string;
    meta: {
      id: string;
      kind: string;
      name: string;
      version: number;
      target: string;
      appliesTo: string[];
      format: string;
    };
    sectionCount: number;
    sections: Array<{
      id: string;
      title: string;
      depth: number;
      path: string[];
    }>;
  };
  roleViews: Record<
    string,
    {
      sectionIds: string[];
      sections: Array<{
        id: string;
        title: string;
        path: string[];
      }>;
      renderedText: string;
    }
  >;
};

export type RuntimeAudioTranscriptionResponse = {
  transcription: {
    text: string;
    summary: string;
    excerpt: string | null;
    language: string | null;
    model: {
      provider: "openai";
      modelId: string;
    };
    file: {
      name: string;
      mimeType: string | null;
      size: number;
    };
  };
};

export type WorkspaceProjectKind = "live" | "local";

export type WorkspaceProjectFolderStatus = "connected" | "needs-access";

export type WorkspaceProjectFolder = {
  name: string;
  displayPath: string;
  status: WorkspaceProjectFolderStatus;
  provider: "runtime" | "browser-file-system-access";
  lastConnectedAt: string | null;
};

export type WorkspaceProject = {
  id: string;
  name: string;
  code: string;
  environment: string;
  description: string;
  kind: WorkspaceProjectKind;
  region: string;
  branchLabel: string | null;
  folder: WorkspaceProjectFolder | null;
  removable: boolean;
};

export type SidebarNavItemId = "projects" | "skills" | "automations" | "settings";

export type SidebarNavItem = {
  id: SidebarNavItemId;
  label: string;
  hint: string;
};

export type ModeOption = "local" | "worktree" | "cloud";

export type ComposerMode = "text" | "image" | "voice";

export type ComposerAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  mimeType: string | null;
  kind: AttachmentKind;
  file: File;
  previewUrl: string | null;
  summary: string;
  excerpt: string | null;
  source: "local";
};

export type RuntimeQueuedFollowUpDraft = {
  id: string;
  instruction: string;
  createdAt: string;
  attachments: ComposerAttachment[];
};

export type LocalFileExecutionStatus = "applying" | "applied" | "failed";

export type LocalFileExecutionEffect = {
  taskId: string;
  projectId: string;
  status: LocalFileExecutionStatus;
  summary: string;
  timestamp: string;
  files: string[];
  details: string[];
  error: string | null;
};

export type UtilityTab = "run" | "diff" | "terminal" | "skills" | "automations";

export type WorkspaceThreadStatus =
  | RuntimeTaskStatus
  | "ready"
  | "draft"
  | "review"
  | "scheduled";

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  label: string;
  body: string;
  timestamp: string;
  tone: "default" | "info" | "success" | "danger";
};

export type ProgressEvent = {
  id: string;
  label: string;
  detail: string;
  timestamp: string;
  tone: "default" | "info" | "success" | "warning" | "danger";
};

export type RuntimeThreadFocusedRun = {
  id: string;
  instruction: string;
  status: RuntimeTaskStatus;
  createdAt: string;
  startedAt: string | null;
  attachmentsCount: number;
};

export type RuntimeThreadQueuedItem = {
  id: string;
  instruction: string;
  createdAt: string;
  state: "queued" | "sending";
  attachmentsCount: number;
  parentRunId: string | null;
};

export type WorkspaceThread = {
  id: string;
  title: string;
  summary: string;
  status: WorkspaceThreadStatus;
  source: "live" | "guide" | "preview" | "draft";
  createdLabel: string;
  updatedLabel: string;
  tags: string[];
  attachments: AttachmentCard[];
  messages: ThreadMessage[];
  progress: ProgressEvent[];
  activity?: AgentActivityItem[];
  liveRuntime?: {
    threadId: string;
    focusedRunId: string | null;
    latestRunId: string | null;
    queuedRunIds: string[];
    runIds: string[];
    focusedRun: RuntimeThreadFocusedRun | null;
    queuedFollowUps: RuntimeThreadQueuedItem[];
    completedRunCount: number;
  };
};

export type ThreadGroup = {
  project: WorkspaceProject;
  threads: WorkspaceThread[];
};

export type SkillCatalogItem = {
  id: string;
  name: string;
  description: string;
  source: "live" | "preview";
  scope: string;
  status: string;
};

export type AutomationItem = {
  id: string;
  name: string;
  schedule: string;
  workspace: string;
  status: "draft" | "active";
  note: string;
};

export type GitChange = {
  path: string;
  changeType: "A" | "M" | "D";
  summary: string;
};

export type TerminalEntry = {
  id: string;
  timestamp: string;
  text: string;
  tone: "muted" | "info" | "success" | "danger";
};
