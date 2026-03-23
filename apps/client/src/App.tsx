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
  buildGuideThread,
  buildPreviewThreads,
  buildRuntimeThread,
  emptyProjectBrief,
  modeOptions,
  workspaceProjects
} from "./mockData";
import type {
  ComposerAttachment,
  ComposerMode,
  ModeOption,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTask,
  SidebarNavItemId,
  WorkspaceProject,
  WorkspaceThread
} from "./types";

const repositoryUrl = "https://github.com/StefanoCaruso456/ShipYard";

function App() {
  const [project, setProject] = useState<ProjectPayload>(emptyProjectBrief);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [instructions, setInstructions] = useState<RuntimeInstructionResponse | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("shipyard-runtime");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<SidebarNavItemId>("projects");
  const [mode, setMode] = useState<ModeOption>("worktree");
  const [composerMode, setComposerMode] = useState<ComposerMode>("text");
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    tone: "success" | "danger" | "info";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [renamedProjectIds, setRenamedProjectIds] = useState<Record<string, string>>({});
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>([]);

  async function loadProjectData(cancelled?: { value: boolean }) {
    try {
      const payload = await fetchProjectBrief();

      if (cancelled?.value) {
        return;
      }

      setProject(payload);
      setProjectError(null);
    } catch (error) {
      if (cancelled?.value) {
        return;
      }

      setProjectError(
        error instanceof Error
          ? error.message
          : "Project brief unavailable. Rendering the seeded shell instead."
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

    if (
      healthResult.status === "fulfilled" &&
      statusResult.status === "fulfilled" &&
      tasksResult.status === "fulfilled"
    ) {
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

  const activeProject =
    visibleProjects.find((candidate) => candidate.id === selectedProjectId) ?? visibleProjects[0] ?? null;

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    if (activeProject.id !== selectedProjectId) {
      setSelectedProjectId(activeProject.id);
    }
  }, [activeProject, selectedProjectId]);

  const allThreads = activeProject
    ? buildThreads(activeProject, project, runtimeHealth, runtimeStatus, instructions, runtimeTasks)
    : [];

  useEffect(() => {
    if (allThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !allThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(allThreads[0].id);
    }
  }, [allThreads, selectedThreadId]);

  const activeThread = allThreads.find((thread) => thread.id === selectedThreadId) ?? null;
  const runtimeTone =
    runtimeHealth?.status === "ok"
      ? runtimeStatus?.workerState === "running"
        ? "busy"
        : "ready"
      : "offline";
  const runtimeLabel =
    runtimeHealth?.status === "ok"
      ? runtimeStatus?.workerState === "running"
        ? "Processing"
        : "Healthy"
      : "Offline";
  const backendConnected = runtimeHealth?.status === "ok";

  function buildInstructionPayload() {
    const trimmed = composerValue.trim();
    const attachmentSummary =
      composerAttachments.length > 0
        ? `Attachments: ${composerAttachments.map((attachment) => attachment.name).join(", ")}`
        : "";

    return [trimmed, attachmentSummary].filter(Boolean).join("\n\n");
  }

  async function handleSubmitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeProject) {
      return;
    }

    if (activeProject.kind !== "live") {
      setSubmissionFeedback({
        tone: "info",
        text: "Switch to Shipyard Runtime to submit a live task. Preview workspaces stay UI-only."
      });
      return;
    }

    if (!backendConnected) {
      setSubmissionFeedback({
        tone: "danger",
        text: "Runtime API is offline. Start the server or point VITE_API_URL at the live backend."
      });
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

    setSubmitting(true);
    setSubmissionFeedback(null);

    try {
      const response = await submitRuntimeTask({
        instruction,
        simulateFailure
      });

      setSelectedProjectId("shipyard-runtime");
      setSelectedThreadId(response.task.id);
      setActiveNav("projects");
      setComposerValue("");
      setComposerAttachments([]);
      setComposerMode("text");
      setSimulateFailure(false);
      setSubmissionFeedback({
        tone: "success",
        text: "Thread accepted by the persistent runtime."
      });

      await loadRuntimeSnapshot();
    } catch (error) {
      setSubmissionFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Task submission failed. Check the runtime API and try again."
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
        text: "Keep at least one session visible in the sidebar."
      });
      return;
    }

    const nextProjects = visibleProjects.filter((candidate) => candidate.id !== projectId);

    setHiddenProjectIds((current) => [...current, projectId]);

    if (selectedProjectId === projectId && nextProjects[0]) {
      setSelectedProjectId(nextProjects[0].id);
      setActiveNav("projects");
    }
  }

  return (
    <main className="app-shell">
      <Sidebar
        projects={visibleProjects}
        threads={allThreads}
        activeProjectId={activeProject?.id ?? null}
        activeThreadId={selectedThreadId}
        runtimeTone={runtimeTone}
        runtimeLabel={runtimeLabel}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setActiveNav("projects");
        }}
        onSelectThread={(threadId) => {
          setSelectedThreadId(threadId);
          setActiveNav("projects");
        }}
        onCreateThread={() => {
          setActiveNav("projects");
          setComposerValue("");
          setComposerAttachments([]);
          setComposerMode("text");
          setSubmissionFeedback({
            tone: "info",
            text: "Compose a new task below and send it to the runtime."
          });
        }}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onOpenSettings={() => setActiveNav("settings")}
      />

      <TaskWorkspace
        activeNav={activeNav}
        project={activeProject}
        projectBrief={project}
        thread={activeThread}
        runtimeHealth={runtimeHealth}
        runtimeStatus={runtimeStatus}
        instructions={instructions}
        mode={mode}
        modeOptions={modeOptions}
        composerMode={composerMode}
        composerValue={composerValue}
        composerAttachments={composerAttachments}
        feedback={
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
              : null)
        }
        submitting={submitting}
        simulateFailure={simulateFailure}
        backendConnected={backendConnected}
        repositoryUrl={repositoryUrl}
        onModeChange={setMode}
        onComposerModeChange={setComposerMode}
        onComposerValueChange={setComposerValue}
        onComposerAttachmentsChange={setComposerAttachments}
        onSimulateFailureChange={setSimulateFailure}
        onSubmit={handleSubmitTask}
        onHandoff={() =>
          setSubmissionFeedback({
            tone: "info",
            text: "Handoff is a shell control right now. Run transfer behavior lands in the next phase."
          })
        }
        onOpenSettings={() => setActiveNav("settings")}
      />
    </main>
  );
}

function buildThreads(
  activeProject: WorkspaceProject,
  project: ProjectPayload,
  runtimeHealth: RuntimeHealthResponse | null,
  runtimeStatus: RuntimeStatusResponse | null,
  instructions: RuntimeInstructionResponse | null,
  runtimeTasks: RuntimeTask[]
): WorkspaceThread[] {
  if (activeProject.kind === "live") {
    return [
      buildGuideThread(project, runtimeHealth, runtimeStatus, instructions),
      ...runtimeTasks.map((task) => buildRuntimeThread(task))
    ];
  }

  return buildPreviewThreads(activeProject.id);
}

export default App;
