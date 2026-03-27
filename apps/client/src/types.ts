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

export type RuntimeRepoBranch = {
  name: string;
  current: boolean;
};

export type RuntimeRepoBranchSnapshot = {
  repoRoot: string;
  currentBranch: string | null;
  dirty: boolean;
  branches: RuntimeRepoBranch[];
  canSwitch: boolean;
  blockingReason: string | null;
};

export type RuntimeRepoBranchResponse = RuntimeRepoBranchSnapshot;

export type RuntimeTaskStatus = "pending" | "running" | "paused" | "completed" | "failed";
export type RuntimeWorkflowMode = "standard" | "factory";
export type RuntimeFactoryStackTemplateId =
  | "nextjs_supabase_vercel"
  | "nextjs_railway_postgres"
  | "react_express_railway";
export type RuntimeFactoryRepositoryVisibility = "private" | "public";
export type RuntimeFactoryDeploymentProviderId = "vercel" | "railway" | "manual";

export type RuntimeFactoryRunInput = {
  appName: string;
  stackTemplateId: RuntimeFactoryStackTemplateId;
  repository: {
    provider?: "github" | null;
    owner?: string | null;
    name: string;
    visibility?: RuntimeFactoryRepositoryVisibility | null;
    baseBranch?: string | null;
  };
  deployment: {
    provider: RuntimeFactoryDeploymentProviderId;
    projectName?: string | null;
    environment?: string | null;
    url?: string | null;
  };
};

