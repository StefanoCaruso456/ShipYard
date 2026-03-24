import type {
  AutomationItem,
  GitChange,
  ModeOption,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTask,
  SidebarNavItem,
  SkillCatalogItem,
  TerminalEntry,
  ThreadMessage,
  UtilityTab,
  WorkspaceProject,
  WorkspaceThread
} from "./types";

export const emptyProjectBrief: ProjectPayload = {
  name: "Shipyard",
  tagline: "Persistent coding-agent workspace coming online.",
  what: [],
  why: [],
  how: [],
  outcome: [],
  nextStep: "Start the runtime service and submit a task to begin.",
  agentDecisions: []
};

export const workspaceProjects: WorkspaceProject[] = [
  {
    id: "shipyard-runtime",
    name: "Shipyard Runtime",
    code: "SR",
    environment: "Live backend",
    description: "Connected to the persistent runtime service and run registry.",
    kind: "live",
    region: "Railway / Vercel"
  },
  {
    id: "agent-lab",
    name: "Agent Lab",
    code: "AL",
    environment: "Preview",
    description: "Sandbox threads for future editing and recovery workflows.",
    kind: "preview",
    region: "Local simulation"
  },
  {
    id: "ship-ops",
    name: "Ship Ops",
    code: "SO",
    environment: "Preview",
    description: "Operational playbooks, automation drafts, and runbook experiments.",
    kind: "preview",
    region: "Design mode"
  }
];

export const sidebarNavigation: SidebarNavItem[] = [
  {
    id: "projects",
    label: "Projects",
    hint: "Threads and workspaces"
  },
  {
    id: "skills",
    label: "Skills",
    hint: "Instruction packs"
  },
  {
    id: "automations",
    label: "Automations",
    hint: "Recurring flows"
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Runtime preferences"
  }
];

export const utilityTabs: Array<{ id: UtilityTab; label: string; tone: "live" | "preview" }> = [
  { id: "run", label: "Run", tone: "live" },
  { id: "diff", label: "Diff / Git", tone: "preview" },
  { id: "terminal", label: "Terminal", tone: "preview" },
  { id: "skills", label: "Skills", tone: "live" },
  { id: "automations", label: "Automations", tone: "preview" }
];

export const modeOptions: Array<{ id: ModeOption; label: string; detail: string }> = [
  { id: "local", label: "Local", detail: "Fast local iteration" },
  { id: "worktree", label: "Worktree", detail: "Scoped edits in isolation" },
  { id: "cloud", label: "Cloud", detail: "Remote execution lane" }
];

const previewThreadsByProject: Record<string, WorkspaceThread[]> = {
  "agent-lab": [
    {
      id: "lab-1",
      title: "Retry-safe patch workflow",
      summary: "Prototype how the executor should recover after a failed anchor edit.",
      status: "review",
      source: "preview",
      createdLabel: "Preview flow",
      updatedLabel: "Refined 14m ago",
      tags: ["editing", "recovery", "phase-3"],
      messages: [
        createMessage(
          "lab-1-system",
          "system",
          "Preview thread",
          "This workspace is seeded UI data only. It exists to pressure-test the shell before the deeper editing runtime is wired.",
          "Today",
          "info"
        ),
        createMessage(
          "lab-1-assistant",
          "assistant",
          "Executor sketch",
          "Anchor-based replacement remains the first editing strategy. Recovery should re-localize, not stack guesses.",
          "14m ago",
          "default"
        )
      ],
      progress: [
        createProgress("lab-1-p1", "Thread seeded", "Preview data loaded for design review.", "Today", "info"),
        createProgress(
          "lab-1-p2",
          "Awaiting runtime integration",
          "Real file editing will arrive after the persistent loop and storage layers stabilize.",
          "14m ago",
          "warning"
        )
      ]
    },
    {
      id: "lab-2",
      title: "Planner context budgeting",
      summary: "Figure out how much repo context the planner should consume without drowning the executor.",
      status: "draft",
      source: "preview",
      createdLabel: "Draft brief",
      updatedLabel: "Queued for review",
      tags: ["planner", "context", "token-budget"],
      messages: [
        createMessage(
          "lab-2-system",
          "system",
          "Draft",
          "Use this thread to shape future planner prompt assembly and token budgeting rules.",
          "Today",
          "info"
        )
      ],
      progress: [
        createProgress("lab-2-p1", "Draft captured", "Thread exists as a UI placeholder for the next planning pass.", "Queued", "default")
      ]
    }
  ],
  "ship-ops": [
    {
      id: "ops-1",
      title: "Nightly runtime health digest",
      summary: "Draft the automation that summarizes failed and completed runs every morning.",
      status: "scheduled",
      source: "preview",
      createdLabel: "Automation draft",
      updatedLabel: "Waiting on backend",
      tags: ["automation", "reporting", "ops"],
      messages: [
        createMessage(
          "ops-1-system",
          "system",
          "Operations preview",
          "Automations are frontend-only for now. The form in the utility area is the intended staging surface.",
          "Today",
          "info"
        )
      ],
      progress: [
        createProgress(
          "ops-1-p1",
          "Schedule outlined",
          "Daily digests will become real once scheduling and persistence are implemented.",
          "Today",
          "warning"
        )
      ]
    }
  ]
};

