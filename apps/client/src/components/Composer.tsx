import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { createRecordedAudioFile, pickPreferredAudioMimeType } from "../audio";
import { buildComposerAttachments } from "../attachments";
import type {
  ComposerAttachment,
  ComposerMode,
  RuntimeFactoryComposerDraft,
  RuntimeThreadQueuedItem,
  RuntimeWorkflowMode,
  WorkspaceProject
} from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";

type ComposerProps = {
  project: WorkspaceProject | null;
  backendConnected: boolean;
  workflowMode: RuntimeWorkflowMode;
  factoryDraft: RuntimeFactoryComposerDraft;
  composerMode: ComposerMode;
  composerValue: string;
  attachments: ComposerAttachment[];
  steerMode: {
    status: "pending" | "running";
    queuedCount: number;
    threadTitle: string;
    activePrompt: string;
    queuedFollowUps: RuntimeThreadQueuedItem[];
  } | null;
  focusRequestKey: number;
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  transcribingAudio: boolean;
  onWorkflowModeChange: (mode: RuntimeWorkflowMode) => void;
  onFactoryDraftChange: (draft: RuntimeFactoryComposerDraft) => void;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onVoiceCapture: (file: File) => Promise<void>;
  onVoiceCaptureError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const workflowModeOptions: Array<{ value: RuntimeWorkflowMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "build", label: "Build" },
  { value: "review", label: "Review" },
  { value: "debug", label: "Debug" },
  { value: "refactor", label: "Refactor" },
  { value: "factory", label: "Factory" }
];