export type RuntimeFactoryRunState = {
  version: 1;
  mode: "factory";
  appName: string;
  productBrief: string;
  stack: {
    templateId: RuntimeFactoryStackTemplateId;
    label: string;
    frontend: string;
    backend: string;
    data: string;
    deployment: string;
  };
  repository: {
    provider: "github";
    owner: string | null;
    name: string;
    visibility: RuntimeFactoryRepositoryVisibility;
    baseBranch: string;
    url: string | null;
    localPath: string | null;
  };
  deployment: {
    provider: RuntimeFactoryDeploymentProviderId;
    projectName: string | null;
    environment: string | null;
    url: string | null;
  };
  currentStage: "intake" | "bootstrap" | "implementation" | "delivery";
  artifacts: Array<{
    id: string;
    kind: "repository" | "bootstrap_plan" | "deployment_handoff" | "delivery_summary";
    title: string;
    summary: string;
    status: "planned" | "active" | "ready" | "completed";
    url: string | null;
    path: string | null;
    provider: string | null;
    updatedAt: string;
  }>;
  deliverySummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeFactoryComposerDraft = {
  appName: string;
  stackTemplateId: RuntimeFactoryStackTemplateId;
  repositoryOwner: string;
  repositoryName: string;
  repositoryVisibility: RuntimeFactoryRepositoryVisibility;
  deploymentProvider: RuntimeFactoryDeploymentProviderId;
  deploymentProjectName: string;
  deploymentEnvironment: string;
};

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
  links: Array<{
    id?: string | null;
    kind: "repository" | "pull_request" | "deployment";
    url: string;
    title?: string | null;
    provider?: string | null;
    entityKind?: "run" | "phase" | "story" | "task" | null;
    entityId?: string | null;
  }>;
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
  operatorView?: RuntimeOperatorView | null;
  factory?: RuntimeFactoryRunState | null;
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
    factory?: RuntimeFactoryRunState | null;
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
  | "sync"
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
    controlPlane: {
      status: string | null;
      artifactCount: number;
      artifactKinds: string[];
      handoffCount: number;
      pendingHandoffCount: number;
      acceptedHandoffCount: number;
      completedHandoffCount: number;
      workPacketCount: number;
      workPacketOwnerAgentTypes: string[];
      conflictCount: number;
      openConflictCount: number;
      conflictKinds: string[];
      mergeDecisionCount: number;
      mergeDecisionOutcomes: string[];
      activeApprovalGateId: string | null;
      currentEntityKind: string | null;
      currentEntityId: string | null;
    } | null;
    delivery: {
      status: string | null;
      headline: string | null;
      outputCount: number;
      linkCount: number;
      riskCount: number;
      followUpCount: number;
      sourceArtifactCount: number;
    } | null;
    evaluation: {
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
      failurePatternCount: number;
      bottlenecks: string[];
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

export type RuntimeOperatorStageId =
  | "queued"
  | "coordination"
  | "execution"
  | "validation"
  | "rebuild"
  | "delivery";

export type RuntimeOperatorStageStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped";

export type RuntimeOperatorJournalTone = "default" | "info" | "success" | "warning" | "danger";

export type RuntimeOperatorStage = {
  id: RuntimeOperatorStageId;
  label: string;
  status: RuntimeOperatorStageStatus;
  detail: string;
};

export type RuntimeOperatorOwner = {
  id: string | null;
  role: string | null;
  label: string;
  agentTypeId: string | null;
};

export type RuntimeOperatorCurrentWork = {
  entityKind: "phase" | "story" | "task" | "run" | "orchestration_step" | "rebuild" | null;
  entityId: string | null;
  label: string | null;
  status: string | null;
};

export type RuntimeOperatorProgress = {
  totalPhases: number;
  completedPhases: number;
  totalStories: number;
  completedStories: number;
  totalTasks: number;
  completedTasks: number;
};

export type RuntimeOperatorRetrySummary = {
  runRetries: number;
  storyRetries: number;
  taskRetries: number;
  totalRetries: number;
  maxStoryRetries: number | null;
  maxTaskRetries: number | null;
  note: string | null;
};

export type RuntimeOperatorBlocker = {
  id: string;
  entityKind: "phase" | "story" | "task";
  entityId: string;
  summary: string;
  ownerLabel: string;
  createdAt: string;
};

export type RuntimeOperatorConflict = {
  id: string;
  kind: string;
  entityKind: "phase" | "story" | "task";
  entityId: string;
  summary: string;
  status: "open" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
  ownerLabel: string;
  routeLabel: string | null;
  conflictingPaths: string[];
  expectedPaths: string[];
  conflictingAgentLabels: string[];
  resolutionDecisionId: string | null;
};

export type RuntimeOperatorMergeDecision = {
  id: string;
  entityKind: "phase" | "story" | "task";
  entityId: string;
  outcome: "accept" | "retry" | "reassign" | "reject";
  summary: string;
  decidedAt: string;
  ownerLabel: string;
  targetHandoffLabel: string | null;
  reassignedToLabel: string | null;
  conflictIds: string[];
  notes: string | null;
};

export type RuntimeOperatorDeliveryLink = {
  kind: string;
  label: string;
  url: string;
  provider: string | null;
};

export type RuntimeOperatorDeliverySummary = {
  status: "completed" | "failed" | "in_progress";
  headline: string;
  outputs: string[];
  links: RuntimeOperatorDeliveryLink[];
  risks: string[];
  followUps: string[];
  sourceArtifactIds: string[];
  updatedAt: string | null;
};

export type RuntimeOperatorEvaluationScorecard = {
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

export type RuntimeOperatorEvaluationBottleneck = {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warning" | "danger";
  metric: number;
};

export type RuntimeOperatorEvaluation = {
  scorecard: RuntimeOperatorEvaluationScorecard;
  bottlenecks: RuntimeOperatorEvaluationBottleneck[];
  failurePatterns: string[];
};

export type RuntimeOperatorComparativeAnalysisSectionId =
  | "executive_summary"
  | "delivery_and_outputs"
  | "validation_and_quality"
  | "interventions_and_retries"
  | "blockers_and_conflicts"
  | "risks_and_follow_ups"
  | "recommended_improvements";

export type RuntimeOperatorComparativeAnalysisSection = {
  id: RuntimeOperatorComparativeAnalysisSectionId;
  title: string;
  summary: string;
  highlights: string[];
};

export type RuntimeOperatorComparativeAnalysis = {
  status: "completed" | "failed";
  headline: string;
  sections: RuntimeOperatorComparativeAnalysisSection[];
  sourceArtifactIds: string[];
  updatedAt: string | null;
};

export type RuntimeOperatorPlanningArtifact = {
  id: string;
  kind: string;
  entityKind: "phase" | "story" | "task";
  entityId: string;
  summary: string;
  createdAt: string;
  producerLabel: string;
  path: string | null;
  highlights: string[];
};

export type RuntimeOperatorDelegationPacket = {
  id: string;
  entityKind: "phase" | "story" | "task";
  entityId: string;
  routeLabel: string;
  purpose: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  ownerLabel: string;
  artifactIds: string[];
  dependencyIds: string[];
  acceptanceCriteria: string[];
  validationTargets: string[];
  workPacket:
    | {
        version: 1;
        sourceArtifactIds: string[];
        scopeSummary: string;
        constraints: string[];
        fileTargets: string[];
        domainTargets: string[];
        acceptanceCriteria: string[];
        validationTargets: string[];
        dependencyIds: string[];
        taskIds: string[];
        ownerAgentTypeId: string | null;
        ownerLabel: string | null;
      }
    | null;
};

export type RuntimeOperatorApprovalDecision = "approve" | "reject" | "request_retry";

export type RuntimeOperatorApprovalGateStatus =
  | "pending"
  | "waiting"
  | "approved"
  | "rejected";

export type RuntimeOperatorApprovalGate = {
  id: string;
  kind: "architecture" | "implementation" | "deployment";
  phaseId: string;
  phaseName: string;
  title: string;
  instructions: string | null;
  status: RuntimeOperatorApprovalGateStatus;
  waitingAt: string | null;
  resolvedAt: string | null;
  ownerLabel: string;
  decisions: Array<{
    id: string;
    decision: RuntimeOperatorApprovalDecision;
    comment: string | null;
    decidedAt: string;
  }>;
};

export type RuntimeOperatorJournalEntry = {
  id: string;
  kind: "run" | "event" | "handoff" | "blocker" | "intervention" | "artifact";
  at: string;
  label: string;
  detail: string;
  tone: RuntimeOperatorJournalTone;
  meta: string[];
};

export type RuntimeOperatorView = {
  summary: string;
  stage: RuntimeOperatorStage;
  stages: RuntimeOperatorStage[];
  owner: RuntimeOperatorOwner;
  current: RuntimeOperatorCurrentWork;
  nextAction: string | null;
  progress: RuntimeOperatorProgress | null;
  retries: RuntimeOperatorRetrySummary;
  approval: {
    activeGateId: string | null;
    activeGate: RuntimeOperatorApprovalGate | null;
    gates: RuntimeOperatorApprovalGate[];
  } | null;
  blockers: RuntimeOperatorBlocker[];
  conflicts: RuntimeOperatorConflict[];
  mergeDecisions: RuntimeOperatorMergeDecision[];
  delivery: RuntimeOperatorDeliverySummary | null;
  evaluation: RuntimeOperatorEvaluation | null;
  comparativeAnalysis: RuntimeOperatorComparativeAnalysis | null;
  planningArtifacts: RuntimeOperatorPlanningArtifact[];
  delegationPackets: RuntimeOperatorDelegationPacket[];
  journal: RuntimeOperatorJournalEntry[];
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

export type WorkspaceProjectRepositoryProvider = "github" | "git";

export type WorkspaceProjectRepository = {
  provider: WorkspaceProjectRepositoryProvider;
  remoteName: string | null;
  url: string | null;
  label: string;
  owner: string | null;
  repo: string | null;
  currentBranch: string | null;
  source: "git-config" | "git-head";
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
  repository: WorkspaceProjectRepository | null;
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
  attachments?: AttachmentCard[];
  trace?: {
    runId: string;
    status: RuntimeTaskStatus;
    items: AgentActivityItem[];
  };
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
  factory:
    | {
        appName: string;
        stackLabel: string;
        repositoryName: string;
        deploymentProvider: RuntimeFactoryDeploymentProviderId;
        currentStage: RuntimeFactoryRunState["currentStage"];
        workspacePath: string | null;
      }
    | null;
  attachments: AttachmentCard[];
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
    operatorView: RuntimeOperatorView | null;
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
