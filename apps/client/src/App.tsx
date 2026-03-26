import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchProjectBrief,
  fetchRuntimeBranches,
  fetchRuntimeHealth,
  fetchRuntimeInstructions,
  fetchRuntimeStatus,
  fetchRuntimeTrace,
  fetchRuntimeTasks,
  switchRuntimeBranch,
  submitRuntimeApprovalDecision,
  submitRuntimeTask,
  transcribeRuntimeAudio
} from "./api";
import { buildComposerAttachment } from "./attachments";
import { applyLocalFilePlan, extractLocalFilePlan } from "./localFileBridge";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { Sidebar } from "./components/Sidebar";
import { TaskWorkspace } from "./components/TaskWorkspace";
import {
  buildRuntimeThread,
  emptyProjectBrief,
  workspaceProjects
} from "./mockData";
import {
  createLocalProject,
  deriveProjectCode,
  getProjectDirectoryHandle,
  loadStoredLocalProjects,
  pickProjectDirectory,
  persistProjectDirectoryHandle,
  removePersistedProjectDirectoryHandle,
  resolveStoredProjectFolderStatus,
  saveStoredLocalProjects,
  supportsProjectDirectoryPicker,
  updateLocalProjectFolder
} from "./projects";
import type {
  AttachmentCard,
  ComposerAttachment,
  ComposerMode,
  LocalFileExecutionEffect,
  ProgressEvent,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeRepoBranchSnapshot,
  RuntimeOperatorApprovalDecision,
  RuntimeStatusResponse,
  RuntimeTraceRunLog,
  RuntimeQueuedFollowUpDraft,
  RuntimeTask,
  RuntimeTaskSubmitContext,
  SidebarNavItemId,
  ThreadGroup,
  ThreadMessage,
  WorkspaceProject,
  WorkspaceThread
} from "./types";

const defaultRuntimeProjectId = workspaceProjects[0]?.id ?? "shipyard-runtime";

type Feedback = {
  tone: "success" | "danger" | "info";
  text: string;
};

