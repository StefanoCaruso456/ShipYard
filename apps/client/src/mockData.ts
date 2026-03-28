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
  RuntimeTerminalCommandEntry,
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
  const hasActiveRuntimeStage =
    threadStatus === "running" || threadStatus === "pending" || threadStatus === "paused";
  const activity = hasActiveRuntimeStage
    ? buildThreadActivity(focusedRun, runtimeTracesByTaskId, localFileEffectsByTaskId)
    : [];
  const queuedFollowUps = buildQueuedFollowUpItems(queuedRuns, optimisticFollowUps);

  return {
    id: firstRun.threadId,
    title: firstRun.title?.trim() || deriveThreadTitle(firstRun.instruction),
    summary: deriveRuntimeThreadSummary(threadStatus, focusedRun, latestRun, queuedRuns.length + optimisticFollowUps.length),
    requestedOperatingMode: latestRun.requestedOperatingMode ?? null,
    operatingMode: latestRun.operatingMode ?? null,
    status: threadStatus,
    source: "live",
    createdLabel: formatShortDate(firstRun.createdAt),
    updatedLabel: deriveRuntimeThreadUpdatedLabel(threadStatus, focusedRun, latestRun, queuedRuns.length + optimisticFollowUps.length),
    tags: buildRuntimeThreadTags(threadStatus, latestRun, queuedRuns.length + optimisticFollowUps.length),
    attachments: [],
    messages: buildRuntimeThreadMessages(
      orderedRuns,
      focusedRun,
      runtimeAttachmentPreviewsByTaskId,
      runtimeTracesByTaskId,
      localFileEffectsByTaskId,
      hasActiveRuntimeStage
    ),
    progress: buildRuntimeThreadProgress(orderedRuns, optimisticFollowUps, localFileEffectsByTaskId),
    activity,
    liveRuntime: {
      threadId: firstRun.threadId,
      focusedRunId: focusedRun.id,
      latestRunId: latestRun.id,
      queuedRunIds: queuedRuns.map((run) => run.id),
      runIds: orderedRuns.map((run) => run.id),
      focusedRun: buildFocusedRunSummary(focusedRun, runtimeAttachmentPreviewsByTaskId),
      operatorView: focusedRun.operatorView ?? null,
      terminal: buildRuntimeTerminalEntries(orderedRuns, runtimeTracesByTaskId),
      queuedFollowUps,
      completedRunCount: orderedRuns.filter((run) => run.status === "completed").length
    }
  };
}

function selectFocusedRun(runs: RuntimeTask[]) {
  return (
    runs.find((run) => run.status === "running") ??
    runs.find((run) => run.status === "paused") ??
    runs.find((run) => run.status === "pending") ??
    runs[runs.length - 1]
  );
}

