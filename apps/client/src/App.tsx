import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchProjectBrief,
  fetchRuntimeHealth,
  fetchRuntimeInstructions,
  fetchRuntimeStatus,
  fetchRuntimeTasks,
  submitRuntimeTask
} from "./api";
import { Sidebar } from "./components/Sidebar";
import { TaskWorkspace } from "./components/TaskWorkspace";
import {
  buildPreviewThreads,
  buildRuntimeThread,
  emptyProjectBrief,
  workspaceProjects
} from "./mockData";
import type {
  AttachmentCard,
  ComposerAttachment,
  ComposerMode,
  ProgressEvent,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTask,
  SidebarNavItemId,
  ThreadGroup,
  ThreadMessage,
  WorkspaceProject,
  WorkspaceThread
} from "./types";

type Feedback = {
  tone: "success" | "danger" | "info";
  text: string;
};

function App() {
  const [projectBrief, setProjectBrief] = useState<ProjectPayload>(emptyProjectBrief);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [instructions, setInstructions] = useState<RuntimeInstructionResponse | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(workspaceProjects[0]?.id ?? "");
  const [selectedThreadIds, setSelectedThreadIds] = useState<Record<string, string | null>>({});
  const [draftThreadsByProject, setDraftThreadsByProject] = useState<Record<string, WorkspaceThread[]>>({});
  const [runtimeAttachmentPreviewsByTaskId, setRuntimeAttachmentPreviewsByTaskId] = useState<
    Record<string, ComposerAttachment[]>
  >({});
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>([]);
  const [renamedProjectIds, setRenamedProjectIds] = useState<Record<string, string>>({});
  const [activeNav, setActiveNav] = useState<SidebarNavItemId>("projects");
  const [composerMode, setComposerMode] = useState<ComposerMode>("text");
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadProjectData(cancelled?: { value: boolean }) {
    try {
      const payload = await fetchProjectBrief();

      if (cancelled?.value) {
        return;
      }

      setProjectBrief(payload);
      setProjectError(null);
    } catch (error) {
      if (cancelled?.value) {
        return;
      }

      setProjectError(
        error instanceof Error
          ? error.message
          : "Project brief unavailable. Falling back to the local shell copy."
      );
    }
  }

  async function loadInstructionRuntime(cancelled?: { value: boolean }) {
    try {
      const payload = await fetchRuntimeInstructions();

      if (cancelled?.value) {
        return;
      }

      setInstructions(payload);
    } catch {
      if (cancelled?.value) {
        return;
      }

      setInstructions(null);
    }
  }

  async function loadRuntimeSnapshot(cancelled?: { value: boolean }) {
    const [healthResult, statusResult, tasksResult] = await Promise.allSettled([
      fetchRuntimeHealth(),
      fetchRuntimeStatus(),
      fetchRuntimeTasks()
    ]);

    if (cancelled?.value) {
      return;
    }

    setRuntimeHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
    setRuntimeStatus(statusResult.status === "fulfilled" ? statusResult.value : null);
    setRuntimeTasks(tasksResult.status === "fulfilled" ? tasksResult.value.tasks : []);

    if (statusResult.status === "fulfilled" || healthResult.status === "fulfilled") {
      setRuntimeError(null);
      return;
    }

    setRuntimeError(
      "Runtime API not reachable. Start the server or point VITE_API_URL at the live backend."
    );
  }

  useEffect(() => {
    const cancelled = { value: false };

    void Promise.all([loadProjectData(cancelled), loadInstructionRuntime(cancelled)]);

    return () => {
      cancelled.value = true;
    };
  }, []);

  useEffect(() => {
    const cancelled = { value: false };

    void loadRuntimeSnapshot(cancelled);

    const interval = window.setInterval(() => {
      void loadRuntimeSnapshot(cancelled);
    }, 4000);

    return () => {
      cancelled.value = true;
      window.clearInterval(interval);
    };
  }, []);

  const visibleProjects = useMemo(
    () =>
      workspaceProjects
        .filter((candidate) => !hiddenProjectIds.includes(candidate.id))
        .map((candidate) => ({
          ...candidate,
          name: renamedProjectIds[candidate.id] ?? candidate.name
        })),
    [hiddenProjectIds, renamedProjectIds]
  );

  useEffect(() => {
    if (!visibleProjects.length) {
      return;
    }

    if (!visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0].id);
    }
  }, [selectedProjectId, visibleProjects]);

  const threadGroups = useMemo<ThreadGroup[]>(
    () =>
      visibleProjects.map((candidate) => ({
        project: candidate,
        threads: buildThreadsForProject(
          candidate,
          runtimeTasks,
          draftThreadsByProject[candidate.id] ?? [],
          runtimeAttachmentPreviewsByTaskId
        )
      })),
    [draftThreadsByProject, runtimeAttachmentPreviewsByTaskId, runtimeTasks, visibleProjects]
  );

  const activeProject =
    visibleProjects.find((candidate) => candidate.id === selectedProjectId) ?? visibleProjects[0] ?? null;
  const activeThreadId = activeProject ? selectedThreadIds[activeProject.id] ?? null : null;
  const activeGroup = activeProject
    ? threadGroups.find((candidate) => candidate.project.id === activeProject.id) ?? null
    : null;
  const activeThread =
    activeGroup?.threads.find((candidate) => candidate.id === activeThreadId) ?? null;
  const backendConnected =
    runtimeStatus !== null || runtimeHealth?.status === "ok";

  useEffect(() => {
    if (!activeProject || !activeThreadId) {
      return;
    }

    const threadExists = activeGroup?.threads.some((candidate) => candidate.id === activeThreadId);

    if (threadExists) {
      return;
    }

    setSelectedThreadIds((current) => ({
      ...current,
      [activeProject.id]: null
    }));
  }, [activeGroup, activeProject, activeThreadId]);

  function buildInstructionPayload() {
    const trimmed = composerValue.trim();

    if (trimmed) {
      return trimmed;
    }

    if (composerAttachments.length > 0) {
      return "Analyze the attached file(s) and summarize the key findings.";
    }

    return "";
  }

  function handleCreateThread() {
    if (!activeProject) {
      return;
    }

    const thread = createDraftThread(activeProject.name);

    setDraftThreadsByProject((current) => ({
      ...current,
      [activeProject.id]: [thread, ...(current[activeProject.id] ?? [])]
    }));
    setSelectedThreadIds((current) => ({
      ...current,
      [activeProject.id]: thread.id
    }));
    setActiveNav("projects");
    setComposerValue("");
    setComposerAttachments([]);
    setComposerMode("text");
    setSubmissionFeedback(null);
  }

  async function handleSubmitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeProject) {
      return;
    }

    const instruction = buildInstructionPayload();

    if (!instruction) {
      setSubmissionFeedback({
        tone: "info",
        text: "Write a prompt or attach a file before sending the thread."
      });
      return;
    }

    const draftId = activeThread?.source === "draft" ? activeThread.id : createDraftId();
    const optimisticThread = buildDraftSubmissionThread({
      existingThread: activeThread?.source === "draft" ? activeThread : null,
      threadId: draftId,
      instruction,
      attachments: composerAttachments,
      backendConnected: activeProject.kind === "live" && backendConnected
    });

    setDraftThreadsByProject((current) => ({
      ...current,
      [activeProject.id]: [
        optimisticThread,
        ...(current[activeProject.id] ?? []).filter((candidate) => candidate.id !== draftId)
      ]
    }));
    setSelectedThreadIds((current) => ({
      ...current,
      [activeProject.id]: draftId
    }));
    setActiveNav("projects");
    setComposerValue("");
    setComposerAttachments([]);
    setComposerMode("text");

    if (activeProject.kind !== "live" || !backendConnected) {
      setSubmissionFeedback({
        tone: "info",
        text:
          activeProject.kind === "live"
            ? "Saved locally. Start the runtime to send live tasks."
            : "Saved locally in this preview workspace."
      });
      return;
    }

    setSubmitting(true);
    setSubmissionFeedback(null);

    try {
      const response = await submitRuntimeTask({
        instruction,
        title: optimisticThread.title,
        attachments: composerAttachments
      });

      await loadRuntimeSnapshot();

      if (composerAttachments.length > 0) {
        setRuntimeAttachmentPreviewsByTaskId((current) => ({
          ...current,
          [response.task.id]: composerAttachments
        }));
      }

      setDraftThreadsByProject((current) => ({
        ...current,
        [activeProject.id]: (current[activeProject.id] ?? []).filter(
          (candidate) => candidate.id !== draftId
        )
      }));
      setSelectedThreadIds((current) => ({
        ...current,
        [activeProject.id]: response.task.id
      }));
      setSubmissionFeedback({
        tone: "success",
        text: "Thread accepted by the persistent runtime."
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Task submission failed. Check the runtime API and try again.";

      setDraftThreadsByProject((current) => ({
        ...current,
        [activeProject.id]: (current[activeProject.id] ?? []).map((candidate) =>
          candidate.id === draftId ? markDraftThreadFailed(candidate, message) : candidate
        )
      }));
      setSubmissionFeedback({
        tone: "danger",
        text: message
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRenameProject(projectId: string) {
    const projectToRename = visibleProjects.find((candidate) => candidate.id === projectId);

    if (!projectToRename) {
      return;
    }

    const nextName = window.prompt("Rename session", projectToRename.name)?.trim();

    if (!nextName) {
      return;
    }

    setRenamedProjectIds((current) => ({
      ...current,
      [projectId]: nextName
    }));
  }

  function handleDeleteProject(projectId: string) {
    if (visibleProjects.length <= 1) {
      setSubmissionFeedback({
        tone: "info",
        text: "Keep at least one project visible in the sidebar."
      });
      return;
    }

    setHiddenProjectIds((current) => [...current, projectId]);
    setDraftThreadsByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });

    if (selectedProjectId === projectId) {
      const nextProject = visibleProjects.find((candidate) => candidate.id !== projectId);

      if (nextProject) {
        setSelectedProjectId(nextProject.id);
        setActiveNav("projects");
      }
    }
  }

  const feedback =
    submissionFeedback ??
    (runtimeError
      ? {
          tone: "danger" as const,
          text: runtimeError
        }
      : projectError
        ? {
            tone: "info" as const,
            text: projectError
          }
        : null);

  return (
    <main className="app-shell">
      <Sidebar
        groups={threadGroups}
        activeProjectId={activeProject?.id ?? null}
        activeThreadId={activeThreadId}
        activeNav={activeNav}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setActiveNav("projects");
        }}
        onSelectThread={(projectId, threadId) => {
          setSelectedProjectId(projectId);
          setSelectedThreadIds((current) => ({
            ...current,
            [projectId]: threadId
          }));
          setActiveNav("projects");
        }}
        onCreateThread={handleCreateThread}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onSelectNav={setActiveNav}
      />

      <TaskWorkspace
        activeNav={activeNav}
        project={activeProject}
        projectBrief={projectBrief}
        thread={activeThread}
        runtimeStatus={runtimeStatus}
        instructions={instructions}
        composerMode={composerMode}
        composerValue={composerValue}
        composerAttachments={composerAttachments}
        feedback={feedback}
        submitting={submitting}
        backendConnected={backendConnected}
        onComposerModeChange={setComposerMode}
        onComposerValueChange={setComposerValue}
        onComposerAttachmentsChange={setComposerAttachments}
        onSelectSuggestion={(prompt) => {
          setActiveNav("projects");
          setComposerMode("text");
          setComposerValue(prompt);
        }}
        onSubmit={handleSubmitTask}
      />
    </main>
  );
}

