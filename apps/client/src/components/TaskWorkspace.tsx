import type { FormEvent } from "react";
import { useId, useRef } from "react";

import type {
  ComposerAttachment,
  ComposerMode,
  ModeOption,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  SidebarNavItemId,
  WorkspaceProject,
  WorkspaceThread
} from "../types";

type TaskWorkspaceProps = {
  activeNav: SidebarNavItemId;
  project: WorkspaceProject | null;
  projectBrief: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeHealth: RuntimeHealthResponse | null;
  runtimeStatus: RuntimeStatusResponse | null;
  instructions: RuntimeInstructionResponse | null;
  mode: ModeOption;
  modeOptions: Array<{ id: ModeOption; label: string; detail: string }>;
  composerMode: ComposerMode;
  composerValue: string;
  composerAttachments: ComposerAttachment[];
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  simulateFailure: boolean;
  backendConnected: boolean;
  repositoryUrl: string;
  onModeChange: (mode: ModeOption) => void;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onComposerAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onSimulateFailureChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onHandoff: () => void;
  onOpenSettings: () => void;
};

export function TaskWorkspace({
  activeNav,
  project,
  projectBrief,
  thread,
  runtimeHealth,
  runtimeStatus,
  instructions,
  mode,
  modeOptions,
  composerMode,
  composerValue,
  composerAttachments,
  feedback,
  submitting,
  simulateFailure,
  backendConnected,
  repositoryUrl,
  onModeChange,
  onComposerModeChange,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onSimulateFailureChange,
  onSubmit,
  onHandoff,
  onOpenSettings
}: TaskWorkspaceProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileSelection(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const nextAttachments = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type || inferFileType(file.name)
    }));

    onComposerAttachmentsChange([...composerAttachments, ...nextAttachments]);
  }

  const composerPlaceholder =
    composerMode === "image"
      ? "Describe the image task or attach media..."
      : composerMode === "voice"
        ? "Voice mode is staged. Type the instruction or attach files..."
        : "Ask for follow-up changes";

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div className="workspace__title">
          <p>{project?.name ?? "Shipyard"}</p>
          <h2>{thread?.title ?? "New thread"}</h2>
        </div>

        <div className="workspace__actions">
          <div className="workspace__modes">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`workspace__mode ${option.id === mode ? "is-active" : ""}`}
                onClick={() => onModeChange(option.id)}
                title={option.detail}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button type="button" className="workspace__action-button" onClick={onHandoff}>
            Handoff
          </button>
          <a className="workspace__action-button" href={repositoryUrl} target="_blank" rel="noreferrer">
            Repo
          </a>
          <button type="button" className="workspace__icon-button" aria-label="Open settings" onClick={onOpenSettings}>
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="workspace__content">
        {activeNav === "settings" ? (
          <section className="settings-panel">
            <div className="settings-panel__row">
              <strong>Runtime</strong>
              <span>{backendConnected ? "Live" : "Offline"}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Worker</strong>
              <span>{runtimeStatus?.workerState ?? "offline"}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Queued runs</strong>
              <span>{runtimeStatus?.queuedRuns ?? 0}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Total runs</strong>
              <span>{runtimeStatus?.totalRuns ?? 0}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Skill</strong>
              <span>{instructions?.skill.meta.name ?? "Unavailable"}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Direction</strong>
              <span>{projectBrief.nextStep}</span>
            </div>
            <div className="settings-panel__row">
              <strong>Instruction runtime</strong>
              <span>{runtimeHealth?.instructions.loadedAt ?? "Unavailable"}</span>
            </div>
          </section>
        ) : (
          <section className="conversation">
            <div className="conversation__status">
              <span>{backendConnected ? "Runtime live" : "Runtime offline"}</span>
              <span>{thread?.updatedLabel ?? "No session selected"}</span>
            </div>

            <div className="conversation__scroll">
              {thread?.messages.length ? (
                thread.messages.map((message) => (
                  <article key={message.id} className={`message message--${message.role}`}>
                    <div className="message__meta">
                      <strong>{message.label}</strong>
                      <span>{message.timestamp}</span>
                    </div>
                    <p>{message.body}</p>
                  </article>
                ))
              ) : (
                <div className="conversation__empty">
                  <h3>Start a thread</h3>
                  <p>Use the composer below to send a task to the runtime.</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        {composerAttachments.length > 0 ? (
          <div className="composer__attachments">
            {composerAttachments.map((attachment) => (
              <span key={attachment.id} className="attachment-chip">
                <span>{attachment.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    onComposerAttachmentsChange(
                      composerAttachments.filter((candidate) => candidate.id !== attachment.id)
                    )
                  }
                  aria-label={`Remove ${attachment.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="composer__field">
          <textarea
            value={composerValue}
            onChange={(event) => onComposerValueChange(event.target.value)}
            placeholder={composerPlaceholder}
            rows={5}
          />
        </div>

        <div className="composer__toolbar">
          <div className="composer__tools">
            <button
              type="button"
              className="composer__tool-button composer__tool-button--icon"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload files"
            >
              <PlusIcon />
            </button>

            <label htmlFor={fileInputId} className="composer__file-trigger">
              Upload
            </label>

            <button
              type="button"
              className={`composer__tool-button ${composerMode === "text" ? "is-active" : ""}`}
              onClick={() => onComposerModeChange("text")}
            >
              Text
            </button>
            <button
              type="button"
              className={`composer__tool-button ${composerMode === "image" ? "is-active" : ""}`}
              onClick={() => onComposerModeChange("image")}
            >
              Image
            </button>
            <button
              type="button"
              className={`composer__tool-button ${composerMode === "voice" ? "is-active" : ""}`}
              onClick={() => onComposerModeChange("voice")}
            >
              <MicIcon />
              <span>Mic</span>
            </button>

            <label className="composer__toggle">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(event) => onSimulateFailureChange(event.target.checked)}
              />
              <span>Fail path</span>
            </label>
          </div>

          <button
            type="submit"
            className="composer__submit"
            disabled={submitting || project?.kind !== "live" || !backendConnected}
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>

        {feedback ? <p className={`composer__feedback composer__feedback--${feedback.tone}`}>{feedback.text}</p> : null}

        <input
          id={fileInputId}
          ref={fileInputRef}
          className="composer__file-input"
          type="file"
          multiple
          accept=".png,.pdf,.csv,image/*"
          onChange={(event) => {
            handleFileSelection(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </form>
    </section>
  );
}

function inferFileType(fileName: string) {
  if (fileName.toLowerCase().endsWith(".pdf")) {
    return "application/pdf";
  }

  if (fileName.toLowerCase().endsWith(".csv")) {
    return "text/csv";
  }

  return "application/octet-stream";
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 5.5h4.3v9H4.5zM11.2 5.5h4.3v4.3h-4.3zM11.2 11.2h4.3v3.8h-4.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 4.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM6.5 9.8a3.5 3.5 0 0 0 7 0M10 13.3v2.2M7.8 15.5h4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
