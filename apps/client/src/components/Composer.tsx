import type { FormEvent } from "react";
import { useId, useRef } from "react";

import { buildComposerAttachments } from "../attachments";
import type { ComposerAttachment, ComposerMode, WorkspaceProject } from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

type ComposerProps = {
  project: WorkspaceProject | null;
  composerMode: ComposerMode;
  composerValue: string;
  attachments: ComposerAttachment[];
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
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
  onComposerModeChange,
  onComposerValueChange,
  onAttachmentsChange,
  onSubmit
}: ComposerProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasDraftContent = composerValue.trim().length > 0 || attachments.length > 0;
  const canSubmit = Boolean(project) && !submitting && hasDraftContent;
  const placeholder =
    composerMode === "image"
      ? "Describe the image task..."
      : composerMode === "voice"
        ? "Mic mode is staged. Type the instruction or attach files..."
        : "Ask Codex anything...";

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const nextAttachments = await buildComposerAttachments(fileList);

    onAttachmentsChange([...attachments, ...nextAttachments]);
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <AttachmentPreviewList
        attachments={attachments}
        onRemove={(attachmentId) =>
          onAttachmentsChange(attachments.filter((candidate) => candidate.id !== attachmentId))
        }
      />

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
            <button
              type="button"
              className={`composer__tool-button ${composerMode === "voice" ? "is-active" : ""}`}
              onClick={() => onComposerModeChange(composerMode === "voice" ? "text" : "voice")}
            >
              <MicIcon />
              <span>Mic</span>
            </button>
          </div>

          <div className="composer__actions">
            <button
              type="submit"
              className={`composer__submit ${canSubmit ? "composer__submit--active" : ""}`}
              disabled={!canSubmit}
              aria-label={submitting ? "Sending" : "Send message"}
            >
              <ArrowUpIcon />
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
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </form>
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

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 15.2V5.2M5.8 9.4 10 5.2l4.2 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
