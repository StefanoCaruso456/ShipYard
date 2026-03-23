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
};

export type RuntimeTaskStatus = "pending" | "running" | "completed" | "failed";

export type RuntimeTask = {
  id: string;
  title: string | null;
  instruction: string;
  simulateFailure: boolean;
  status: RuntimeTaskStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: {
    message: string;
  } | null;
  result: {
    mode: "placeholder-execution";
    summary: string;
    instructionEcho: string;
    skillId: string;
    completedAt: string;
  } | null;
};

export type RuntimeTaskListResponse = {
  total: number;
  tasks: RuntimeTask[];
};

export type RuntimeTaskResponse = {
  task: RuntimeTask;
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

export type WorkspaceProject = {
  id: string;
  name: string;
  code: string;
  environment: string;
  description: string;
  kind: "live" | "preview";
  region: string;
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

export type WorkspaceThread = {
  id: string;
  title: string;
  summary: string;
  status: WorkspaceThreadStatus;
  source: "live" | "guide" | "preview";
  createdLabel: string;
  updatedLabel: string;
  tags: string[];
  messages: ThreadMessage[];
  progress: ProgressEvent[];
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
