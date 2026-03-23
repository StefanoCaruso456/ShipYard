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
import { ThreadListPane } from "./components/ThreadListPane";
import { UtilityDock } from "./components/UtilityDock";
import {
  buildGitPreview,
  buildGuideThread,
  buildPreviewThreads,
  buildRuntimeThread,
  buildSkillCatalog,
  buildTerminalPreview,
  emptyProjectBrief,
  modeOptions,
  seededAutomations,
  sidebarNavigation,
  utilityTabs,
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
  UtilityTab,
  WorkspaceProject,
  WorkspaceThread
} from "./types";

function App() {
  const [project, setProject] = useState<ProjectPayload>(emptyProjectBrief);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [instructions, setInstructions] = useState<RuntimeInstructionResponse | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("shipyard-runtime");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<SidebarNavItemId>("projects");
  const [activeTab, setActiveTab] = useState<UtilityTab>("run");
  const [mode, setMode] = useState<ModeOption>("worktree");
  const [threadFilter, setThreadFilter] = useState("");
  const [composerTitle, setComposerTitle] = useState("");
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
  const [initializing, setInitializing] = useState(true);
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
      "Runtime API not reachable. The live Shipyard workspace will reconnect when the server comes back."
    );
  }

  useEffect(() => {
    const cancelled = { value: false };

    void Promise.all([loadProjectData(cancelled), loadInstructionRuntime(cancelled)]).finally(() => {
      if (!cancelled.value) {
        setInitializing(false);
      }
    });

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

  const allThreads = buildThreads(activeProject, project, runtimeHealth, runtimeStatus, instructions, runtimeTasks);
  const filteredThreads = allThreads.filter((thread) => {
    const query = threadFilter.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return `${thread.title} ${thread.summary} ${thread.tags.join(" ")}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    const candidateThreads = filteredThreads.length > 0 ? filteredThreads : allThreads;

    if (candidateThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    if (!selectedThreadId || !candidateThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(candidateThreads[0].id);
    }
  }, [
    selectedThreadId,
    selectedProjectId,
    allThreads.map((thread) => thread.id).join("|"),
    filteredThreads.map((thread) => thread.id).join("|")
  ]);

  const activeThread =
    filteredThreads.find((thread) => thread.id === selectedThreadId) ??
    allThreads.find((thread) => thread.id === selectedThreadId) ??
    null;

  const skillCatalog = buildSkillCatalog(instructions);
  const gitChanges = activeThread ? buildGitPreview(activeThread) : [];
  const terminalEntries = activeThread ? buildTerminalPreview(activeThread, runtimeStatus) : [];
  const runtimeTone = runtimeHealth?.status === "ok" ? (runtimeStatus?.workerState === "running" ? "busy" : "ready") : "offline";
  const runtimeLabel =
    runtimeHealth?.status === "ok"
      ? runtimeStatus?.workerState === "running"
        ? "Processing"
        : "Healthy"
      : "Offline";
  const backendConnected = runtimeHealth?.status === "ok";

  function handleNavSelect(navId: SidebarNavItemId) {
    setActiveNav(navId);

    if (navId === "skills") {
      setActiveTab("skills");
      return;
    }

    if (navId === "automations") {
      setActiveTab("automations");
      return;
    }

    setActiveTab("run");
  }

  async function handleSubmitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (activeProject.kind !== "live") {
      setSubmissionFeedback({
        tone: "info",
        text: "Switch to Shipyard Runtime to submit a live task. Preview workspaces are UI-only."
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
        text: "Write an instruction before submitting the task."
      });
      return;
    }

    setSubmitting(true);
    setSubmissionFeedback(null);

    try {
      const response = await submitRuntimeTask({
        title: composerTitle.trim() || undefined,
        instruction: composerValue.trim(),
        simulateFailure
      });

      setSelectedProjectId("shipyard-runtime");
      setSelectedThreadId(response.task.id);
      setActiveNav("projects");
      setActiveTab("run");
      setComposerTitle("");
      setComposerValue("");
      setSimulateFailure(false);
      setSubmissionFeedback({
        tone: "success",
        text: "Task accepted by the persistent runtime service."
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
    <main className="workspace-shell">
      <Sidebar
        projects={workspaceProjects}
        navItems={sidebarNavigation}
        activeProjectId={selectedProjectId}
        activeNav={activeNav}
        runtimeTone={runtimeTone}
        runtimeLabel={runtimeLabel}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setActiveNav("projects");
        }}
        onSelectNav={handleNavSelect}
      />

      <ThreadListPane
        project={activeProject}
        threads={filteredThreads}
        activeThreadId={selectedThreadId}
        filterValue={threadFilter}
        onFilterChange={setThreadFilter}
        onSelectThread={setSelectedThreadId}
        onCreateThread={() => {
          setSelectedProjectId("shipyard-runtime");
          setActiveNav("projects");
          setActiveTab("run");
          setThreadFilter("");
          setSubmissionFeedback({
            tone: "info",
            text: "Compose a new task below and send it to the live runtime."
          });
        }}
      />

      <TaskWorkspace
        project={activeProject}
        thread={activeThread}
        mode={mode}
        modeOptions={modeOptions}
        composerTitle={composerTitle}
        composerValue={composerValue}
        feedback={
          runtimeError && !submissionFeedback
            ? {
                tone: "danger",
                text: runtimeError
              }
            : submissionFeedback
        }
        submitting={submitting}
        simulateFailure={simulateFailure}
        selectedSkillCount={selectedSkillIds.length}
        backendConnected={backendConnected}
        onModeChange={setMode}
        onComposerTitleChange={setComposerTitle}
        onComposerValueChange={setComposerValue}
        onSimulateFailureChange={setSimulateFailure}
        onSubmit={handleSubmitTask}
      />

      <UtilityDock
        activeTab={activeTab}
        tabs={utilityTabs}
        project={project}
        thread={activeThread}
        runtimeHealth={runtimeHealth}
        runtimeStatus={runtimeStatus}
        instructions={instructions}
        gitChanges={gitChanges}
        terminalEntries={terminalEntries}
        skillCatalog={skillCatalog}
        selectedSkillIds={selectedSkillIds}
        automations={automations}
        onSelectTab={setActiveTab}
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
          setActiveTab("automations");
        }}
      />

      <div className="workspace-banner">
        <div className="workspace-banner__copy">
          <strong>{initializing ? "Loading workspace shell..." : project.name}</strong>
          <span>{projectError ?? runtimeError ?? project.nextStep}</span>
        </div>
        <div className="workspace-banner__meta">
          <span className={`tone-badge tone-badge--${runtimeTone}`}>{runtimeLabel}</span>
          <span className="source-pill source-pill--guide">
            {runtimeTasks.length} live thread{runtimeTasks.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
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
