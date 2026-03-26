import type { FormEvent } from "react";

import type {
  ComposerAttachment,
  ComposerMode,
  ProjectPayload,
  RuntimeInstructionResponse,
  RuntimeOperatorApprovalDecision,
  RuntimeStatusResponse,
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
  instructions: RuntimeInstructionResponse | null;
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
  onVoiceCapture: (file: File) => Promise<void>;
  onVoiceCaptureError: (message: string) => void;
  onSelectSuggestion: (prompt: string) => void;
  onReconnectProjectFolder: (projectId: string) => Promise<void>;
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
  instructions,
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
  onVoiceCapture,
  onVoiceCaptureError,
  onSelectSuggestion,
  onReconnectProjectFolder,
  onRequestSteer,
  onApprovalDecision,
  onSubmit
}: TaskWorkspaceProps) {
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

  return (
    <section className="workspace">
      <div className="workspace__content">
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
            suggestions={suggestionCards}
            onSelectSuggestion={onSelectSuggestion}
            onReconnectProjectFolder={onReconnectProjectFolder}
            onRequestSteer={onRequestSteer}
            onApprovalDecision={onApprovalDecision}
          />
        )}
      </div>

      <Composer
        project={project}
        composerMode={composerMode}
        composerValue={composerValue}
        attachments={composerAttachments}
        steerMode={steerMode}
        focusRequestKey={composerFocusRequestKey}
        feedback={feedback}
        submitting={submitting}
        transcribingAudio={transcribingAudio}
        onComposerModeChange={onComposerModeChange}
        onComposerValueChange={onComposerValueChange}
        onAttachmentsChange={onComposerAttachmentsChange}
        onVoiceCapture={onVoiceCapture}
        onVoiceCaptureError={onVoiceCaptureError}
        onSubmit={onSubmit}
      />
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