export const seededSkillCatalog: SkillCatalogItem[] = [
  {
    id: "skill-repo-rules",
    name: "Project Rules",
    description: "Repository constraints, validation expectations, and scope boundaries.",
    source: "preview",
    scope: "Repo policy",
    status: "Referenced by builder workflow"
  },
  {
    id: "skill-runtime-loop",
    name: "Persistent Runtime Loop",
    description: "Upcoming execution contract for planner, executor, and verifier turns.",
    source: "preview",
    scope: "Phase 3",
    status: "Shell ready, engine pending"
  },
  {
    id: "skill-terminal-ops",
    name: "Terminal Ops",
    description: "Future command execution guardrails and terminal playback strategy.",
    source: "preview",
    scope: "Tool execution",
    status: "Planned"
  }
];

export const seededAutomations: AutomationItem[] = [
  {
    id: "auto-1",
    name: "Morning runtime digest",
    schedule: "Weekdays · 9:00 AM",
    workspace: "Shipyard Runtime",
    status: "draft",
    note: "Summarize failures, queue depth, and run counts once scheduling is wired."
  },
  {
    id: "auto-2",
    name: "Skills drift review",
    schedule: "Fridays · 4:30 PM",
    workspace: "Ship Ops",
    status: "draft",
    note: "Check whether runtime skills, rules, and builder prompts are still aligned."
  }
];

export function buildPreviewThreads(projectId: string) {
  return previewThreadsByProject[projectId] ?? [];
}

export function buildGuideThread(
  project: ProjectPayload,
  runtimeHealth: RuntimeHealthResponse | null,
  runtimeStatus: RuntimeStatusResponse | null,
  instructions: RuntimeInstructionResponse | null
): WorkspaceThread {
  const runtimeBadge = runtimeHealth?.status === "ok" ? "connected" : "awaiting backend";
  const runtimeSummary = runtimeStatus
    ? `${runtimeStatus.totalRuns} runs tracked, ${runtimeStatus.queuedRuns} queued, worker ${runtimeStatus.workerState}.`
    : "Runtime status will appear here when the API is reachable.";
  const instructionSummary = instructions
    ? `${instructions.skill.meta.name} is loaded in the runtime.`
    : "Instruction runtime inspection is not available yet.";

  return {
    id: "runtime-guide",
    title: "Runtime briefing",
    summary: "Live overview of the connected coding-agent workspace and current build direction.",
    status: "ready",
    source: "guide",
    createdLabel: "Always available",
    updatedLabel: runtimeStatus ? "Updated live" : "Waiting on backend",
    tags: ["overview", "runtime", runtimeBadge],
    messages: [
      createMessage(
        "guide-assistant",
        "assistant",
        "Shipyard",
        `${project.tagline} ${runtimeSummary} ${instructionSummary} Next step: ${project.nextStep}`,
        "Now",
        "default"
      )
    ],
    progress: []
  };
}

export function buildRuntimeThread(task: RuntimeTask): WorkspaceThread {
  const title = task.title?.trim() || task.instruction.split(/\s+/).slice(0, 5).join(" ");
  const completionLabel = task.completedAt ? formatDateTime(task.completedAt) : "Awaiting finish";

  const messages: ThreadMessage[] = [
    createMessage(
      `${task.id}-user`,
      "user",
      "Operator",
      task.instruction,
      formatDateTime(task.createdAt),
      "default"
    ),
    createMessage(
      `${task.id}-system`,
      "system",
      "Runtime queue",
      task.status === "failed"
        ? "Run failed inside the runtime execution path."
        : task.status === "completed"
          ? task.result?.mode === "ai-sdk-openai"
            ? "Run completed through the OpenAI executor."
            : "Run completed inside the persistent runtime skeleton."
          : "Run accepted into the persistent loop and awaiting execution.",
      task.startedAt ? formatDateTime(task.startedAt) : formatDateTime(task.createdAt),
      task.status === "failed" ? "danger" : task.status === "completed" ? "success" : "info"
    )
  ];

  if (task.result) {
    messages.push(
      createMessage(
        `${task.id}-assistant`,
        "assistant",
        "Runtime result",
        task.result.responseText ?? task.result.summary,
        formatDateTime(task.result.completedAt),
        "success"
      )
    );
  }

  if (task.error) {
    messages.push(
      createMessage(
        `${task.id}-error`,
        "assistant",
        "Failure",
        task.error.message,
        completionLabel,
        "danger"
      )
    );
  }

  const progress = [
    createProgress(
      `${task.id}-created`,
      "Task submitted",
      task.title ? `Title: ${task.title}` : "Task entered through the workspace composer.",
      formatDateTime(task.createdAt),
      "info"
    ),
    task.startedAt
      ? createProgress(
          `${task.id}-started`,
          "Runtime started",
          "Persistent runtime worker began processing the task.",
          formatDateTime(task.startedAt),
          "default"
        )
      : null,
    task.completedAt && task.status === "completed"
      ? createProgress(
          `${task.id}-completed`,
          "Run completed",
          task.result?.summary ??
            (task.result?.mode === "ai-sdk-openai"
              ? "OpenAI execution completed successfully."
              : "Placeholder execution completed successfully."),
          completionLabel,
          "success"
        )
      : null,
    task.completedAt && task.status === "failed"
      ? createProgress(
          `${task.id}-failed`,
          "Run failed",
          task.error?.message ?? "Unknown runtime error.",
          completionLabel,
          "danger"
        )
      : null
  ].filter(Boolean) as WorkspaceThread["progress"];

  return {
    id: task.id,
    title,
    summary:
      task.status === "completed"
        ? task.result?.summary ??
          (task.result?.mode === "ai-sdk-openai"
            ? "Completed OpenAI execution."
            : "Completed placeholder execution.")
        : task.status === "failed"
          ? task.error?.message ?? "Runtime failure."
          : "Queued in the persistent runtime service.",
    status: task.status,
    source: "live",
    createdLabel: formatShortDate(task.createdAt),
    updatedLabel: completionLabel,
    tags: [task.status, task.simulateFailure ? "failure-path" : "live-run"],
    messages,
    progress
  };
}

