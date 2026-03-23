import type { FormEvent } from "react";
import { useEffect, useState } from "react";

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
  buildSkillCatalog,
  emptyProjectBrief,
  modeOptions,
  seededAutomations,
  workspaceProjects
} from "./mockData";
import type {
  AutomationItem,
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
  const [composerValue, setComposerValue] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [automations, setAutomations] = useState<AutomationItem[]>(seededAutomations);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    tone: "success" | "danger" | "info";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    if (!instructions) {
      return;
    }

    setSelectedSkillIds((current) =>
      current.includes(instructions.skill.meta.id)
        ? current
        : [instructions.skill.meta.id, ...current]
    );
  }, [instructions]);

  const activeProject =
    workspaceProjects.find((candidate) => candidate.id === selectedProjectId) ?? workspaceProjects[0];
  const threads = buildThreads(activeProject, project, runtimeHealth, runtimeStatus, instructions, runtimeTasks);

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedProjectId, selectedThreadId, threads]);

  const activeThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
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
  const skillCatalog = buildSkillCatalog(instructions);

  async function handleSubmitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

    if (!composerValue.trim()) {
      setSubmissionFeedback({
        tone: "info",
        text: "Write an instruction before sending the thread."
      });
      return;
    }

    setSubmitting(true);
    setSubmissionFeedback(null);

    try {
      const response = await submitRuntimeTask({
        instruction: composerValue.trim(),
        simulateFailure
      });

      setSelectedProjectId("shipyard-runtime");
      setSelectedThreadId(response.task.id);
      setActiveNav("projects");
      setComposerValue("");
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

  return (
    <main className="app-shell">
      <Sidebar
        projects={workspaceProjects}
        threads={threads}
        activeProjectId={selectedProjectId}
        activeThreadId={selectedThreadId}
        activeNav={activeNav}
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
          setSelectedProjectId("shipyard-runtime");
          setActiveNav("projects");
          setComposerValue("");
          setSubmissionFeedback({
            tone: "info",
            text: "Compose a new task below and send it to the runtime."
          });
        }}
        onSelectNav={setActiveNav}
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
        composerValue={composerValue}
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
        selectedSkillIds={selectedSkillIds}
        skillCatalog={skillCatalog}
        automations={automations}
        backendConnected={backendConnected}
        repositoryUrl={repositoryUrl}
        onModeChange={setMode}
        onComposerValueChange={setComposerValue}
        onSimulateFailureChange={setSimulateFailure}
        onSubmit={handleSubmitTask}
        onHandoff={() =>
          setSubmissionFeedback({
            tone: "info",
            text: "Handoff is a shell surface right now. Run transfer behavior will land in the next phase."
          })
        }
        onOpenSettings={() => setActiveNav("settings")}
        onOpenProjects={() => setActiveNav("projects")}
        onToggleSkill={(skillId) => {
          setSelectedSkillIds((current) =>
            current.includes(skillId)
              ? current.filter((candidate) => candidate !== skillId)
              : [...current, skillId]
          );
        }}
        onCreateAutomation={(input) => {
          setAutomations((current) => [
            {
              id: `automation-${current.length + 1}`,
              name: input.name,
              schedule: input.schedule,
              workspace: input.workspace,
              status: "draft",
              note: input.note
            },
            ...current
          ]);
          setActiveNav("automations");
        }}
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