function buildThreadsForProject(
  project: WorkspaceProject,
  runtimeTasks: RuntimeTask[],
  draftThreads: WorkspaceThread[],
  runtimeAttachmentPreviewsByTaskId: Record<string, ComposerAttachment[]>
) {
  if (project.kind === "live") {
    return [
      ...draftThreads,
      ...runtimeTasks.map((task) =>
        buildRuntimeThread(task, runtimeAttachmentPreviewsByTaskId[task.id] ?? [])
      )
    ];
  }

  return [...draftThreads, ...buildPreviewThreads(project.id)];
}

function createDraftThread(projectName: string): WorkspaceThread {
  return {
    id: createDraftId(),
    title: "New thread",
    summary: `Start a task for ${projectName}.`,
    status: "draft",
    source: "draft",
    createdLabel: "Just now",
    updatedLabel: "Draft",
    tags: ["draft"],
    attachments: [],
    messages: [],
    progress: []
  };
}

function buildDraftSubmissionThread({
  existingThread,
  threadId,
  instruction,
  attachments,
  backendConnected
}: {
  existingThread: WorkspaceThread | null;
  threadId: string;
  instruction: string;
  attachments: ComposerAttachment[];
  backendConnected: boolean;
}): WorkspaceThread {
  const timestamp = formatShellTimestamp(new Date());
  const statusMessage = backendConnected
    ? "Request queued locally and sent to the runtime service."
    : "Saved in the local shell. Connect the runtime to run this thread live.";
  const nextThread = existingThread ?? {
    id: threadId,
    title: deriveThreadTitle(instruction),
    summary: instruction,
    status: backendConnected ? "pending" : "draft",
    source: "draft" as const,
    createdLabel: timestamp,
    updatedLabel: timestamp,
    tags: backendConnected ? ["pending"] : ["draft"],
    messages: [],
    progress: []
  };

  return {
    ...nextThread,
    title:
      nextThread.title === "New thread" || nextThread.messages.length === 0
        ? deriveThreadTitle(instruction)
        : nextThread.title,
    summary: instruction,
    status: backendConnected ? "pending" : "draft",
    updatedLabel: timestamp,
    tags: backendConnected ? ["pending", "live-request"] : ["draft", "local"],
    attachments: attachments.map(toLocalAttachmentCard),
    messages: [
      ...nextThread.messages,
      createMessage({
        id: `${threadId}-${nextThread.messages.length + 1}`,
        role: "user",
        label: "You",
        body: instruction,
        timestamp,
        tone: "default"
      }),
      createMessage({
        id: `${threadId}-${nextThread.messages.length + 2}`,
        role: "system",
        label: backendConnected ? "Runtime" : "Local draft",
        body: statusMessage,
        timestamp,
        tone: backendConnected ? "info" : "default"
      })
    ],
    progress: [
      ...nextThread.progress,
      createProgress({
        id: `${threadId}-${nextThread.progress.length + 1}`,
        label: backendConnected ? "Queued" : "Saved locally",
        detail: statusMessage,
        timestamp,
        tone: backendConnected ? "info" : "default"
      })
    ]
  };
}