export function buildSkillCatalog(instructions: RuntimeInstructionResponse | null): SkillCatalogItem[] {
  const liveSkill = instructions
    ? [
        {
          id: instructions.skill.meta.id,
          name: instructions.skill.meta.name,
          description:
            "Currently loaded runtime skill backing the product-agent shell and role-specific instruction views.",
          source: "live" as const,
          scope: instructions.skill.meta.target,
          status: `${instructions.skill.sectionCount} sections parsed`
        }
      ]
    : [];

  return [...liveSkill, ...seededSkillCatalog];
}

export function buildGitPreview(thread: WorkspaceThread): GitChange[] {
  if (thread.source === "live") {
    return [
      {
        path: "apps/client/src/App.tsx",
        changeType: "M",
        summary: "Workspace state and task composer wiring staged in the UI shell."
      },
      {
        path: "apps/client/src/components/UtilityDock.tsx",
        changeType: "A",
        summary: "Diff, terminal, skills, and automations surfaces composed into a shared utility dock."
      },
      {
        path: "packages/agent-core/src/runtime/createPersistentRuntimeService.ts",
        changeType: "M",
        summary: "Run lifecycle source reflected here as a future diff preview placeholder."
      }
    ];
  }

  return [
    {
      path: "skill.md",
      changeType: "M",
      summary: "Preview instruction adjustments waiting on the real editing engine."
    },
    {
      path: "docs/architecture/implementation-phases.md",
      changeType: "M",
      summary: "Implementation phase summary for the current runtime build."
    }
  ];
}

export function buildTerminalPreview(
  thread: WorkspaceThread,
  runtimeStatus: RuntimeStatusResponse | null
): TerminalEntry[] {
  const entries: TerminalEntry[] = [
    {
      id: `${thread.id}-term-1`,
      timestamp: thread.createdLabel,
      text: `workspace selected :: ${thread.title}`,
      tone: "muted"
    }
  ];

  if (thread.source === "live") {
    entries.push(
      {
        id: `${thread.id}-term-2`,
        timestamp: thread.updatedLabel,
        text: `runtime worker=${runtimeStatus?.workerState ?? "idle"} queue=${runtimeStatus?.queuedRuns ?? 0}`,
        tone: "info"
      },
      {
        id: `${thread.id}-term-3`,
        timestamp: thread.updatedLabel,
        text:
          thread.status === "failed"
            ? "placeholder executor exited with simulated failure"
            : "placeholder executor finished without file edits",
        tone: thread.status === "failed" ? "danger" : "success"
      }
    );
  } else {
    entries.push(
      {
        id: `${thread.id}-term-2`,
        timestamp: "Preview",
        text: "terminal playback is stubbed until live command execution is wired",
        tone: "info"
      }
    );
  }

  return entries;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function createMessage(
  id: string,
  role: ThreadMessage["role"],
  label: string,
  body: string,
  timestamp: string,
  tone: ThreadMessage["tone"]
): ThreadMessage {
  return {
    id,
    role,
    label,
    body,
    timestamp,
    tone
  };
}

function createProgress(
  id: string,
  label: string,
  detail: string,
  timestamp: string,
  tone: WorkspaceThread["progress"][number]["tone"]
) {
  return {
    id,
    label,
    detail,
    timestamp,
    tone
  };
}
