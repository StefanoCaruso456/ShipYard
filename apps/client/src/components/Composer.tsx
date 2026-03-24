import type { FormEvent } from "react";
import { useId, useRef } from "react";

import type { ComposerAttachment, ComposerMode, WorkspaceProject } from "../types";

type ComposerProps = {
  project: WorkspaceProject | null;
  composerMode: ComposerMode;
  composerValue: string;
  attachments: ComposerAttachment[];
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  backendConnected: boolean;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  project,
  composerMode,
  composerValue,
  attachments,
  feedback,
  submitting,
  backendConnected,
  onComposerModeChange,
  onComposerValueChange,
  onAttachmentsChange,
  onSubmit
}: ComposerProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const placeholder =
    composerMode === "image"
      ? "Describe the image task..."
      : composerMode === "voice"
        ? "Mic mode is staged. Type the instruction or attach files..."
        : "Ask Codex anything...";

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const nextAttachments = Array.from(fileList).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type || inferFileType(file.name)
    }));

    onAttachmentsChange([...attachments, ...nextAttachments]);
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="attachment-chip">
              <span>{attachment.name}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onAttachmentsChange(attachments.filter((candidate) => candidate.id !== attachment.id))}
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
          placeholder={placeholder}
          rows={4}
        />
        <div className="composer__toolbar">
          <div className="composer__tools">
            <button
              type="button"
              className="composer__tool-button composer__tool-button--icon"
              aria-label="Upload files"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon />
            </button>
            <label htmlFor={fileInputId} className="composer__tool-button">
              Upload
            </label>
            <button type="button" className="composer__tool-button" aria-label="Command menu">
              <CommandIcon />
              <span>Command</span>
            </button>
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
          </div>

          <div className="composer__actions">
            <span className={`runtime-pill runtime-pill--${backendConnected ? "ok" : "error"}`}>
              {backendConnected ? "idle" : "error"}
            </span>
            <button
              type="submit"
              className="composer__submit"
              disabled={submitting || !project}
            >
              {submitting ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
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
          handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </form>
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CommandIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6.5 5.5a1.7 1.7 0 1 1 0 3.4H5.2v2.2h1.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 1 1 0-3.4h1.3V8.9H6.5a1.7 1.7 0 1 1 0-3.4zM13.5 5.5a1.7 1.7 0 1 1 0 3.4h-1.3v2.2h1.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 1 1 0-3.4h-1.3V8.9h1.3a1.7 1.7 0 1 1 0-3.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