function markDraftThreadFailed(thread: WorkspaceThread, errorMessage: string): WorkspaceThread {
  const timestamp = formatShellTimestamp(new Date());

  return {
    ...thread,
    status: "failed",
    updatedLabel: timestamp,
    tags: ["failed", "retry"],
    messages: [
      ...thread.messages,
      createMessage({
        id: `${thread.id}-failure`,
        role: "assistant",
        label: "Runtime error",
        body: errorMessage,
        timestamp,
        tone: "danger"
      })
    ],
    progress: [
      ...thread.progress,
      createProgress({
        id: `${thread.id}-failure`,
        label: "Submission failed",
        detail: errorMessage,
        timestamp,
        tone: "danger"
      })
    ]
  };
}

function deriveThreadTitle(instruction: string) {
  return instruction.split(/\s+/).slice(0, 6).join(" ") || "New thread";
}

function createDraftId() {
  return `draft-${crypto.randomUUID()}`;
}

function formatShellTimestamp(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function createMessage(message: ThreadMessage): ThreadMessage {
  return message;
}

function createProgress(event: ProgressEvent): ProgressEvent {
  return event;
}

function toLocalAttachmentCard(attachment: ComposerAttachment): AttachmentCard {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.type,
    kind: attachment.kind,
    summary: attachment.summary,
    excerpt: attachment.excerpt,
    previewUrl: attachment.previewUrl,
    source: "local"
  };
}

export default App;