export function Composer({
  project,
  backendConnected,
  workflowMode,
  factoryDraft,
  composerMode,
  composerValue,
  attachments,
  steerMode,
  focusRequestKey,
  feedback,
  submitting,
  transcribingAudio,
  onWorkflowModeChange,
  onFactoryDraftChange,
  onComposerModeChange,
  onComposerValueChange,
  onAttachmentsChange,
  onVoiceCapture,
  onVoiceCaptureError,
  onSubmit
}: ComposerProps) {
  const fileInputId = useId();
  const modeSelectId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordingState, setRecordingState] = useState<"idle" | "starting" | "recording">("idle");
  const [steerDrawerOpen, setSteerDrawerOpen] = useState(false);
  const steerEnabled = Boolean(steerMode);
  const factoryModeSupported =
    !steerEnabled && backendConnected && project?.kind === "live";
  const hasDraftContent = composerValue.trim().length > 0 || attachments.length > 0;
  const canSubmit = Boolean(project) && !submitting && !transcribingAudio && hasDraftContent;
  const placeholder =
    recordingState === "recording"
      ? "Recording voice note..."
      : transcribingAudio
        ? "Transcribing voice note..."
        : steerMode
          ? "Ask for follow-up changes"
        : workflowMode === "factory"
          ? "Describe the application you want Factory Mode to build..."
        : workflowMode === "review"
          ? "Ask for a review, audit, or findings-first assessment..."
        : workflowMode === "debug"
          ? "Describe the bug, error, or failing behavior you want diagnosed..."
        : workflowMode === "refactor"
          ? "Describe the refactor or structural cleanup you want to make..."
        : workflowMode === "build"
          ? "Describe the feature, implementation step, or code change you want built..."
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

    if (steerEnabled) {
      setSteerDrawerOpen(true);
    }

    textareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length
    );
  }, [focusRequestKey, steerEnabled]);

  useEffect(() => {
    if (!steerEnabled) {
      setSteerDrawerOpen(false);
      return;
    }

    setSteerDrawerOpen(true);
  }, [steerEnabled]);

  useEffect(() => {
    if (!steerEnabled) {
      return;
    }

    if (hasDraftContent) {
      setSteerDrawerOpen(true);
    }
  }, [hasDraftContent, steerEnabled]);

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

  function focusSteerInput() {
    setSteerDrawerOpen(true);
    textareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length
    );
  }

  function handleToggleSteerDrawer() {
    if (!steerMode) {
      return;
    }

    setSteerDrawerOpen((current) => {
      const next = !current;

      if (next) {
        window.setTimeout(() => {
          focusSteerInput();
        }, 0);
      }

      return next;
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.nativeEvent.isComposing || !canSubmit) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      {!steerMode ? (
        <AttachmentPreviewList
          attachments={attachments}
          onRemove={(attachmentId) =>
            onAttachmentsChange(attachments.filter((candidate) => candidate.id !== attachmentId))
          }
        />
      ) : null}

      <div className={`composer__field ${steerMode ? "composer__field--steer" : ""}`}>
        {steerMode ? (
          <div className="composer__steer-window">
            <div className="composer__steer-window-copy">
              <span className="composer__steer-window-status">
                <SteerDockIcon />
                <span>{steerMode.status === "running" ? "Now" : "Up next"}</span>
              </span>
              <div className="composer__steer-window-text">
                <strong className="composer__steer-window-prompt">{steerMode.activePrompt}</strong>
                <span className="composer__steer-window-thread">{steerMode.threadTitle}</span>
              </div>
            </div>

            <button
              type="button"
              className={`composer__steer-trigger ${steerDrawerOpen ? "composer__steer-trigger--open" : ""}`}
              onClick={handleToggleSteerDrawer}
              aria-expanded={steerDrawerOpen}
              aria-label={steerDrawerOpen ? "Hide steer drawer" : "Open steer drawer"}
            >
              <SteerTurnIcon />
              <span>Steer</span>
              <ChevronIcon />
            </button>
          </div>
        ) : null}

        {steerMode ? (
          <div className={`composer__steer-drawer ${steerDrawerOpen ? "is-open" : "is-closed"}`}>
            <div className="composer__steer-content">
              <AttachmentPreviewList
                attachments={attachments}
                onRemove={(attachmentId) =>
                  onAttachmentsChange(attachments.filter((candidate) => candidate.id !== attachmentId))
                }
              />

              {steerMode.queuedFollowUps.length > 0 ? (
                <div className="composer__queued-followups">
                  {steerMode.queuedFollowUps.slice(0, 2).map((item) => (
                    <article
                      key={item.id}
                      className={`composer__queued-followup composer__queued-followup--${item.state}`}
                    >
                      <div className="composer__queued-followup-head">
                        <span className="composer__queued-followup-badge">
                          {item.state === "sending" ? "Sending" : "Queued next"}
                        </span>
                        <span>{item.createdAt}</span>
                      </div>
                      <strong>{item.instruction}</strong>
                    </article>
                  ))}
                </div>
              ) : null}

              <textarea
                ref={textareaRef}
                value={composerValue}
                onChange={(event) => onComposerValueChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
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
                  <div className="composer__mode-control">
                    <label className="composer__mode-label" htmlFor={modeSelectId}>
                      Mode
                    </label>
                    <select
                      id={modeSelectId}
                      className="composer__mode-select"
                      value={workflowMode}
                      onChange={(event) =>
                        onWorkflowModeChange(event.target.value as RuntimeWorkflowMode)
                      }
                    >
                      {workflowModeOptions.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={
                            option.value === "factory" &&
                            !factoryModeSupported &&
                            workflowMode !== "factory"
                          }
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
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
          </div>
        ) : (
          <>
            {workflowMode === "factory" ? (
              <div className="composer__factory-panel">
                <div className="composer__factory-grid">
                  <label className="composer__factory-field">
                    <span>App name</span>
                    <input
                      type="text"
                      value={factoryDraft.appName}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          appName: event.target.value
                        })
                      }
                      placeholder="Acme Portal"
                    />
                  </label>
                  <label className="composer__factory-field">
                    <span>Repo owner</span>
                    <input
                      type="text"
                      value={factoryDraft.repositoryOwner}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          repositoryOwner: event.target.value
                        })
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label className="composer__factory-field">
                    <span>Repo name</span>
                    <input
                      type="text"
                      value={factoryDraft.repositoryName}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          repositoryName: event.target.value
                        })
                      }
                      placeholder="acme-portal"
                    />
                  </label>
                  <label className="composer__factory-field">
                    <span>Stack</span>
                    <select
                      value={factoryDraft.stackTemplateId}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          stackTemplateId: event.target.value as RuntimeFactoryComposerDraft["stackTemplateId"]
                        })
                      }
                    >
                      <option value="nextjs_supabase_vercel">Next.js + Supabase + Vercel</option>
                      <option value="nextjs_railway_postgres">Next.js + Railway Postgres</option>
                      <option value="react_express_railway">React + Express + Railway</option>
                    </select>
                  </label>
                  <label className="composer__factory-field">
                    <span>Deploy target</span>
                    <select
                      value={factoryDraft.deploymentProvider}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          deploymentProvider: event.target.value as RuntimeFactoryComposerDraft["deploymentProvider"]
                        })
                      }
                    >
                      <option value="vercel">Vercel</option>
                      <option value="railway">Railway</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                  <label className="composer__factory-field">
                    <span>Deploy project</span>
                    <input
                      type="text"
                      value={factoryDraft.deploymentProjectName}
                      onChange={(event) =>
                        onFactoryDraftChange({
                          ...factoryDraft,
                          deploymentProjectName: event.target.value
                        })
                      }
                      placeholder="Optional"
                    />
                  </label>
                </div>

                <label className="composer__factory-field">
                  <span>Environment</span>
                  <input
                    type="text"
                    value={factoryDraft.deploymentEnvironment}
                    onChange={(event) =>
                      onFactoryDraftChange({
                        ...factoryDraft,
                        deploymentEnvironment: event.target.value
                      })
                    }
                    placeholder="production"
                  />
                </label>

                {!factoryModeSupported ? (
                  <p className="composer__factory-note">
                    Factory Mode runs through the live runtime project and needs the backend to be connected.
                  </p>
                ) : (
                  <p className="composer__factory-note">
                    Shipyard will create a fresh isolated workspace for this app before the run starts.
                  </p>
                )}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={composerValue}
              onChange={(event) => onComposerValueChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
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
                <div className="composer__mode-control">
                  <label className="composer__mode-label" htmlFor={modeSelectId}>
                    Mode
                  </label>
                  <select
                    id={modeSelectId}
                    className="composer__mode-select"
                    value={workflowMode}
                    onChange={(event) =>
                      onWorkflowModeChange(event.target.value as RuntimeWorkflowMode)
                    }
                  >
                    {workflowModeOptions.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={
                          option.value === "factory" &&
                          !factoryModeSupported &&
                          workflowMode !== "factory"
                        }
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
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
          </>
        )}
      </div>

      {feedback?.tone === "danger" ? (
        <p className={`composer__feedback composer__feedback--${feedback.tone}`}>{feedback.text}</p>
      ) : null}

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

function SteerDockIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 5.5a1 1 0 0 1 1-1h2.5M5 9.5a1 1 0 0 1 1-1h4.5M5 13.5a1 1 0 0 1 1-1h3.5M14.5 6.25v4.5m0 0-2-2m2 2 2-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SteerTurnIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M13.75 5.25H9.5a3.25 3.25 0 0 0-3.25 3.25v2.25m0 0 2-2m-2 2 2 2M9 14.25h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m6.2 8.2 3.8 3.8 3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
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
