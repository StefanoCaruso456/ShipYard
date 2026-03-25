import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { createRecordedAudioFile, pickPreferredAudioMimeType } from "../audio";
import { buildComposerAttachments } from "../attachments";
import type { ComposerAttachment, ComposerMode, WorkspaceProject } from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

type ComposerProps = {
  project: WorkspaceProject | null;
  composerMode: ComposerMode;
  composerValue: string;
  attachments: ComposerAttachment[];
  steerMode: {
    status: "pending" | "running";
    queuedCount: number;
    threadTitle: string;
  } | null;
  focusRequestKey: number;
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  transcribingAudio: boolean;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onVoiceCapture: (file: File) => Promise<void>;
  onVoiceCaptureError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  project,
  composerMode,
  composerValue,
  attachments,
  steerMode,
  focusRequestKey,
  feedback,
  submitting,
  transcribingAudio,
  onComposerModeChange,
  onComposerValueChange,
  onAttachmentsChange,
  onVoiceCapture,
  onVoiceCaptureError,
  onSubmit
}: ComposerProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordingState, setRecordingState] = useState<"idle" | "starting" | "recording">("idle");
  const hasDraftContent = composerValue.trim().length > 0 || attachments.length > 0;
  const canSubmit = Boolean(project) && !submitting && !transcribingAudio && hasDraftContent;
  const placeholder =
    recordingState === "recording"
      ? "Recording voice note..."
      : transcribingAudio
        ? "Transcribing voice note..."
        : steerMode
          ? "Ask for follow-up changes"
        : composerMode === "image"
          ? "Describe the image task..."
          : composerMode === "voice"
            ? "Record a voice note or type the instruction..."
            : "Ask Codex anything...";

  useEffect(() => {
    return () => {
      stopActiveStream();
    };
  }, []);

  useEffect(() => {
    if (focusRequestKey <= 0) {
      return;
    }

    textareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length
    );
  }, [focusRequestKey]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const nextAttachments = await buildComposerAttachments(fileList);

    onAttachmentsChange([...attachments, ...nextAttachments]);
  }

  async function handleMicClick() {
    if (recordingState === "recording") {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (recordingState === "starting" || transcribingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onVoiceCaptureError("Microphone capture is not supported in this browser.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      onVoiceCaptureError("MediaRecorder is not available in this browser.");
      return;
    }

    setRecordingState("starting");
    onComposerModeChange("voice");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickPreferredAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm"
        });
        const file = createRecordedAudioFile(blob);

        stopActiveStream();
        setRecordingState("idle");
        chunksRef.current = [];

        try {
          await onVoiceCapture(file);
        } catch (error) {
          onVoiceCaptureError(
            error instanceof Error ? error.message : "Voice note processing failed."
          );
        }
      });

      recorder.addEventListener("error", () => {
        stopActiveStream();
        setRecordingState("idle");
        onVoiceCaptureError("Microphone capture failed.");
      });

      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      stopActiveStream();
      setRecordingState("idle");
      onVoiceCaptureError(
        error instanceof Error ? error.message : "Microphone permission was denied."
      );
    }
  }

  function stopActiveStream() {
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      {steerMode ? (
        <div className="composer__steer">
          <div className="composer__steer-copy">
            <span className="composer__steer-badge">Steer</span>
            <strong>
              {steerMode.status === "running"
                ? "Queue a follow-up without interrupting the current run"
                : "Queue the next prompt on this live thread"}
            </strong>
            <p>
              {steerMode.queuedCount > 0
                ? `${steerMode.queuedCount} follow-up${steerMode.queuedCount === 1 ? "" : "s"} already staged for ${steerMode.threadTitle}.`
                : `${steerMode.threadTitle} stays active while your next prompt waits its turn.`}
            </p>
          </div>
        </div>
      ) : null}

      <AttachmentPreviewList
        attachments={attachments}
        onRemove={(attachmentId) =>
          onAttachmentsChange(attachments.filter((candidate) => candidate.id !== attachmentId))
        }
      />

      <div className="composer__field">
        <textarea
          ref={textareaRef}
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
              className={`composer__tool-button ${recordingState !== "idle" || transcribingAudio ? "is-active" : ""}`}
              onClick={() => void handleMicClick()}
              disabled={transcribingAudio}
            >
              <MicIcon />
              <span>
                {recordingState === "recording"
                  ? "Stop"
                  : transcribingAudio
                    ? "Transcribing"
                    : "Mic"}
              </span>
            </button>
          </div>

          <div className="composer__actions">
            <button
              type="submit"
              className={`composer__submit ${canSubmit ? "composer__submit--active" : ""}`}
              disabled={!canSubmit}
              aria-label={submitting ? "Sending" : transcribingAudio ? "Transcribing audio" : "Send message"}
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
