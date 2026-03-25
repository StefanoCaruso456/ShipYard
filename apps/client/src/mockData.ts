import { toAttachmentCard } from "./attachments";
import {
  stripLocalFilePlan
} from "./localFileBridge";
import { createRuntimeProject } from "./projects";
import type {
  AgentActivityItem,
  AutomationItem,
  ComposerAttachment,
  GitChange,
  LocalFileExecutionEffect,
  ModeOption,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTraceRunLog,
  RuntimeTraceSpan,
  RuntimeTraceSpanEvent,
  RuntimeQueuedFollowUpDraft,
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
  createRuntimeProject()
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
      attachments: [],
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
      attachments: [],
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
      attachments: [],
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
    attachments: [],
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

export function buildRuntimeThread(
  runs: RuntimeTask[],
  runtimeAttachmentPreviewsByTaskId: Record<string, ComposerAttachment[]> = {},
  runtimeTracesByTaskId: Record<string, RuntimeTraceRunLog> = {},
  optimisticFollowUps: RuntimeQueuedFollowUpDraft[] = [],
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect> = {}
): WorkspaceThread {
  const orderedRuns = [...runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const firstRun = orderedRuns[0];
  const latestRun = orderedRuns[orderedRuns.length - 1];

  if (!firstRun || !latestRun) {
    throw new Error("buildRuntimeThread requires at least one runtime run.");
  }

  const focusedRun = selectFocusedRun(orderedRuns);
  const queuedRuns = orderedRuns.filter(
    (run) => run.status === "pending" && run.id !== focusedRun.id
  );
  const threadStatus = deriveThreadStatus(orderedRuns);
  const attachmentCards = [
    ...orderedRuns.flatMap((run) =>
      run.attachments.map((attachment) =>
        toAttachmentCard(
          attachment,
          Object.fromEntries(
            (runtimeAttachmentPreviewsByTaskId[run.id] ?? []).map((preview) => [preview.name, preview])
          )
        )
      )
    ),
    ...optimisticFollowUps.flatMap((followUp) =>
      followUp.attachments.map((attachment) => toLocalAttachmentCard(attachment))
    )
  ];
  const activity = buildRuntimeActivity(focusedRun, runtimeTracesByTaskId[focusedRun.id] ?? null);
  const queuedFollowUps = buildQueuedFollowUpItems(queuedRuns, optimisticFollowUps);

  return {
    id: firstRun.threadId,
    title: firstRun.title?.trim() || deriveThreadTitle(firstRun.instruction),
    summary: deriveRuntimeThreadSummary(threadStatus, focusedRun, latestRun, queuedRuns.length + optimisticFollowUps.length),
    status: threadStatus,
    source: "live",
    createdLabel: formatShortDate(firstRun.createdAt),
    updatedLabel: deriveRuntimeThreadUpdatedLabel(threadStatus, focusedRun, latestRun, queuedRuns.length + optimisticFollowUps.length),
    tags: buildRuntimeThreadTags(threadStatus, latestRun, queuedRuns.length + optimisticFollowUps.length),
    attachments: attachmentCards,
    messages: buildRuntimeThreadMessages(orderedRuns, focusedRun, localFileEffectsByTaskId),
    progress: buildRuntimeThreadProgress(orderedRuns, optimisticFollowUps, localFileEffectsByTaskId),
    activity,
    liveRuntime: {
      threadId: firstRun.threadId,
      focusedRunId: focusedRun.id,
      latestRunId: latestRun.id,
      queuedRunIds: queuedRuns.map((run) => run.id),
      runIds: orderedRuns.map((run) => run.id),
      focusedRun: buildFocusedRunSummary(focusedRun),
      queuedFollowUps,
      completedRunCount: orderedRuns.filter((run) => run.status === "completed").length
    }
  };
}

function selectFocusedRun(runs: RuntimeTask[]) {
  return (
    runs.find((run) => run.status === "running") ??
    runs.find((run) => run.status === "pending") ??
    runs[runs.length - 1]
  );
}

function deriveThreadStatus(runs: RuntimeTask[]): WorkspaceThread["status"] {
  if (runs.some((run) => run.status === "running")) {
    return "running";
  }

  if (runs.some((run) => run.status === "pending")) {
    return "pending";
  }

  return runs[runs.length - 1]?.status ?? "ready";
}

function deriveRuntimeThreadSummary(
  status: WorkspaceThread["status"],
  focusedRun: RuntimeTask,
  latestRun: RuntimeTask,
  queuedFollowUpCount: number
) {
  if (status === "running") {
    return queuedFollowUpCount > 0
      ? `Working on the current prompt with ${queuedFollowUpCount} staged follow-up${queuedFollowUpCount === 1 ? "" : "s"} next.`
      : "Working through the latest prompt in the persistent runtime.";
  }

  if (status === "pending") {
    return queuedFollowUpCount > 1
      ? `${queuedFollowUpCount} prompts are queued in this thread.`
      : "Queued in the persistent runtime service.";
  }

  if (status === "failed") {
    return latestRun.error?.message ?? "Runtime failure.";
  }

  return (
    latestRun.result?.summary ??
    (focusedRun.result?.mode === "ai-sdk-openai"
      ? "Completed OpenAI execution."
      : "Completed placeholder execution.")
  );
}

function deriveRuntimeThreadUpdatedLabel(
  status: WorkspaceThread["status"],
  focusedRun: RuntimeTask,
  latestRun: RuntimeTask,
  queuedFollowUpCount: number
) {
  if (status === "running") {
    return queuedFollowUpCount > 0 ? `Thinking +${queuedFollowUpCount}` : "Thinking now";
  }

  if (status === "pending") {
    return queuedFollowUpCount > 1 ? `${queuedFollowUpCount} queued` : "Queued";
  }

  return formatDateTime(latestRun.completedAt ?? latestRun.createdAt);
}

function buildRuntimeThreadTags(
  status: WorkspaceThread["status"],
  latestRun: RuntimeTask,
  queuedFollowUpCount: number
) {
  const tags = [status, latestRun.simulateFailure ? "failure-path" : "live-run"];

  if (queuedFollowUpCount > 0) {
    tags.push(`queue-${queuedFollowUpCount}`);
  }

  return tags;
}

function buildRuntimeThreadMessages(
  runs: RuntimeTask[],
  focusedRun: RuntimeTask,
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];

  for (const [index, run] of runs.entries()) {
    const isFollowUp = index > 0;
    const isQueuedBehindFocused = run.status === "pending" && run.id !== focusedRun.id;

    if (isQueuedBehindFocused) {
      continue;
    }

    const queueLabel =
      run.id === focusedRun.id && (run.status === "running" || run.status === "pending")
        ? "You · active request"
        : isFollowUp
          ? "You · follow-up"
          : "Operator";

    messages.push(
      createMessage(
        `${run.id}-user`,
        "user",
        queueLabel,
        run.instruction,
        formatDateTime(run.createdAt),
        "default"
      )
    );

    messages.push(
      createMessage(
        `${run.id}-system`,
        "system",
        isQueuedBehindFocused ? "Steer queue" : "Runtime queue",
        deriveRuntimeSystemMessage(run, focusedRun),
        formatDateTime(run.startedAt ?? run.createdAt),
        deriveRuntimeSystemTone(run)
      )
    );

    if (run.result) {
      const visibleResponseText =
        stripLocalFilePlan(run.result.responseText ?? "") || run.result.summary;

      messages.push(
        createMessage(
          `${run.id}-assistant`,
          "assistant",
          "Runtime result",
          visibleResponseText,
          formatDateTime(run.result.completedAt),
          "success"
        )
      );
    }

    const localEffect = localFileEffectsByTaskId[run.id];

    if (localEffect) {
      messages.push(
        createMessage(
          `${run.id}-local-effect`,
          localEffect.status === "failed" ? "assistant" : "system",
          "Local workspace",
          formatLocalWorkspaceEffect(localEffect),
          formatDateTime(localEffect.timestamp),
          localEffect.status === "failed"
            ? "danger"
            : localEffect.status === "applied"
              ? "success"
              : "info"
        )
      );
    }

    if (run.error) {
      messages.push(
        createMessage(
          `${run.id}-error`,
          "assistant",
          "Failure",
          run.error.message,
          formatDateTime(run.completedAt ?? run.createdAt),
          "danger"
        )
      );
    }
  }

  return messages;
}

function deriveRuntimeSystemMessage(run: RuntimeTask, focusedRun: RuntimeTask) {
  if (run.status === "pending" && run.id !== focusedRun.id) {
    return "Staged behind the active run. It will execute next without interrupting the current reasoning.";
  }

  if (run.status === "running") {
    return "This prompt is currently executing inside the persistent runtime.";
  }

  if (run.status === "pending") {
    return "Run accepted into the persistent loop and awaiting execution.";
  }

  if (run.status === "failed") {
    return "Run failed inside the runtime execution path.";
  }

  return run.result?.mode === "ai-sdk-openai"
    ? "Run completed through the OpenAI executor."
    : "Run completed inside the persistent runtime skeleton.";
}

function deriveRuntimeSystemTone(run: RuntimeTask): ThreadMessage["tone"] {
  if (run.status === "failed") {
    return "danger";
  }

  if (run.status === "completed") {
    return "success";
  }

  return "info";
}

function buildRuntimeThreadProgress(
  runs: RuntimeTask[],
  optimisticFollowUps: RuntimeQueuedFollowUpDraft[],
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>
): WorkspaceThread["progress"] {
  const progress: WorkspaceThread["progress"] = [];

  for (const [index, run] of runs.entries()) {
    const isFollowUp = index > 0;

    progress.push(
      createProgress(
        `${run.id}-created`,
        isFollowUp ? "Follow-up submitted" : "Task submitted",
        isFollowUp
          ? "Queued on the same thread without interrupting the active run."
          : run.title
            ? `Title: ${run.title}`
            : "Task entered through the workspace composer.",
        formatDateTime(run.createdAt),
        "info"
      )
    );

    if (run.startedAt) {
      progress.push(
        createProgress(
          `${run.id}-started`,
          "Runtime started",
          "Persistent runtime worker began processing the prompt.",
          formatDateTime(run.startedAt),
          "default"
        )
      );
    }

    if (run.completedAt && run.status === "completed") {
      progress.push(
        createProgress(
          `${run.id}-completed`,
          "Run completed",
          run.result?.summary ??
            (run.result?.mode === "ai-sdk-openai"
              ? "OpenAI execution completed successfully."
              : "Placeholder execution completed successfully."),
          formatDateTime(run.completedAt),
          "success"
        )
      );
    }

    const localEffect = localFileEffectsByTaskId[run.id];

    if (localEffect) {
      progress.push(
        createProgress(
          `${run.id}-local-effect`,
          localEffect.status === "applying"
            ? "Applying locally"
            : localEffect.status === "applied"
              ? "Applied locally"
              : "Local apply failed",
          localEffect.error ?? localEffect.summary,
          formatDateTime(localEffect.timestamp),
          localEffect.status === "failed"
            ? "danger"
            : localEffect.status === "applied"
              ? "success"
              : "default"
        )
      );
    }

    if (run.completedAt && run.status === "failed") {
      progress.push(
        createProgress(
          `${run.id}-failed`,
          "Run failed",
          run.error?.message ?? "Unknown runtime error.",
          formatDateTime(run.completedAt),
          "danger"
        )
      );
    }
  }

  for (const followUp of optimisticFollowUps) {
    progress.push(
      createProgress(
        `${followUp.id}-staged`,
        "Follow-up staged",
        "Queued behind the active run and sending to the runtime service.",
        formatDateTime(followUp.createdAt),
        "info"
      )
    );
  }

  return progress;
}

function formatLocalWorkspaceEffect(effect: LocalFileExecutionEffect) {
  if (effect.status === "applying") {
    return effect.summary;
  }

  const detailLines = effect.details.slice(0, 8).map((detail) => `- ${detail}`);

  if (detailLines.length === 0) {
    return effect.error ?? effect.summary;
  }

  return `${effect.summary}\n\n${detailLines.join("\n")}`;
}

function buildQueuedFollowUpItems(
  queuedRuns: RuntimeTask[],
  optimisticFollowUps: RuntimeQueuedFollowUpDraft[]
) {
  return [
    ...queuedRuns.map((run) => ({
      id: run.id,
      instruction: summarizePrompt(run.instruction),
      createdAt: formatDateTime(run.createdAt),
      state: "queued" as const,
      attachmentsCount: run.attachments.length,
      parentRunId: run.parentRunId
    })),
    ...optimisticFollowUps.map((followUp) => ({
      id: followUp.id,
      instruction: summarizePrompt(followUp.instruction),
      createdAt: formatDateTime(followUp.createdAt),
      state: "sending" as const,
      attachmentsCount: followUp.attachments.length,
      parentRunId: null
    }))
  ];
}

function buildFocusedRunSummary(run: RuntimeTask) {
  return {
    id: run.id,
    instruction: run.instruction,
    status: run.status,
    createdAt: formatDateTime(run.createdAt),
    startedAt: run.startedAt ? formatDateTime(run.startedAt) : null,
    attachmentsCount: run.attachments.length
  };
}

function summarizePrompt(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= 140) {
    return compact;
  }

  return `${compact.slice(0, 137).trimEnd()}...`;
}

