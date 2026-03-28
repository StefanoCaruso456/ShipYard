import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ComposerAttachment,
  ComposerMode,
  ProjectPayload,
  RuntimeFactoryComposerDraft,
  RuntimeInstructionResponse,
  RuntimeRepoBranchSnapshot,
  RuntimeOperatorApprovalDecision,
  RuntimeStatusResponse,
  RuntimeWorkflowMode,
  SidebarNavItemId,
  WorkspaceProject,
  WorkspaceThread
} from "../types";
import { Composer } from "./Composer";
import { ThreadView } from "./ThreadView";

type TaskWorkspaceProps = {
  activeNav: SidebarNavItemId;
  project: WorkspaceProject | null;
  projectBrief: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeStatus: RuntimeStatusResponse | null;
  runtimeRepoSnapshot: RuntimeRepoBranchSnapshot | null;
  runtimeRepoLoading: boolean;
  runtimeRepoSwitchingBranchName: string | null;
  runtimeRepoError: string | null;
  instructions: RuntimeInstructionResponse | null;
  workflowMode: RuntimeWorkflowMode;
  factoryDraft: RuntimeFactoryComposerDraft;
  composerMode: ComposerMode;
  composerValue: string;
  composerAttachments: ComposerAttachment[];
  composerFocusRequestKey: number;
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  transcribingAudio: boolean;
  backendConnected: boolean;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onComposerAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onWorkflowModeChange: (mode: RuntimeWorkflowMode) => void;
  onFactoryDraftChange: (draft: RuntimeFactoryComposerDraft) => void;
  onVoiceCapture: (file: File) => Promise<void>;
  onVoiceCaptureError: (message: string) => void;
  onSelectSuggestion: (prompt: string) => void;
  onReconnectProjectFolder: (projectId: string) => Promise<void>;
  onRefreshProjectRepository: (projectId: string) => Promise<void>;
  onRefreshRuntimeBranches: () => Promise<void>;
  onSwitchRuntimeBranch: (branchName: string) => Promise<void>;
  onRequestSteer: () => void;
  onApprovalDecision: (
    runId: string,
    gateId: string,
    decision: RuntimeOperatorApprovalDecision,
    comment: string
  ) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskWorkspace({
  activeNav,
  project,
  projectBrief,
  thread,
  runtimeStatus,
  runtimeRepoSnapshot,
  runtimeRepoLoading,
  runtimeRepoSwitchingBranchName,
  runtimeRepoError,
  instructions,
  workflowMode,
  factoryDraft,
  composerMode,
  composerValue,
  composerAttachments,
  composerFocusRequestKey,
  feedback,
  submitting,
  transcribingAudio,
  backendConnected,
  onComposerModeChange,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onWorkflowModeChange,
  onFactoryDraftChange,
  onVoiceCapture,
  onVoiceCaptureError,
  onSelectSuggestion,
  onReconnectProjectFolder,
  onRefreshProjectRepository,
  onRefreshRuntimeBranches,
  onSwitchRuntimeBranch,
  onRequestSteer,
  onApprovalDecision,
  onSubmit
}: TaskWorkspaceProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(112);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const runtimeState = backendConnected
    ? runtimeStatus?.workerState === "running"
      ? "running"
      : "idle"
    : "error";
  const suggestionCards = buildSuggestions(project);
  const steerMode =
    thread?.source === "live" &&
    thread.liveRuntime?.focusedRun &&
    (thread.status === "running" || thread.status === "pending")
      ? {
          status: thread.status,
          queuedCount: thread.liveRuntime.queuedFollowUps.length,
          threadTitle: thread.title,
          activePrompt: thread.liveRuntime.focusedRun.instruction,
          queuedFollowUps: thread.liveRuntime.queuedFollowUps
        }
      : null;
  const threadMessageCount = thread?.messages.length ?? 0;
  const threadProgressCount = thread?.progress.length ?? 0;
  const threadActivityCount = thread?.activity?.length ?? 0;

  useEffect(() => {
    const composerDock = composerDockRef.current;

    if (!composerDock) {
      return;
    }

    const updateComposerHeight = () => {
      setComposerHeight(composerDock.getBoundingClientRect().height);
    };

    updateComposerHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composerDock);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;

    if (!content) {
      setShowJumpToBottom(false);
      return;
    }

    const updateVisibility = () => {
      const distanceFromBottom =
        content.scrollHeight - content.scrollTop - content.clientHeight;
      setShowJumpToBottom(distanceFromBottom > 160);
    };

    updateVisibility();
    content.addEventListener("scroll", updateVisibility, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        content.removeEventListener("scroll", updateVisibility);
      };
    }

    const observer = new ResizeObserver(updateVisibility);
    observer.observe(content);

    return () => {
      content.removeEventListener("scroll", updateVisibility);
      observer.disconnect();
    };
  }, [
    activeNav,
    thread?.id,
    thread?.updatedLabel,
    thread?.status,
    threadMessageCount,
    threadProgressCount,
    threadActivityCount
  ]);

  function handleJumpToBottom() {
    const content = contentRef.current;

    if (!content) {
      return;
    }

    content.scrollTo({
      top: content.scrollHeight,
      behavior: "smooth"
    });
  }

  return (
    <section className="workspace">
      <div ref={contentRef} className="workspace__content">
        {activeNav === "settings" ? (
          <section className="workspace-panel">
            <div className="workspace-panel__header">
              <h3>Runtime settings</h3>
              <span>{backendConnected ? "Connected" : "Offline"}</span>
            </div>
            <div className="settings-grid">
              <div className="settings-grid__row">
                <span>Status</span>
                <strong>{runtimeState}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Queued runs</span>
                <strong>{runtimeStatus?.queuedRuns ?? 0}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Total runs</span>
                <strong>{runtimeStatus?.totalRuns ?? 0}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Instruction skill</span>
                <strong>{instructions?.skill.meta.name ?? "Unavailable"}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Next step</span>
                <strong>{projectBrief.nextStep}</strong>
              </div>
            </div>
          </section>
        ) : (
          <ThreadView
            project={project}
            thread={thread}
            runtimeState={runtimeState}
            runtimeRepo={{
              snapshot: runtimeRepoSnapshot,
              loading: runtimeRepoLoading,
              switchingBranchName: runtimeRepoSwitchingBranchName,
              error: runtimeRepoError
            }}
            suggestions={suggestionCards}
            onSelectSuggestion={onSelectSuggestion}
            onReconnectProjectFolder={onReconnectProjectFolder}
            onRefreshProjectRepository={onRefreshProjectRepository}
            onRefreshRuntimeBranches={onRefreshRuntimeBranches}
            onSwitchRuntimeBranch={onSwitchRuntimeBranch}
            onRequestSteer={onRequestSteer}
            onApprovalDecision={onApprovalDecision}
          />
        )}
      </div>

      {activeNav !== "settings" && thread && showJumpToBottom ? (
        <button
          type="button"
          className="workspace__jump-to-bottom"
          style={{ bottom: `${composerHeight + 16}px` }}
          onClick={handleJumpToBottom}
          aria-label="Jump to the latest message"
        >
          <JumpToBottomIcon />
        </button>
      ) : null}

      <div ref={composerDockRef} className="workspace__composer-dock">
        <Composer
          project={project}
          backendConnected={backendConnected}
          workflowMode={workflowMode}
          factoryDraft={factoryDraft}
          composerMode={composerMode}
          composerValue={composerValue}
          attachments={composerAttachments}
          steerMode={steerMode}
          focusRequestKey={composerFocusRequestKey}
          feedback={feedback}
          submitting={submitting}
          transcribingAudio={transcribingAudio}
          onWorkflowModeChange={onWorkflowModeChange}
          onFactoryDraftChange={onFactoryDraftChange}
          onComposerModeChange={onComposerModeChange}
          onComposerValueChange={onComposerValueChange}
          onAttachmentsChange={onComposerAttachmentsChange}
          onVoiceCapture={onVoiceCapture}
          onVoiceCaptureError={onVoiceCaptureError}
          onSubmit={onSubmit}
        />
      </div>
    </section>
  );
}

function buildSuggestions(project: WorkspaceProject | null) {
  const label = project?.name ?? "Shipyard";

  return [
    {
      id: "suggestion-1",
      title: "Plan the next feature",
      prompt: `Map the next implementation step for ${label} and keep it scoped.`
    },
    {
      id: "suggestion-2",
      title: "Review runtime status",
      prompt: `Summarize the current runtime state for ${label} and identify the next backend task.`
    },
    {
      id: "suggestion-3",
      title: "Refine the frontend shell",
      prompt: `Review the current workspace shell against the frontend UI rules and suggest the next improvement.`
    },
    {
      id: "suggestion-4",
      title: "Draft a coding task",
      prompt: `Create a clear task prompt for the next coding step in ${label}.`
    }
  ];
}

function JumpToBottomIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 4.5v9m0 0-3.5-3.5M10 13.5 13.5 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