function deriveThreadStatus(runs: RuntimeTask[]): WorkspaceThread["status"] {
  if (runs.some((run) => run.status === "running")) {
    return "running";
  }

  if (runs.some((run) => run.status === "paused")) {
    return "paused";
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

  if (status === "paused") {
    return focusedRun.operatorView?.approval?.activeGate
      ? `${focusedRun.operatorView.approval.activeGate.title} is waiting before ${focusedRun.operatorView.approval.activeGate.phaseName} can continue.`
      : "Paused in the persistent runtime until an approval decision is recorded.";
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

  if (status === "paused") {
    return "Approval needed";
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
  runtimeAttachmentPreviewsByTaskId: Record<string, ComposerAttachment[]>,
  runtimeTracesByTaskId: Record<string, RuntimeTraceRunLog>,
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>,
  hasActiveRuntimeStage: boolean
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];

  for (const [index, run] of runs.entries()) {
    const isFollowUp = index > 0;
    const isQueuedBehindFocused = run.status === "pending" && run.id !== focusedRun.id;

    if (isQueuedBehindFocused) {
      continue;
    }

    const queueLabel =
      run.id === focusedRun.id &&
      (run.status === "running" || run.status === "pending" || run.status === "paused")
        ? "You · active request"
        : isFollowUp
          ? "You · follow-up"
          : "Operator";
    const runActivity = buildRuntimeActivity(
      run,
      runtimeTracesByTaskId[run.id] ?? null,
      localFileEffectsByTaskId[run.id] ?? null
    );
    const trace =
      runActivity.length > 0 && (!hasActiveRuntimeStage || run.id !== focusedRun.id)
        ? {
            runId: run.id,
            status: run.status,
            items: runActivity
          }
        : undefined;
    let traceAttached = false;

    messages.push(
      createMessage(
        `${run.id}-user`,
        "user",
        queueLabel,
        run.instruction,
        formatDateTime(run.createdAt),
        "default",
        run.id === focusedRun.id &&
          (focusedRun.status === "running" || focusedRun.status === "pending" || focusedRun.status === "paused")
          ? []
          : run.attachments.map((attachment) =>
              toAttachmentCard(attachment, buildAttachmentPreviewLookup(runtimeAttachmentPreviewsByTaskId[run.id]))
            )
      )
    );

    messages.push(
      createMessage(
        `${run.id}-system`,
        "system",
        isQueuedBehindFocused ? "Steer queue" : "Runtime queue",
        deriveRuntimeSystemMessage(run, focusedRun),
        formatDateTime(run.startedAt ?? run.createdAt),
        deriveRuntimeSystemTone(run),
        [],
        !run.result && !run.error ? trace : undefined
      )
    );

    if (!run.result && !run.error && trace) {
      traceAttached = true;
    }

    if (run.result) {
      const visibleResponseText =
        stripLocalFilePlan(run.result.responseText ?? "") || run.result.summary;

      if (visibleResponseText.trim().length > 0) {
        messages.push(
          createMessage(
            `${run.id}-assistant`,
            "assistant",
            "Assistant",
            visibleResponseText,
            formatDateTime(run.result.completedAt),
            "default",
            [],
            trace,
            trace ? "before" : "after"
          )
        );
        traceAttached = Boolean(trace);
      }
    }

    if (run.error) {
      messages.push(
        createMessage(
          `${run.id}-error`,
          "assistant",
          "Failure",
          run.error.message,
          formatDateTime(run.completedAt ?? run.createdAt),
          "danger",
          [],
          trace,
          trace ? "before" : "after"
        )
      );
      traceAttached = Boolean(trace);
    }

    if (!traceAttached && trace) {
      const lastMessage = messages[messages.length - 1];

      if (lastMessage) {
        lastMessage.trace = trace;
      }
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

  if (run.status === "paused") {
    return "Run paused and waiting for an approval decision before the next phase starts.";
  }

  if (run.status === "failed") {
    return "Run failed inside the runtime execution path.";
  }

  if (run.result?.mode === "repo-tool" && isTerminalToolResult(run.result.toolResult)) {
    return "Run completed through the terminal execution lane.";
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

    if (run.status === "paused") {
      progress.push(
        createProgress(
          `${run.id}-paused`,
          "Approval required",
          run.operatorView?.approval?.activeGate?.instructions ??
            run.operatorView?.approval?.activeGate?.title ??
            run.rollingSummary?.text ??
            "The run is waiting for a human approval decision.",
          formatDateTime(run.rollingSummary?.updatedAt ?? run.startedAt ?? run.createdAt),
          "warning"
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

function buildFocusedRunSummary(
  run: RuntimeTask,
  runtimeAttachmentPreviewsByTaskId: Record<string, ComposerAttachment[]>
) {
  return {
    id: run.id,
    instruction: run.instruction,
    requestedOperatingMode: run.requestedOperatingMode ?? null,
    operatingMode: run.operatingMode ?? null,
    status: run.status,
    createdAt: formatDateTime(run.createdAt),
    startedAt: run.startedAt ? formatDateTime(run.startedAt) : null,
    attachmentsCount: run.attachments.length,
    factory: run.factory
      ? {
          appName: run.factory.appName,
          stackLabel: run.factory.stack.label,
          repositoryName: run.factory.repository.name,
          deploymentProvider: run.factory.deployment.provider,
          currentStage: run.factory.currentStage,
          workspacePath: run.factory.repository.localPath
        }
      : null,
    attachments: run.attachments.map((attachment) =>
      toAttachmentCard(attachment, buildAttachmentPreviewLookup(runtimeAttachmentPreviewsByTaskId[run.id]))
    )
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
  tone: ThreadMessage["tone"],
  attachments: ThreadMessage["attachments"] = [],
  trace?: ThreadMessage["trace"],
  tracePlacement: ThreadMessage["tracePlacement"] = "after"
): ThreadMessage {
  return {
    id,
    role,
    label,
    body,
    timestamp,
    tone,
    attachments,
    trace,
    tracePlacement
  };
}

function buildAttachmentPreviewLookup(previews: ComposerAttachment[] | undefined) {
  return Object.fromEntries((previews ?? []).map((preview) => [preview.name, preview]));
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

function buildRuntimeActivity(
  task: RuntimeTask,
  trace: RuntimeTraceRunLog | null,
  localEffect: LocalFileExecutionEffect | null = null
) {
  let activity: AgentActivityItem[] = [];

  if (trace && trace.spans.length > 0) {
    activity = flattenTrace(trace);
  } else {
    const events = task.events ?? [];

    if (events.length > 0) {
      activity = events.map((event, index) => ({
        id: `${task.id}-event-${index}`,
        kind: "event" as const,
        badge: deriveEventBadge({ id: `${task.id}-event-${index}`, at: event.at, name: event.type }),
        label: deriveEventLabel({ id: `${task.id}-event-${index}`, at: event.at, name: event.type }),
        detail: event.message,
        timestamp: formatDateTime(event.at),
        tone: deriveEventTone({ id: `${task.id}-event-${index}`, at: event.at, name: event.type }),
        depth: 0,
        surface: "secondary" as const,
        sourceType: "summary" as const,
        sourceName: event.type,
        meta: [event.toolName, event.path].filter(Boolean) as string[]
      }));
    } else if (task.rollingSummary?.text) {
      const summaryTone: AgentActivityItem["tone"] =
        task.rollingSummary.source === "failure"
          ? "danger"
          : task.rollingSummary.source === "retry"
            ? "warning"
            : "info";

      activity = [
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
  }

  const runOverview = buildRunOverviewItem(task, trace);

  if (runOverview) {
    activity = [runOverview, ...activity];
  }

  const localWorkspaceItem = buildLocalWorkspaceActivityItem(localEffect);

  if (localWorkspaceItem) {
    activity = [...activity, localWorkspaceItem];
  }

  return condenseActivityItems(activity);
}

function buildThreadActivity(
  focusedRun: RuntimeTask,
  runtimeTracesByTaskId: Record<string, RuntimeTraceRunLog>,
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>
) {
  return buildRuntimeActivity(
    focusedRun,
    runtimeTracesByTaskId[focusedRun.id] ?? null,
    localFileEffectsByTaskId[focusedRun.id] ?? null
  );
}

function buildRuntimeTerminalEntries(
  runs: RuntimeTask[],
  runtimeTracesByTaskId: Record<string, RuntimeTraceRunLog>
) {
  const entries: RuntimeTerminalCommandEntry[] = [];

  for (const run of runs) {
    const trace = runtimeTracesByTaskId[run.id] ?? null;

    if (!trace) {
      continue;
    }

    const spans = [...trace.spans].sort((left, right) => left.startedAt.localeCompare(right.startedAt));

    for (const span of spans) {
      const toolName = readString(span.metadata.toolName) ?? trimTracePrefix(span.name);

      if (toolName !== "run_terminal_command") {
        continue;
      }

      const stdout = readString(span.metadata.stdout) ?? "";
      const stderr = readString(span.metadata.stderr) ?? "";
      const combinedOutput =
        readString(span.metadata.combinedOutput) ?? buildCombinedTerminalOutput(stdout, stderr);
      const truncatedMetadata = readObject(span.metadata.truncated);

      entries.push({
        id: span.id,
        runId: run.id,
        label: buildTerminalEntryLabel(
          readString(span.metadata.toolCategory) ?? "shell",
          readString(span.metadata.commandLine) ?? trimTracePrefix(span.name)
        ),
        commandLine: readString(span.metadata.commandLine) ?? trimTracePrefix(span.name),
        command: readString(span.metadata.command) ?? "",
        args: readStringArray(span.metadata.args),
        category: normalizeTerminalCategory(readString(span.metadata.toolCategory)),
        cwd: readString(span.metadata.cwd) ?? ".",
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        status: span.status,
        exitCode: readNumber(span.metadata.exitCode),
        durationMs: span.durationMs,
        stdout,
        stderr,
        combinedOutput,
        truncated: {
          stdout: readBoolean(truncatedMetadata?.stdout) ?? false,
          stderr: readBoolean(truncatedMetadata?.stderr) ?? false,
          combined: readBoolean(truncatedMetadata?.combined) ?? false
        }
      });
    }
  }

  return entries.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function buildRunOverviewItem(task: RuntimeTask, trace: RuntimeTraceRunLog | null): AgentActivityItem | null {
  const traceSummary = trace?.summary ?? null;
  const timestamp = formatDateTime(task.completedAt ?? task.startedAt ?? task.createdAt);
  const meta: string[] = [];
  const resolvedOperatingMode = traceSummary?.operatingMode ?? task.operatingMode ?? null;
  const requestedOperatingMode = traceSummary?.requestedOperatingMode ?? task.requestedOperatingMode ?? null;

  if (resolvedOperatingMode) {
    meta.push(`${capitalize(resolvedOperatingMode)} mode`);
  } else if (requestedOperatingMode) {
    meta.push(`${capitalize(requestedOperatingMode)} requested`);
  }

  if (traceSummary?.model.modelId) {
    meta.push(traceSummary.model.modelId);
  } else if (task.result?.modelId) {
    meta.push(task.result.modelId);
  }

  if (typeof traceSummary?.usage.totalTokens === "number") {
    meta.push(`${traceSummary.usage.totalTokens} tokens`);
  }

  if (task.factory) {
    meta.push(task.factory.stack.label);
    meta.push(`Factory ${task.factory.currentStage}`);
  }

  if (traceSummary?.validation.status) {
    if (traceSummary.validation.status !== "not_run") {
      meta.push(`validation ${traceSummary.validation.status}`);
    }
  }

  if (traceSummary?.tools.count) {
    meta.push(
      `${traceSummary.tools.count} tool${traceSummary.tools.count === 1 ? "" : "s"}`
    );
  }

  if (traceSummary?.files.changedCount) {
    meta.push(
      `${traceSummary.files.changedCount} file${traceSummary.files.changedCount === 1 ? "" : "s"} changed`
    );
  } else if (traceSummary?.files.selectedCount) {
    meta.push(
      `${traceSummary.files.selectedCount} file${traceSummary.files.selectedCount === 1 ? "" : "s"} referenced`
    );
  }

  if (traceSummary?.retries.count) {
    meta.push(
      `${traceSummary.retries.count} retr${traceSummary.retries.count === 1 ? "y" : "ies"}`
    );
  }

  if (traceSummary?.orchestration?.nextAction) {
    meta.push(`next ${humanizeOrchestrationAction(traceSummary.orchestration.nextAction)}`);
  }

  if (
    traceSummary?.orchestration?.stepRetryCount != null &&
    traceSummary.orchestration.maxStepRetries != null
  ) {
    meta.push(
      `step retry ${traceSummary.orchestration.stepRetryCount}/${traceSummary.orchestration.maxStepRetries}`
    );
  }

  if (
    traceSummary?.orchestration?.replanCount != null &&
    traceSummary.orchestration.maxReplans != null
  ) {
    meta.push(
      `replan ${traceSummary.orchestration.replanCount}/${traceSummary.orchestration.maxReplans}`
    );
  }

  if (
    traceSummary?.phaseExecution?.totalTasks != null &&
    traceSummary.phaseExecution.completedTasks != null
  ) {
    meta.push(
      `${traceSummary.phaseExecution.completedTasks}/${traceSummary.phaseExecution.totalTasks} tasks complete`
    );
  }

  if (traceSummary?.controlPlane?.artifactCount) {
    meta.push(
      `${traceSummary.controlPlane.artifactCount} artifact${
        traceSummary.controlPlane.artifactCount === 1 ? "" : "s"
      }`
    );
  }

  if (traceSummary?.controlPlane?.handoffCount) {
    meta.push(
      `${traceSummary.controlPlane.handoffCount} handoff${
        traceSummary.controlPlane.handoffCount === 1 ? "" : "s"
      }`
    );
  }

  if (traceSummary?.controlPlane?.openConflictCount) {
    meta.push(
      `${traceSummary.controlPlane.openConflictCount} open conflict${
        traceSummary.controlPlane.openConflictCount === 1 ? "" : "s"
      }`
    );
  }

  if (traceSummary?.controlPlane?.mergeDecisionCount) {
    meta.push(
      `${traceSummary.controlPlane.mergeDecisionCount} merge decision${
        traceSummary.controlPlane.mergeDecisionCount === 1 ? "" : "s"
      }`
    );
  }

  return {
    id: `${task.id}-run-overview`,
    kind: "summary",
    badge: "Run",
    label:
      task.status === "running"
        ? "Run in progress"
        : task.status === "pending"
          ? "Run queued"
          : task.status === "paused"
            ? "Run paused for approval"
          : task.status === "failed"
            ? "Run failed"
            : "Run completed",
    detail:
      task.status === "running"
        ? "The runtime is still reasoning through the active request."
        : task.status === "pending"
          ? "The request is accepted and waiting in the persistent runtime queue."
          : task.status === "paused"
            ? task.operatorView?.approval?.activeGate?.instructions ??
              task.rollingSummary?.text ??
              "The run is paused until an approval decision is recorded."
          : task.status === "failed"
            ? task.error?.message ?? "The runtime ended in a failure state."
            : task.result?.summary || "The latest request completed and the execution trace is available below.",
    timestamp,
    tone:
      task.status === "failed"
        ? "danger"
        : task.status === "completed"
          ? "success"
          : task.status === "paused"
            ? "warning"
          : "info",
    depth: 0,
    surface: "primary",
    status: traceSummary?.status ?? undefined,
    sourceType: "summary",
    sourceName: "run-overview",
    meta
  };
}

function buildLocalWorkspaceActivityItem(
  effect: LocalFileExecutionEffect | null
): AgentActivityItem | null {
  if (!effect) {
    return null;
  }

  const fileMeta =
    effect.files.length === 0
      ? []
      : effect.files.length === 1
        ? effect.files
        : [`${effect.files.length} files`, ...effect.files.slice(0, 2)];

  return {
    id: `${effect.taskId}-local-workspace`,
    kind: "summary",
    badge: "Workspace",
    label:
      effect.status === "applying"
        ? "Applying local file plan"
        : effect.status === "applied"
          ? "Applied to local workspace"
          : "Local workspace apply failed",
    detail: effect.error ?? effect.summary,
    timestamp: formatDateTime(effect.timestamp),
    tone:
      effect.status === "failed"
        ? "danger"
        : effect.status === "applied"
          ? "success"
          : "info",
    depth: 0,
    surface: "secondary",
    sourceType: "summary",
    sourceName: "local-workspace",
    meta: fileMeta
  };
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
      badge: deriveEventBadge(event),
      label: deriveEventLabel(event),
      detail: deriveEventDetail(event),
      timestamp: formatDateTime(event.at),
      tone: deriveEventTone(event),
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
    case "sync":
      return "Sync";
    case "handoff":
      return "Handoff";
    case "merge":
      return "Merge";
    case "context":
      return "Context";
    case "tool":
      return readString(span.metadata.toolName) === "run_terminal_command"
        ? humanizeTerminalCategory(readString(span.metadata.toolCategory))
        : "Tool";
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
      return deriveRoleLabel(span);
    case "coordinator":
      return "Coordinator decision";
    case "sync":
      return "Mirrored external records";
    case "handoff":
      return "Created role handoff";
    case "merge":
      return "Merged role result";
    case "context":
      return `Built ${readString(span.metadata.role) ?? "runtime"} context`;
    case "tool":
      return readString(span.metadata.toolName) === "run_terminal_command"
        ? `Ran ${readString(span.metadata.commandLine) ?? "terminal command"}`
        : `Used ${readString(span.metadata.toolName) ?? trimTracePrefix(span.name)}`;
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

  if (span.spanType === "sync") {
    return span.outputSummary?.trim() || "Synced the latest runtime state to external records.";
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

  if (span.spanType === "tool" && readString(span.metadata.toolName) === "run_terminal_command") {
    return span.outputSummary?.trim() || "Executed a workspace terminal command.";
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

  if (span.spanType === "role") {
    const role = readString(span.metadata.role) ?? parseRoleFromSpanName(span.name);

    if (role === "verifier") {
      const decision = readString(span.metadata.decision);

      if (decision === "continue") {
        return "success";
      }

      if (decision === "retry_step" || decision === "replan") {
        return "warning";
      }

      if (decision === "fail") {
        return "danger";
      }
    }
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

function deriveEventBadge(event: RuntimeTraceSpanEvent) {
  const eventName = event.name;

  if (eventName === "coordinator_decision") {
    return "Decision";
  }

  if (eventName.includes("terminal")) {
    return "Terminal";
  }

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

  if (eventName.includes("artifact")) {
    return "Artifact";
  }

  if (eventName.includes("conflict")) {
    return "Conflict";
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

function deriveEventLabel(event: RuntimeTraceSpanEvent) {
  const eventName = event.name;

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
    case "control_plane_artifact_recorded":
      return "Planning artifact recorded";
    case "control_plane_handoff_recorded":
      return "Delegation packet recorded";
    case "control_plane_conflict_recorded":
      return "Merge conflict recorded";
    case "control_plane_merge_decision_recorded":
      return "Merge decision recorded";
    case "terminal_command_started":
      return "Started terminal command";
    case "terminal_command_completed":
      return "Completed terminal command";
    case "terminal_command_failed":
      return "Terminal command failed";
    case "state_merged":
      return "State updated";
    case "state_merge_failed":
      return "State update failed";
    case "coordinator_decision":
      return `Next action: ${humanizeOrchestrationAction(readString(event.metadata?.decision) ?? "continue")}`;
    case "model_unavailable":
      return "Model unavailable";
    default:
      return humanizeKey(eventName);
  }
}

function deriveEventDetail(event: RuntimeTraceSpanEvent) {
  if (event.name === "coordinator_decision") {
    return event.message?.trim() || "Recorded the next runtime action.";
  }

  return event.message?.trim() || "Runtime event recorded.";
}

function deriveEventTone(event: RuntimeTraceSpanEvent): AgentActivityItem["tone"] {
  const eventName = event.name;

  if (eventName === "coordinator_decision") {
    const decision = readString(event.metadata?.decision);

    if (decision === "continue") {
      return "success";
    }

    if (decision === "retry_step" || decision === "replan") {
      return "warning";
    }

    if (decision === "fail") {
      return "danger";
    }
  }

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
  const commandLine = readString(span.metadata.commandLine);
  const cwd = readString(span.metadata.cwd);
  const validationStatus = readString(span.metadata.validationStatus);
  const decision = readString(span.metadata.decision);
  const executionMode = readString(span.metadata.mode);
  const intentMatched = readBoolean(span.metadata.intentMatched);
  const targetMatched = readBoolean(span.metadata.targetMatched);
  const validationPassed = readBoolean(span.metadata.validationPassed);
  const sideEffectsDetected = readBoolean(span.metadata.sideEffectsDetected);
  const sectionIds = readStringArray(span.metadata.sectionIds);
  const truncatedSectionIds = readStringArray(span.metadata.truncatedSectionIds);
  const omittedForBudgetSectionIds = readStringArray(span.metadata.omittedForBudgetSectionIds);
  const changedFiles = readStringArray(span.metadata.changedFiles);
  const inputTokens = readNumber(span.metadata.inputTokens);
  const outputTokens = readNumber(span.metadata.outputTokens);
  const totalTokens = readNumber(span.metadata.totalTokens);
  const usedPromptTokens = readNumber(span.metadata.usedPromptTokens);
  const maxPromptTokens = readNumber(span.metadata.maxPromptTokens);
  const maxOutputTokens = readNumber(span.metadata.maxOutputTokens);
  const externalRecordCount = readNumber(span.metadata.externalRecordCount);
  const syncedActionCount = readNumber(span.metadata.syncedActionCount);
  const selectedFileCount = readMetadataArrayLength(span.metadata.selectedFiles);

  if (toolName && span.spanType !== "tool") {
    meta.push(toolName);
  }

  if (commandLine && span.spanType === "tool") {
    meta.push(commandLine);
  }

  if (path) {
    meta.push(path);
  }

  if (cwd && span.spanType === "tool" && toolName === "run_terminal_command") {
    meta.push(`cwd ${cwd}`);
  }

  if (modelId && span.spanType !== "model") {
    meta.push(modelId);
  }

  if (executionMode && span.spanType === "role" && readString(span.metadata.role) === "executor") {
    meta.push(executionMode);
  }

  if (changedFiles.length > 0) {
    meta.push(
      changedFiles.length === 1 ? changedFiles[0] : `${changedFiles.length} changed files`
    );
  }

  if (sectionIds.length > 0 && span.spanType === "context") {
    meta.push(`${sectionIds.length} sections`);
  }

  if (span.spanType === "context" && typeof usedPromptTokens === "number") {
    meta.push(
      typeof maxPromptTokens === "number"
        ? `${usedPromptTokens}/${maxPromptTokens} prompt tokens`
        : `${usedPromptTokens} prompt tokens`
    );
  }

  if (span.spanType === "context" && truncatedSectionIds.length > 0) {
    meta.push(
      `${truncatedSectionIds.length} truncated section${truncatedSectionIds.length === 1 ? "" : "s"}`
    );
  }

  if (span.spanType === "context" && omittedForBudgetSectionIds.length > 0) {
    meta.push(
      `${omittedForBudgetSectionIds.length} omitted for budget`
    );
  }

  if (span.spanType === "context" && selectedFileCount > 0) {
    meta.push(
      `${selectedFileCount} file${selectedFileCount === 1 ? "" : "s"} referenced`
    );
  }

  if (decision && readString(span.metadata.role) === "verifier") {
    meta.push(humanizeVerifierDecision(decision));
  }

  if (readString(span.metadata.role) === "verifier") {
    if (intentMatched === false) {
      meta.push("intent mismatch");
    }

    if (targetMatched === false) {
      meta.push("target mismatch");
    }

    if (validationPassed === false) {
      meta.push("validation failed");
    }

    if (sideEffectsDetected === true) {
      meta.push("unexpected side effects");
    }
  }

  if (validationStatus && validationStatus !== "not_run") {
    meta.push(`validation ${validationStatus}`);
  }

  if (typeof inputTokens === "number" || typeof outputTokens === "number" || typeof totalTokens === "number") {
    meta.push(
      `${inputTokens ?? 0}/${outputTokens ?? 0}/${totalTokens ?? 0} tokens`
    );
  }

  if (span.spanType === "model" && typeof maxOutputTokens === "number") {
    meta.push(`max ${maxOutputTokens} output tokens`);
  }

  if (span.spanType === "sync") {
    if (typeof syncedActionCount === "number") {
      meta.push(`${syncedActionCount} synced action${syncedActionCount === 1 ? "" : "s"}`);
    }

    if (typeof externalRecordCount === "number") {
      meta.push(`${externalRecordCount} external record${externalRecordCount === 1 ? "" : "s"}`);
    }
  }

  if (typeof span.durationMs === "number") {
    meta.push(`${span.durationMs} ms`);
  }

  const exitCode = readNumber(span.metadata.exitCode);

  if (span.spanType === "tool" && toolName === "run_terminal_command" && typeof exitCode === "number") {
    meta.push(`exit ${exitCode}`);
  }

  return meta;
}

function buildEventMeta(event: RuntimeTraceSpanEvent) {
  const meta: string[] = [];
  const path = readString(event.metadata?.path);
  const toolName = readString(event.metadata?.toolName);
  const commandLine = readString(event.metadata?.commandLine);
  const cwd = readString(event.metadata?.cwd);
  const exitCode = readNumber(event.metadata?.exitCode);
  const gateId = readString(event.metadata?.gateId);
  const artifactKind = readString(event.metadata?.artifactKind);
  const conflictKind = readString(event.metadata?.conflictKind);
  const mergeOutcome = readString(event.metadata?.mergeOutcome);
  const handoffStatus = readString(event.metadata?.handoffStatus);
  const ownerAgentTypeId = readString(event.metadata?.workPacketOwnerAgentTypeId);
  const entityKind = readString(event.metadata?.entityKind);
  const entityId = readString(event.metadata?.entityId);
  const decision = readString(event.metadata?.decision);

  if (toolName) {
    meta.push(toolName);
  }

  if (commandLine) {
    meta.push(commandLine);
  }

  if (path) {
    meta.push(path);
  }

  if (cwd) {
    meta.push(`cwd ${cwd}`);
  }

  if (typeof exitCode === "number") {
    meta.push(`exit ${exitCode}`);
  }

  if (gateId) {
    meta.push(gateId);
  }

  if (artifactKind) {
    meta.push(artifactKind);
  }

  if (conflictKind) {
    meta.push(conflictKind);
  }

  if (mergeOutcome) {
    meta.push(mergeOutcome);
  }

  if (handoffStatus) {
    meta.push(handoffStatus);
  }

  if (decision) {
    meta.push(humanizeOrchestrationAction(decision));
  }

  if (ownerAgentTypeId) {
    meta.push(ownerAgentTypeId);
  }

  if (entityKind && entityId) {
    meta.push(`${entityKind}:${entityId}`);
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

  if (item.sourceType === "sync" && item.status !== "failed") {
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

function readMetadataArrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function deriveRoleLabel(span: RuntimeTraceSpan) {
  const role = readString(span.metadata.role) ?? parseRoleFromSpanName(span.name);

  switch (role) {
    case "planner":
      return "Planner proposed next step";
    case "executor":
      return "Executor performed step";
    case "verifier":
      return deriveVerifierLabel(readString(span.metadata.decision));
    default:
      return `${capitalize(role)} step`;
  }
}

function deriveRoleDetail(span: RuntimeTraceSpan) {
  const role = readString(span.metadata.role) ?? parseRoleFromSpanName(span.name);
  const toolName = readString(span.metadata.toolName);
  const changedFiles = readStringArray(span.metadata.changedFiles);

  switch (role) {
    case "planner":
      return (
        span.outputSummary?.trim() ||
        (toolName
          ? `Bounded the next move to a scoped ${toolName} action.`
          : "Bounded the next move to the current request without expanding scope.")
      );
    case "executor":
      if (toolName === "run_terminal_command") {
        return "Executed the planned workspace command and captured the terminal transcript.";
      }

      if (changedFiles.length > 0) {
        return changedFiles.length === 1
          ? `Executed the planned step and updated ${changedFiles[0]}.`
          : `Executed the planned step and updated ${changedFiles.length} files.`;
      }

      return toolName
        ? `Executed the planned ${toolName} step and captured the current result.`
        : "Executed the planned step and captured the current result.";
    case "verifier":
      return (
        span.outputSummary?.trim() ||
        "Checked intent match, target scope, validation state, and progression safety."
      );
    default:
      return span.outputSummary?.trim() || span.inputSummary?.trim() || "Runtime role step recorded.";
  }
}

function normalizeTerminalCategory(value: string | null | undefined): RuntimeTerminalCommandEntry["category"] {
  switch (value) {
    case "git":
    case "ci":
    case "browser":
      return value;
    default:
      return "shell";
  }
}

function humanizeTerminalCategory(value: string | null | undefined) {
  switch (value) {
    case "git":
      return "Git";
    case "ci":
      return "CI";
    case "browser":
      return "Browser";
    default:
      return "Terminal";
  }
}

function buildTerminalEntryLabel(category: string, commandLine: string) {
  return `${humanizeTerminalCategory(category)} · ${commandLine}`;
}

function buildCombinedTerminalOutput(stdout: string, stderr: string) {
  if (stdout.trim() && stderr.trim()) {
    return [`$ stdout`, stdout.trimEnd(), "", `$ stderr`, stderr.trimEnd()].join("\n");
  }

  if (stdout.trim()) {
    return stdout.trimEnd();
  }

  if (stderr.trim()) {
    return [`$ stderr`, stderr.trimEnd()].join("\n");
  }

  return "(no output)";
}

function isTerminalToolResult(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { toolName?: unknown }).toolName === "run_terminal_command"
  );
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

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function deriveVerifierLabel(decision: string | null) {
  switch (decision) {
    case "continue":
      return "Verifier approved step";
    case "retry_step":
      return "Verifier requested retry";
    case "replan":
      return "Verifier requested replan";
    case "fail":
      return "Verifier rejected step";
    default:
      return "Verifier reviewed execution";
  }
}

function humanizeVerifierDecision(decision: string) {
  switch (decision) {
    case "continue":
      return "approved";
    case "retry_step":
      return "retry requested";
    case "replan":
      return "replan requested";
    case "fail":
      return "rejected";
    default:
      return humanizeKey(decision).toLowerCase();
  }
}

function humanizeOrchestrationAction(action: string) {
  switch (action) {
    case "retry_step":
      return "retry step";
    case "replan":
      return "replan";
    case "continue":
      return "continue";
    case "fail":
      return "fail";
    case "plan":
      return "plan";
    default:
      return humanizeKey(action).toLowerCase();
  }
}