function toLocalAttachmentCard(attachment: ComposerAttachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.type,
    kind: attachment.kind,
    summary: attachment.summary,
    excerpt: attachment.excerpt,
    previewUrl: attachment.previewUrl,
    source: "local" as const
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

function buildRuntimeActivity(task: RuntimeTask, trace: RuntimeTraceRunLog | null) {
  if (trace && trace.spans.length > 0) {
    return condenseActivityItems(flattenTrace(trace));
  }

  const events = task.events ?? [];

  if (events.length > 0) {
    return events.map((event, index) => ({
      id: `${task.id}-event-${index}`,
      kind: "event" as const,
      badge: deriveEventBadge(event.type),
      label: deriveEventLabel(event.type),
      detail: event.message,
      timestamp: formatDateTime(event.at),
      tone: deriveEventTone(event.type),
      depth: 0,
      surface: "secondary" as const,
      sourceType: "summary" as const,
      sourceName: event.type,
      meta: [event.toolName, event.path].filter(Boolean) as string[]
    }));
  }

  if (task.rollingSummary?.text) {
    const summaryTone: AgentActivityItem["tone"] =
      task.rollingSummary.source === "failure"
        ? "danger"
        : task.rollingSummary.source === "retry"
          ? "warning"
          : "info";

    return [
      {
        id: `${task.id}-summary`,
        kind: "summary" as const,
        badge: "Summary",
        label: "Latest runtime summary",
        detail: task.rollingSummary.text,
        timestamp: formatDateTime(task.rollingSummary.updatedAt),
        tone: summaryTone,
        depth: 0,
        surface: "primary" as const,
        sourceType: "summary" as const,
        sourceName: task.rollingSummary.source,
        meta: [humanizeKey(task.rollingSummary.source)]
      }
    ];
  }

  return [];
}

function flattenTrace(trace: RuntimeTraceRunLog) {
  const spans = [...trace.spans].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const byParent = new Map<string | null, RuntimeTraceSpan[]>();

  for (const span of spans) {
    const key = span.parentId ?? null;
    const existing = byParent.get(key) ?? [];
    existing.push(span);
    byParent.set(key, existing);
  }

  for (const children of byParent.values()) {
    children.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  const rootSpans = trace.rootSpanId
    ? spans.filter((span) => span.id === trace.rootSpanId)
    : byParent.get(null) ?? [];
  const activity: AgentActivityItem[] = [];

  for (const root of rootSpans) {
    visitTraceSpan(root, 0, byParent, activity);
  }

  return activity;
}

function visitTraceSpan(
  span: RuntimeTraceSpan,
  depth: number,
  byParent: Map<string | null, RuntimeTraceSpan[]>,
  activity: AgentActivityItem[]
) {
  activity.push({
    id: span.id,
    kind: "span",
    badge: deriveSpanBadge(span),
    label: deriveSpanLabel(span),
    detail: deriveSpanDetail(span),
    timestamp: formatDateTime(span.startedAt),
    tone: deriveSpanTone(span),
    depth,
    surface: deriveSpanSurface(span),
    status: span.status,
    sourceType: span.spanType,
    sourceName: span.name,
    meta: buildSpanMeta(span)
  });

  const events = [...span.events].sort((left, right) => left.at.localeCompare(right.at));

  for (const event of events) {
    activity.push({
      id: event.id,
      kind: "event",
      badge: deriveEventBadge(event.name),
      label: deriveEventLabel(event.name),
      detail: event.message?.trim() || "Runtime event recorded.",
      timestamp: formatDateTime(event.at),
      tone: deriveEventTone(event.name),
      depth: depth + 1,
      surface: "secondary",
      sourceType: span.spanType,
      sourceName: event.name,
      meta: buildEventMeta(event)
    });
  }

  for (const child of byParent.get(span.id) ?? []) {
    visitTraceSpan(child, depth + 1, byParent, activity);
  }
}

function deriveSpanBadge(span: RuntimeTraceSpan) {
  switch (span.spanType) {
    case "role":
      return capitalize(readString(span.metadata.role) ?? "Role");
    case "coordinator":
      return "Coordinator";
    case "handoff":
      return "Handoff";
    case "merge":
      return "Merge";
    case "context":
      return "Context";
    case "tool":
      return "Tool";
    case "model":
      return "Model";
    case "validation":
      return "Validation";
    case "retry":
      return "Retry";
    case "rollback":
      return "Rollback";
    case "phase":
      return "Phase";
    case "story":
      return "Story";
    case "task":
      return "Task";
    case "run":
      return "Run";
  }
}

function deriveSpanLabel(span: RuntimeTraceSpan) {
  switch (span.spanType) {
    case "role":
      return deriveRoleLabel(readString(span.metadata.role) ?? parseRoleFromSpanName(span.name));
    case "coordinator":
      return "Coordinator decision";
    case "handoff":
      return "Created role handoff";
    case "merge":
      return "Merged role result";
    case "context":
      return `Built ${readString(span.metadata.role) ?? "runtime"} context`;
    case "tool":
      return `Used ${readString(span.metadata.toolName) ?? trimTracePrefix(span.name)}`;
    case "model":
      return `Used ${readString(span.metadata.modelId) ?? trimTracePrefix(span.name)}`;
    case "phase":
    case "story":
    case "task":
      return span.name;
    case "validation":
      return "Validate execution";
    case "retry":
      return "Retry execution";
    case "rollback":
      return "Rollback change";
    case "run":
      return "Run lifecycle";
  }
}

function deriveSpanDetail(span: RuntimeTraceSpan) {
  if (span.error?.trim()) {
    return span.error.trim();
  }

  if (span.spanType === "role") {
    return deriveRoleDetail(span);
  }

  if (span.spanType === "coordinator") {
    return span.outputSummary?.trim() || "Recorded the next runtime branch decision.";
  }

  if (span.spanType === "handoff") {
    return span.outputSummary?.trim() || "Passed a bounded payload to the next role.";
  }

  if (span.spanType === "merge") {
    return span.outputSummary?.trim() || "Merged the latest role result into canonical runtime state.";
  }

  if (span.spanType === "model") {
    return "Generated the response draft for the active step.";
  }

  if (span.spanType === "context") {
    return "Included objective, constraints, current state, and supporting evidence for this role.";
  }

  if (span.spanType === "run") {
    return "Tracked the run from intake through completion.";
  }

  if (span.outputSummary?.trim()) {
    return span.outputSummary.trim();
  }

  if (span.inputSummary?.trim()) {
    return span.inputSummary.trim();
  }

  return "Runtime span recorded.";
}

function deriveSpanTone(span: RuntimeTraceSpan): AgentActivityItem["tone"] {
  if (span.status === "failed") {
    return "danger";
  }

  if (span.status === "running") {
    return "info";
  }

  if (
    span.spanType === "tool" ||
    span.spanType === "model" ||
    span.spanType === "validation" ||
    span.spanType === "merge"
  ) {
    return "success";
  }

  if (span.spanType === "coordinator" || span.spanType === "handoff" || span.spanType === "context") {
    return "info";
  }

  return "default";
}

function deriveSpanSurface(span: RuntimeTraceSpan): AgentActivityItem["surface"] {
  return span.spanType === "role" || span.spanType === "coordinator" ? "primary" : "secondary";
}

function deriveEventBadge(eventName: string) {
  if (eventName.includes("validation")) {
    return "Validation";
  }

  if (eventName.includes("retry")) {
    return "Retry";
  }

  if (eventName.includes("planner")) {
    return "Planner";
  }

  if (eventName.includes("executor")) {
    return "Executor";
  }

  if (eventName.includes("verifier")) {
    return "Verifier";
  }

  if (eventName.includes("handoff")) {
    return "Handoff";
  }

  if (eventName.includes("merge")) {
    return "State";
  }

  if (eventName.includes("coordinator")) {
    return "Coordinator";
  }

  if (eventName.includes("task")) {
    return "Task";
  }

  if (eventName.includes("story")) {
    return "Story";
  }

  if (eventName.includes("phase")) {
    return "Phase";
  }

  return "Event";
}

function deriveEventLabel(eventName: string) {
  switch (eventName) {
    case "coordination_conflict_detected":
      return "Coordination conflict";
    case "validation_gate_failed":
      return "Validation gate failed";
    case "validation_gate_passed":
      return "Validation gate passed";
    case "task_started":
      return "Started task";
    case "task_completed":
      return "Completed task";
    case "task_failed":
      return "Task needs another pass";
    case "story_started":
      return "Started story";
    case "story_completed":
      return "Completed story";
    case "story_failed":
      return "Story needs another pass";
    case "phase_started":
      return "Started phase";
    case "phase_completed":
      return "Completed phase";
    case "phase_failed":
      return "Phase failed";
    case "retry_scheduled":
      return "Retry scheduled";
    case "handoff_created":
      return "Role handoff";
    case "state_merged":
      return "State updated";
    case "state_merge_failed":
      return "State update failed";
    case "coordinator_decision":
      return "Coordinator decision";
    case "model_unavailable":
      return "Model unavailable";
    default:
      return humanizeKey(eventName);
  }
}

function deriveEventTone(eventName: string): AgentActivityItem["tone"] {
  if (eventName.includes("conflict")) {
    return "warning";
  }

  if (eventName.includes("failed") || eventName.includes("error")) {
    return "danger";
  }

  if (eventName.includes("passed") || eventName.includes("succeeded") || eventName.includes("completed")) {
    return "success";
  }

  if (eventName.includes("retry")) {
    return "warning";
  }

  if (eventName.includes("started") || eventName.includes("proposed") || eventName.includes("made")) {
    return "info";
  }

  return "default";
}

function buildSpanMeta(span: RuntimeTraceSpan) {
  const meta: string[] = [];
  const path = readString(span.metadata.path);
  const modelId = readString(span.metadata.modelId);
  const toolName = readString(span.metadata.toolName);
  const validationStatus = readString(span.metadata.validationStatus);
  const sectionIds = readStringArray(span.metadata.sectionIds);
  const changedFiles = readStringArray(span.metadata.changedFiles);
  const inputTokens = readNumber(span.metadata.inputTokens);
  const outputTokens = readNumber(span.metadata.outputTokens);
  const totalTokens = readNumber(span.metadata.totalTokens);

  if (toolName && span.spanType !== "tool") {
    meta.push(toolName);
  }

  if (path) {
    meta.push(path);
  }

  if (modelId && span.spanType !== "model") {
    meta.push(modelId);
  }

  if (changedFiles.length > 0) {
    meta.push(
      changedFiles.length === 1 ? changedFiles[0] : `${changedFiles.length} changed files`
    );
  }

  if (sectionIds.length > 0 && span.spanType === "context") {
    meta.push(`${sectionIds.length} sections`);
  }

  if (validationStatus) {
    meta.push(`validation ${validationStatus}`);
  }

  if (typeof inputTokens === "number" || typeof outputTokens === "number" || typeof totalTokens === "number") {
    meta.push(
      `${inputTokens ?? 0}/${outputTokens ?? 0}/${totalTokens ?? 0} tokens`
    );
  }

  if (typeof span.durationMs === "number") {
    meta.push(`${span.durationMs} ms`);
  }

  return meta;
}

function buildEventMeta(event: RuntimeTraceSpanEvent) {
  const meta: string[] = [];
  const path = readString(event.metadata?.path);
  const toolName = readString(event.metadata?.toolName);
  const gateId = readString(event.metadata?.gateId);

  if (toolName) {
    meta.push(toolName);
  }

  if (path) {
    meta.push(path);
  }

  if (gateId) {
    meta.push(gateId);
  }

  return meta;
}

function condenseActivityItems(items: AgentActivityItem[]) {
  const filtered = items.filter((item, index) => shouldKeepActivityItem(item, items, index));
  const condensed: AgentActivityItem[] = [];

  for (const item of filtered) {
    const previous = condensed[condensed.length - 1];

    if (previous && areDuplicateActivityItems(previous, item)) {
      continue;
    }

    condensed.push(item);
  }

  return condensed;
}

function shouldKeepActivityItem(
  item: AgentActivityItem,
  items: AgentActivityItem[],
  index: number
) {
  if (item.sourceType === "run") {
    return false;
  }

  if (
    item.kind === "event" &&
    [
      "agent_result_received",
      "planner_step_proposed",
      "executor_step_completed",
      "verifier_decision_made",
      "tool_succeeded",
      "tool_failed"
    ].includes(item.sourceName ?? "")
  ) {
    return false;
  }

  if (
    item.sourceType === "model" &&
    items.some(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.sourceType === "role" &&
        candidate.sourceName?.startsWith("executor:") &&
        normalizeActivityText(candidate.timestamp) === normalizeActivityText(item.timestamp)
    )
  ) {
    return true;
  }

  return true;
}

function areDuplicateActivityItems(left: AgentActivityItem, right: AgentActivityItem) {
  return (
    normalizeActivityText(left.label) === normalizeActivityText(right.label) &&
    normalizeActivityText(left.detail) === normalizeActivityText(right.detail) &&
    normalizeActivityText(left.timestamp) === normalizeActivityText(right.timestamp)
  );
}

function normalizeActivityText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function deriveRoleLabel(role: string) {
  switch (role) {
    case "planner":
      return "Selected next step";
    case "executor":
      return "Executed planned step";
    case "verifier":
      return "Reviewed execution";
    default:
      return `${capitalize(role)} step`;
  }
}

function deriveRoleDetail(span: RuntimeTraceSpan) {
  const role = readString(span.metadata.role) ?? parseRoleFromSpanName(span.name);
  const toolName = readString(span.metadata.toolName);

  switch (role) {
    case "planner":
      return toolName
        ? `Bounded the next move to a scoped ${toolName} action.`
        : "Bounded the next move to the current request without expanding scope.";
    case "executor":
      return toolName
        ? `Executed the planned ${toolName} step and kept the change on the intended target.`
        : "Executed the planned step and captured the current result.";
    case "verifier":
      return "Checked intent match, target scope, validation state, and progression safety.";
    default:
      return span.outputSummary?.trim() || span.inputSummary?.trim() || "Runtime role step recorded.";
  }
}

function parseRoleFromSpanName(name: string) {
  const [role] = name.split(":", 1);
  return role || name;
}

function deriveThreadTitle(instruction: string) {
  const trimmed = instruction.trim();

  if (!trimmed) {
    return "New thread";
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? trimmed;
  const normalized = firstLine.replace(/\s+/g, " ").trim();

  if (normalized.length <= 46) {
    return normalized;
  }

  return `${normalized.slice(0, 43).trimEnd()}...`;
}

function trimTracePrefix(name: string) {
  const parts = name.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : name;
}

function humanizeKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}