function App() {
  const [localProjects, setLocalProjects] = useState<WorkspaceProject[]>(() => loadStoredLocalProjects());
  const [projectBrief, setProjectBrief] = useState<ProjectPayload>(emptyProjectBrief);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [runtimeRepoSnapshot, setRuntimeRepoSnapshot] = useState<RuntimeRepoBranchSnapshot | null>(
    null
  );
  const [runtimeRepoLoading, setRuntimeRepoLoading] = useState(false);
  const [runtimeRepoError, setRuntimeRepoError] = useState<string | null>(null);
  const [runtimeRepoSwitchingBranchName, setRuntimeRepoSwitchingBranchName] = useState<
    string | null
  >(null);
  const [instructions, setInstructions] = useState<RuntimeInstructionResponse | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTask[]>([]);
  const [runtimeTracesByTaskId, setRuntimeTracesByTaskId] = useState<
    Record<string, RuntimeTraceRunLog>
  >({});
  const [selectedProjectId, setSelectedProjectId] = useState(workspaceProjects[0]?.id ?? "");
  const [selectedThreadIds, setSelectedThreadIds] = useState<Record<string, string | null>>({});
  const [draftThreadsByProject, setDraftThreadsByProject] = useState<Record<string, WorkspaceThread[]>>({});
  const [runtimeAttachmentPreviewsByTaskId, setRuntimeAttachmentPreviewsByTaskId] = useState<
    Record<string, ComposerAttachment[]>
  >({});
  const [localFileEffectsByTaskId, setLocalFileEffectsByTaskId] = useState<
    Record<string, LocalFileExecutionEffect>
  >({});
  const [pendingLiveFollowUpsByThreadId, setPendingLiveFollowUpsByThreadId] = useState<
    Record<string, RuntimeQueuedFollowUpDraft[]>
  >({});
  const [activeNav, setActiveNav] = useState<SidebarNavItemId>("projects");
  const [composerMode, setComposerMode] = useState<ComposerMode>("text");
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectDialogName, setProjectDialogName] = useState("");
  const [projectDialogFolder, setProjectDialogFolder] = useState<Awaited<
    ReturnType<typeof pickProjectDirectory>
  > | null>(null);
  const [projectDialogError, setProjectDialogError] = useState<string | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const localFileApplicationsInFlightRef = useRef(new Set<string>());
  const projectPickerSupported = supportsProjectDirectoryPicker();
  const hasActiveRuntimeRuns = runtimeTasks.some(
    (candidate) =>
      candidate.status === "pending" ||
      candidate.status === "running" ||
      candidate.status === "paused"
  );
  const backendConnected =
    runtimeStatus !== null || runtimeHealth?.status === "ok";

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

    async function hydrateProjectFolderStatuses() {
      const updates = await Promise.all(
        localProjects.map(async (project) => ({
          id: project.id,
          status: await resolveStoredProjectFolderStatus(project.id)
        }))
      );

      if (cancelled.value) {
        return;
      }

      setLocalProjects((current) =>
        current.map((project) => {
          const next = updates.find((candidate) => candidate.id === project.id);

          if (!next || !project.folder || project.folder.status === next.status) {
            return project;
          }

          return {
            ...project,
            folder: {
              ...project.folder,
              status: next.status
            }
          };
        })
      );
    }

    void hydrateProjectFolderStatuses();

    return () => {
      cancelled.value = true;
    };
  }, []);

  useEffect(() => {
    const cancelled = { value: false };

    void loadRuntimeSnapshot(cancelled);

    const interval = window.setInterval(() => {
      void loadRuntimeSnapshot(cancelled);
    }, hasActiveRuntimeRuns ? 1500 : 4000);

    return () => {
      cancelled.value = true;
      window.clearInterval(interval);
    };
  }, [hasActiveRuntimeRuns]);

  useEffect(() => {
    if (!backendConnected) {
      setRuntimeRepoSnapshot(null);
      setRuntimeRepoError(null);
      return;
    }

    const cancelled = { value: false };

    async function loadBranches() {
      try {
        const snapshot = await fetchRuntimeBranches();

        if (cancelled.value) {
          return;
        }

        setRuntimeRepoSnapshot(snapshot);
        setRuntimeRepoError(null);
      } catch {
        if (cancelled.value) {
          return;
        }

        setRuntimeRepoSnapshot(null);
      }
    }

    void loadBranches();

    const interval = window.setInterval(() => {
      void loadBranches();
    }, 10000);

    return () => {
      cancelled.value = true;
      window.clearInterval(interval);
    };
  }, [backendConnected]);

  useEffect(() => {
    saveStoredLocalProjects(localProjects);
  }, [localProjects]);

  const runtimeProject = useMemo(() => {
    const base = workspaceProjects[0];

    if (!base) {
      return null;
    }

    return {
      ...base,
      branchLabel: runtimeRepoSnapshot?.currentBranch ?? null
    };
  }, [runtimeRepoSnapshot?.currentBranch]);

  const visibleProjects = useMemo(
    () => (runtimeProject ? [runtimeProject, ...localProjects] : [...localProjects]),
    [localProjects, runtimeProject]
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
          runtimeAttachmentPreviewsByTaskId,
          runtimeTracesByTaskId,
          pendingLiveFollowUpsByThreadId,
          localFileEffectsByTaskId
        )
      })),
    [
      draftThreadsByProject,
      localFileEffectsByTaskId,
      pendingLiveFollowUpsByThreadId,
      runtimeAttachmentPreviewsByTaskId,
      runtimeTasks,
      runtimeTracesByTaskId,
      visibleProjects
    ]
  );

  const activeProject =
    visibleProjects.find((candidate) => candidate.id === selectedProjectId) ?? visibleProjects[0] ?? null;
  const activeThreadId = activeProject ? selectedThreadIds[activeProject.id] ?? null : null;
  const activeGroup = activeProject
    ? threadGroups.find((candidate) => candidate.project.id === activeProject.id) ?? null
    : null;
  const activeThread =
    activeGroup?.threads.find((candidate) => candidate.id === activeThreadId) ?? null;
  const activeLiveRunIds =
    activeThread?.source === "live" ? activeThread.liveRuntime?.runIds ?? [] : [];
  const activeLiveRunIdsKey = activeLiveRunIds.join("|");
  const activeLiveRuns = useMemo(() => {
    if (activeLiveRunIds.length === 0) {
      return [];
    }

    const runtimeTasksById = new Map(runtimeTasks.map((candidate) => [candidate.id, candidate]));

    return activeLiveRunIds.flatMap((runId) => {
      const run = runtimeTasksById.get(runId);
      return run ? [run] : [];
    });
  }, [activeLiveRunIds, activeLiveRunIdsKey, runtimeTasks]);
  const activeLiveRunStatusKey = activeLiveRuns
    .map((candidate) => `${candidate.id}:${candidate.status}`)
    .join("|");
  const activeLiveTraceAvailabilityKey = activeLiveRuns
    .map((candidate) => `${candidate.id}:${runtimeTracesByTaskId[candidate.id] ? "1" : "0"}`)
    .join("|");

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

  useEffect(() => {
    if (activeLiveRuns.length === 0) {
      return;
    }

    const cancelled = { value: false };

    async function loadTraceSnapshots() {
      const runsToHydrate = activeLiveRuns.filter(
        (candidate) =>
          candidate.status === "pending" ||
          candidate.status === "running" ||
          !runtimeTracesByTaskId[candidate.id]
      );

      if (runsToHydrate.length === 0) {
        return;
      }

      const results = await Promise.allSettled(
        runsToHydrate.map(async (candidate) => ({
          id: candidate.id,
          trace: (await fetchRuntimeTrace(candidate.id)).trace
        }))
      );

      if (cancelled.value) {
        return;
      }

      setRuntimeTracesByTaskId((current) => {
        let changed = false;
        const next = { ...current };

        results.forEach((result, index) => {
          const candidate = runsToHydrate[index];

          if (!candidate) {
            return;
          }

          if (result.status === "fulfilled") {
            next[candidate.id] = result.value.trace;
            changed = true;
          } else if (
            candidate.status !== "running" &&
            candidate.status !== "pending" &&
            candidate.id in next
          ) {
            delete next[candidate.id];
            changed = true;
          }
        });

        return changed ? next : current;
      });
    }

    void loadTraceSnapshots();

    const hasActiveTracePollingTarget = activeLiveRuns.some(
      (candidate) => candidate.status === "pending" || candidate.status === "running"
    );

    if (!hasActiveTracePollingTarget) {
      return () => {
        cancelled.value = true;
      };
    }

    const interval = window.setInterval(() => {
      void loadTraceSnapshots();
    }, activeLiveRuns.some((candidate) => candidate.status === "running") ? 900 : 1500);

    return () => {
      cancelled.value = true;
      window.clearInterval(interval);
    };
  }, [
    activeThread?.id,
    activeLiveRunStatusKey,
    activeLiveTraceAvailabilityKey
  ]);

  useEffect(() => {
    const localProjectsById = new Map(
      visibleProjects
        .filter((project) => project.kind === "local")
        .map((project) => [project.id, project])
    );

    for (const task of runtimeTasks) {
      if (
        task.status !== "completed" ||
        !task.result?.responseText ||
        localFileApplicationsInFlightRef.current.has(task.id) ||
        localFileEffectsByTaskId[task.id]
      ) {
        continue;
      }

      const projectId = getRuntimeTaskProjectId(task);
      const project = localProjectsById.get(projectId);

      if (!project) {
        continue;
      }

      const parsedPlan = extractLocalFilePlan(task.result.responseText);

      if (!parsedPlan.plan && !parsedPlan.error) {
        continue;
      }

      localFileApplicationsInFlightRef.current.add(task.id);
      setLocalFileEffectsByTaskId((current) => ({
        ...current,
        [task.id]: {
          taskId: task.id,
          projectId,
          status: "applying",
          summary: "Applying the local file plan inside the connected folder.",
          timestamp: new Date().toISOString(),
          files: [],
          details: [],
          error: null
        }
      }));

      void (async () => {
        try {
          const handle = await getProjectDirectoryHandle(project.id);
          const effect = handle
            ? await applyLocalFilePlan({
                taskId: task.id,
                project,
                handle,
                responseText: task.result?.responseText ?? null
              })
            : {
                taskId: task.id,
                projectId: project.id,
                status: "failed" as const,
                summary:
                  "Local workspace apply failed: reconnect the selected folder before applying file changes.",
                timestamp: new Date().toISOString(),
                files: [],
                details: [],
                error:
                  "Reconnect the selected folder before applying file changes."
              };

          setLocalFileEffectsByTaskId((current) => ({
            ...current,
            [task.id]: effect
          }));

          const accessFailure =
            effect.error?.includes("Reconnect the selected folder") ||
            effect.error?.includes("write access");

          if (effect.status === "applied" || accessFailure) {
            setLocalProjects((current) =>
              current.map((candidate) =>
                candidate.id === project.id && candidate.folder
                  ? {
                      ...candidate,
                      folder: {
                        ...candidate.folder,
                        status: effect.status === "applied" ? "connected" : "needs-access"
                      }
                    }
                  : candidate
              )
            );
          }
        } catch (error) {
          setLocalFileEffectsByTaskId((current) => ({
            ...current,
            [task.id]: {
              taskId: task.id,
              projectId: project.id,
              status: "failed",
              summary:
                error instanceof Error
                  ? `Local workspace apply failed: ${error.message}`
                  : "Local workspace apply failed.",
              timestamp: new Date().toISOString(),
              files: [],
              details: [],
              error: error instanceof Error ? error.message : "Local workspace apply failed."
            }
          }));
        } finally {
          localFileApplicationsInFlightRef.current.delete(task.id);
        }
      })();
    }
  }, [localFileEffectsByTaskId, runtimeTasks, visibleProjects]);

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

  function handleOpenProjectDialog() {
    setProjectDialogOpen(true);
    setProjectDialogName("");
    setProjectDialogFolder(null);
    setProjectDialogError(null);
    setSubmissionFeedback(null);
  }

  async function handlePickProjectFolder() {
    try {
      const nextFolder = await pickProjectDirectory();

      setProjectDialogFolder(nextFolder);
      setProjectDialogError(null);

      if (!projectDialogName.trim()) {
        setProjectDialogName(nextFolder.folderName);
      }
    } catch (error) {
      setProjectDialogError(
        error instanceof Error ? error.message : "Local folder selection failed."
      );
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!projectDialogFolder) {
      setProjectDialogError("Choose a local folder before creating the project.");
      return;
    }

    const project = createLocalProject({
      name: projectDialogName,
      folderName: projectDialogFolder.folderName
    });

    try {
      await persistProjectDirectoryHandle(project.id, projectDialogFolder.handle);
      setLocalProjects((current) => [project, ...current]);
      setSelectedProjectId(project.id);
      setSelectedThreadIds((current) => ({
        ...current,
        [project.id]: null
      }));
      setProjectDialogOpen(false);
      setProjectDialogName("");
      setProjectDialogFolder(null);
      setProjectDialogError(null);
      setActiveNav("projects");
      setSubmissionFeedback({
        tone: "success",
        text: `${project.name} is now connected to the local folder ${project.folder?.name ?? project.name}.`
      });
    } catch (error) {
      setProjectDialogError(
        error instanceof Error ? error.message : "Failed to persist the local folder connection."
      );
    }
  }

  function handleCreateThread(projectId = activeProject?.id) {
    const projectToUse = visibleProjects.find((candidate) => candidate.id === projectId);

    if (!projectToUse) {
      return;
    }

    const thread = createDraftThread(projectToUse.name);

    setDraftThreadsByProject((current) => ({
      ...current,
      [projectToUse.id]: [thread, ...(current[projectToUse.id] ?? [])]
    }));
    setSelectedThreadIds((current) => ({
      ...current,
      [projectToUse.id]: thread.id
    }));
    setSelectedProjectId(projectToUse.id);
    setActiveNav("projects");
    setComposerValue("");
    setComposerAttachments([]);
    setComposerMode("text");
    setSubmissionFeedback(null);
  }

  function handleRequestSteer() {
    setActiveNav("projects");
    setComposerMode("text");
    setComposerFocusRequestKey((current) => current + 1);
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

    const submittedAttachments = composerAttachments;
    const canSendToRuntime = backendConnected;
    const isLiveThreadFollowUp =
      canSendToRuntime &&
      activeThread?.source === "live" &&
      Boolean(activeThread.liveRuntime?.threadId);

    if (isLiveThreadFollowUp && activeThread?.liveRuntime) {
      const followUpDraft = createQueuedFollowUpDraft(instruction, submittedAttachments);
      const threadId = activeThread.liveRuntime.threadId;

      setPendingLiveFollowUpsByThreadId((current) => ({
        ...current,
        [threadId]: [...(current[threadId] ?? []), followUpDraft]
      }));
      setActiveNav("projects");
      setComposerValue("");
      setComposerAttachments([]);
      setComposerMode("text");
      setSubmitting(true);
      setSubmissionFeedback({
        tone: "info",
        text: "Follow-up staged behind the current run."
      });

      try {
        const runtimeContext = buildRuntimeContextForProject(
          activeProject,
          runtimeTasks,
          localFileEffectsByTaskId
        );
        const response = await submitRuntimeTask({
          instruction,
          title: activeThread.title,
          threadId,
          parentRunId: activeThread.liveRuntime.latestRunId,
          attachments: submittedAttachments,
          project: activeProject,
          context: runtimeContext
        });

        setRuntimeTasks((current) => upsertRuntimeTask(current, response.task));

        if (submittedAttachments.length > 0) {
          setRuntimeAttachmentPreviewsByTaskId((current) => ({
            ...current,
            [response.task.id]: submittedAttachments
          }));
        }

        setPendingLiveFollowUpsByThreadId((current) =>
          removeQueuedFollowUpDraft(current, threadId, followUpDraft.id)
        );
        setSubmissionFeedback({
          tone: "success",
          text:
            activeThread.status === "running" || activeThread.status === "pending"
              ? "Follow-up queued after the active run."
              : "Follow-up added to the thread."
        });

        void loadRuntimeSnapshot();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Task submission failed. Check the runtime API and try again.";

        setPendingLiveFollowUpsByThreadId((current) =>
          removeQueuedFollowUpDraft(current, threadId, followUpDraft.id)
        );
        setSubmissionFeedback({
          tone: "danger",
          text: message
        });
      } finally {
        setSubmitting(false);
      }

      return;
    }

    const draftId = activeThread?.source === "draft" ? activeThread.id : createDraftId();
    const optimisticThread = buildDraftSubmissionThread({
      existingThread: activeThread?.source === "draft" ? activeThread : null,
      threadId: draftId,
      instruction,
      attachments: submittedAttachments,
      backendConnected: canSendToRuntime
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

    if (!canSendToRuntime) {
      setSubmissionFeedback({
        tone: "info",
        text: "Saved locally. Start the runtime to send this thread live."
      });
      return;
    }

    setSubmitting(true);
    setSubmissionFeedback(null);

    try {
      const runtimeContext = buildRuntimeContextForProject(
        activeProject,
        runtimeTasks,
        localFileEffectsByTaskId
      );
      const response = await submitRuntimeTask({
        instruction,
        title: optimisticThread.title,
        attachments: submittedAttachments,
        project: activeProject,
        context: runtimeContext
      });

      setRuntimeTasks((current) => upsertRuntimeTask(current, response.task));

      if (submittedAttachments.length > 0) {
        setRuntimeAttachmentPreviewsByTaskId((current) => ({
          ...current,
          [response.task.id]: submittedAttachments
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
        [activeProject.id]: response.task.threadId
      }));
      setSubmissionFeedback({
        tone: "success",
        text: "Thread accepted by the persistent runtime."
      });

      void loadRuntimeSnapshot();
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

  async function handleVoiceCapture(file: File) {
    const attachment = await buildComposerAttachment(file);

    setComposerAttachments((current) => [...current, attachment]);
    setComposerMode("voice");
    setTranscribingAudio(true);
    setSubmissionFeedback({
      tone: "info",
      text: "Transcribing voice note on the backend..."
    });

    try {
      const response = await transcribeRuntimeAudio({
        file
      });
      const transcript = response.transcription.text.trim();

      setComposerAttachments((current) =>
        current.map((candidate) =>
          candidate.id === attachment.id
            ? {
                ...candidate,
                summary: response.transcription.summary,
                excerpt: response.transcription.excerpt
              }
            : candidate
        )
      );
      setComposerValue((current) => mergeTranscript(current, transcript));
      setComposerMode("text");
      setSubmissionFeedback({
        tone: "success",
        text: "Voice note transcribed and added to the composer."
      });
    } catch (error) {
      setSubmissionFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Voice note transcription failed."
      });
      throw error;
    } finally {
      setTranscribingAudio(false);
    }
  }

  function handleRenameProject(projectId: string) {
    const projectToRename = visibleProjects.find((candidate) => candidate.id === projectId);

    if (!projectToRename || !projectToRename.removable) {
      return;
    }

    const nextName = window.prompt("Rename project", projectToRename.name)?.trim();

    if (!nextName) {
      return;
    }

    setLocalProjects((current) =>
      current.map((candidate) =>
        candidate.id === projectId
          ? {
              ...candidate,
              name: nextName,
              code: deriveProjectCode(nextName)
            }
          : candidate
      )
    );
  }

  async function handleReconnectProjectFolder(projectId: string) {
    const projectToReconnect = visibleProjects.find((candidate) => candidate.id === projectId);

    if (!projectToReconnect || projectToReconnect.kind !== "local") {
      return;
    }

    try {
      const nextFolder = await pickProjectDirectory();

      await persistProjectDirectoryHandle(projectId, nextFolder.handle);
      setLocalProjects((current) =>
        current.map((candidate) =>
          candidate.id === projectId
            ? updateLocalProjectFolder(candidate, nextFolder.folderName, "connected")
            : candidate
        )
      );
      setSubmissionFeedback({
        tone: "success",
        text: `${projectToReconnect.name} is now connected to ${nextFolder.folderName}.`
      });
    } catch (error) {
      setSubmissionFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Could not reconnect the local project folder."
      });
    }
  }

  async function handleRefreshRuntimeBranches() {
    setRuntimeRepoLoading(true);

    try {
      const snapshot = await fetchRuntimeBranches();
      setRuntimeRepoSnapshot(snapshot);
      setRuntimeRepoError(null);
    } catch (error) {
      setRuntimeRepoError(
        error instanceof Error ? error.message : "Runtime repo branches are unavailable."
      );
    } finally {
      setRuntimeRepoLoading(false);
    }
  }

  async function handleSwitchRuntimeBranch(branchName: string) {
    setRuntimeRepoSwitchingBranchName(branchName);

    try {
      const snapshot = await switchRuntimeBranch(branchName);

      setRuntimeRepoSnapshot(snapshot);
      setRuntimeRepoError(null);
      setSubmissionFeedback({
        tone: "success",
        text: `Runtime workspace switched to ${branchName}.`
      });
      void loadRuntimeSnapshot();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not switch the runtime workspace branch.";

      setRuntimeRepoError(message);
      setSubmissionFeedback({
        tone: "danger",
        text: message
      });
    } finally {
      setRuntimeRepoSwitchingBranchName(null);
    }
  }

  async function handleRuntimeApprovalDecision(
    runId: string,
    gateId: string,
    decision: RuntimeOperatorApprovalDecision,
    comment: string
  ) {
    setSubmissionFeedback({
      tone: "info",
      text:
        decision === "approve"
          ? "Approving the gate and resuming the run."
          : decision === "reject"
            ? "Rejecting the gate and keeping the run paused."
            : "Requesting a retry before the gated phase resumes."
    });

    try {
      const response = await submitRuntimeApprovalDecision(runId, {
        gateId,
        decision,
        comment
      });

      setRuntimeTasks((current) => upsertRuntimeTask(current, response.task));
      setSubmissionFeedback({
        tone: "success",
        text:
          decision === "approve"
            ? "Approval recorded and the run is back in the queue."
            : decision === "reject"
              ? "Rejection recorded. The run remains paused."
              : "Retry requested and the run is back in the queue."
      });

      void loadRuntimeSnapshot();
    } catch (error) {
      setSubmissionFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Could not resolve the approval gate."
      });
    }
  }

  async function handleDeleteProject(projectId: string) {
    const projectToDelete = visibleProjects.find((candidate) => candidate.id === projectId);

    if (!projectToDelete?.removable) {
      setSubmissionFeedback({
        tone: "info",
        text: "The live runtime workspace stays pinned in the sidebar."
      });
      return;
    }

    await removePersistedProjectDirectoryHandle(projectId);
    setLocalProjects((current) => current.filter((candidate) => candidate.id !== projectId));
    setDraftThreadsByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    setSelectedThreadIds((current) => {
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
    <>
      <main className="app-shell">
        <Sidebar
          groups={threadGroups}
          activeProjectId={activeProject?.id ?? null}
          activeThreadId={activeThreadId}
          activeNav={activeNav}
          activeProject={activeProject}
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
          onCreateProject={handleOpenProjectDialog}
          onCreateThread={handleCreateThread}
          onReconnectProjectFolder={handleReconnectProjectFolder}
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
          runtimeRepoSnapshot={runtimeRepoSnapshot}
          runtimeRepoLoading={runtimeRepoLoading}
          runtimeRepoSwitchingBranchName={runtimeRepoSwitchingBranchName}
          runtimeRepoError={runtimeRepoError}
          instructions={instructions}
          composerMode={composerMode}
          composerValue={composerValue}
          composerAttachments={composerAttachments}
          composerFocusRequestKey={composerFocusRequestKey}
          feedback={feedback}
          submitting={submitting}
          transcribingAudio={transcribingAudio}
          backendConnected={backendConnected}
          onComposerModeChange={setComposerMode}
          onComposerValueChange={setComposerValue}
          onComposerAttachmentsChange={setComposerAttachments}
          onVoiceCapture={handleVoiceCapture}
          onVoiceCaptureError={(message) =>
            setSubmissionFeedback({
              tone: "danger",
              text: message
            })
          }
          onSelectSuggestion={(prompt) => {
            setActiveNav("projects");
            setComposerMode("text");
            setComposerValue(prompt);
          }}
          onReconnectProjectFolder={handleReconnectProjectFolder}
          onRefreshRuntimeBranches={handleRefreshRuntimeBranches}
          onSwitchRuntimeBranch={handleSwitchRuntimeBranch}
          onRequestSteer={handleRequestSteer}
          onApprovalDecision={handleRuntimeApprovalDecision}
          onSubmit={handleSubmitTask}
        />
      </main>

      <NewProjectDialog
        open={projectDialogOpen}
        projectName={projectDialogName}
        folderName={projectDialogFolder?.folderName ?? null}
        pickerSupported={projectPickerSupported}
        error={projectDialogError}
        onProjectNameChange={setProjectDialogName}
        onPickFolder={handlePickProjectFolder}
        onClose={() => {
          setProjectDialogOpen(false);
          setProjectDialogError(null);
        }}
        onSubmit={handleCreateProject}
      />
    </>
  );
}

function buildThreadsForProject(
  project: WorkspaceProject,
  runtimeTasks: RuntimeTask[],
  draftThreads: WorkspaceThread[],
  runtimeAttachmentPreviewsByTaskId: Record<string, ComposerAttachment[]>,
  runtimeTracesByTaskId: Record<string, RuntimeTraceRunLog>,
  pendingLiveFollowUpsByThreadId: Record<string, RuntimeQueuedFollowUpDraft[]>,
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>
) {
  const projectRuntimeTasks = runtimeTasks.filter(
    (task) => getRuntimeTaskProjectId(task) === project.id
  );

  return [
    ...draftThreads,
    ...groupRuntimeTasksByThread(projectRuntimeTasks).map((threadRuns) =>
      buildRuntimeThread(
        threadRuns,
        runtimeAttachmentPreviewsByTaskId,
        runtimeTracesByTaskId,
        pendingLiveFollowUpsByThreadId[threadRuns[0]?.threadId ?? ""] ?? [],
        localFileEffectsByTaskId
      )
    )
  ];
}

function buildRuntimeContextForProject(
  project: WorkspaceProject,
  runtimeTasks: RuntimeTask[],
  localFileEffectsByTaskId: Record<string, LocalFileExecutionEffect>
): RuntimeTaskSubmitContext | undefined {
  if (project.kind !== "local") {
    return undefined;
  }

  const recentEffects = runtimeTasks
    .filter((task) => getRuntimeTaskProjectId(task) === project.id)
    .map((task) => localFileEffectsByTaskId[task.id] ?? null)
    .filter(
      (effect): effect is LocalFileExecutionEffect =>
        effect !== null && (effect.status === "applied" || effect.status === "failed")
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 4);

  const recentFilePaths = [...new Set(recentEffects.flatMap((effect) => effect.files))].slice(0, 12);
  const recentFailure = recentEffects.find((effect) => effect.status === "failed");

  return {
    objective: `Work inside the connected local folder "${project.folder?.displayPath ?? project.folder?.name ?? project.name}" and prepare file changes that should be applied directly to that workspace.`,
    constraints: [
      "When the request requires filesystem changes for this local project, append a <local-file-plan> block with mkdir/write_file/delete_file operations.",
      "Use relative paths rooted at the connected local project folder.",
      "Do not claim files were created, updated, or deleted unless they are represented in the local file plan block.",
      recentFailure
        ? `Recent local workspace apply failure: ${recentFailure.error ?? recentFailure.summary}`
        : "Recent local workspace applies are available below as relevant files and validation targets."
    ],
    relevantFiles: recentFilePaths.map((path) => ({
      path,
      source: "local-file-bridge",
      reason: "Recently created or updated in the connected local folder."
    })),
    externalContext: [],
    validationTargets: recentFilePaths.slice(0, 8)
  };
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
    ? "Accepted by the runtime service and waiting for execution."
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

function createQueuedFollowUpDraft(
  instruction: string,
  attachments: ComposerAttachment[]
): RuntimeQueuedFollowUpDraft {
  return {
    id: `queued-${crypto.randomUUID()}`,
    instruction,
    createdAt: new Date().toISOString(),
    attachments
  };
}

function removeQueuedFollowUpDraft(
  draftsByThreadId: Record<string, RuntimeQueuedFollowUpDraft[]>,
  threadId: string,
  followUpId: string
) {
  const nextFollowUps = (draftsByThreadId[threadId] ?? []).filter(
    (candidate) => candidate.id !== followUpId
  );

  if (nextFollowUps.length === 0) {
    const next = { ...draftsByThreadId };
    delete next[threadId];
    return next;
  }

  return {
    ...draftsByThreadId,
    [threadId]: nextFollowUps
  };
}

function upsertRuntimeTask(currentTasks: RuntimeTask[], task: RuntimeTask) {
  return [task, ...currentTasks.filter((candidate) => candidate.id !== task.id)];
}

function getRuntimeTaskProjectId(task: RuntimeTask) {
  return task.project?.id?.trim() || defaultRuntimeProjectId;
}

function groupRuntimeTasksByThread(runtimeTasks: RuntimeTask[]) {
  const runsByThreadId = new Map<string, RuntimeTask[]>();

  for (const task of runtimeTasks) {
    const threadId = task.threadId || task.id;
    const existing = runsByThreadId.get(threadId) ?? [];
    existing.push(task);
    runsByThreadId.set(threadId, existing);
  }

  return [...runsByThreadId.values()].sort(
    (left, right) =>
      getThreadSortTimestamp(right).localeCompare(getThreadSortTimestamp(left))
  );
}

function getThreadSortTimestamp(runs: RuntimeTask[]) {
  return runs.reduce(
    (latest, run) => {
      const candidate = run.completedAt ?? run.startedAt ?? run.createdAt;
      return candidate.localeCompare(latest) > 0 ? candidate : latest;
    },
    runs[0]?.completedAt ?? runs[0]?.startedAt ?? runs[0]?.createdAt ?? ""
  );
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

function mergeTranscript(currentValue: string, transcript: string) {
  const trimmedCurrent = currentValue.trim();
  const trimmedTranscript = transcript.trim();

  if (!trimmedTranscript) {
    return trimmedCurrent;
  }

  if (!trimmedCurrent) {
    return trimmedTranscript;
  }

  return `${trimmedCurrent}\n\nTranscript:\n${trimmedTranscript}`;
}

export default App;
