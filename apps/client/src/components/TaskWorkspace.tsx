import type { FormEvent } from "react";

import type { ModeOption, WorkspaceProject, WorkspaceThread } from "../types";

type TaskWorkspaceProps = {
  project: WorkspaceProject;
  thread: WorkspaceThread | null;
  mode: ModeOption;
  modeOptions: Array<{ id: ModeOption; label: string; detail: string }>;
  composerTitle: string;
  composerValue: string;
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  simulateFailure: boolean;
  selectedSkillCount: number;
  backendConnected: boolean;
  onModeChange: (mode: ModeOption) => void;
  onComposerTitleChange: (value: string) => void;
  onComposerValueChange: (value: string) => void;
  onSimulateFailureChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskWorkspace({
  project,
  thread,
  mode,
  modeOptions,
  composerTitle,
  composerValue,
  feedback,
  submitting,
  simulateFailure,
  selectedSkillCount,
  backendConnected,
  onModeChange,
  onComposerTitleChange,
  onComposerValueChange,
  onSimulateFailureChange,
  onSubmit
}: TaskWorkspaceProps) {
  return (
    <section className="workspace-main">
      <header className="workspace-main__header">
        <div className="workspace-main__title">
          <p className="workspace-main__eyebrow">{project.name}</p>
          <h2>{thread?.title ?? "Select a thread"}</h2>
          <p className="workspace-main__summary">
            {thread?.summary ??
              "Choose a thread from the left rail or submit a new task to the persistent runtime."}
          </p>
        </div>

        <div className="workspace-main__toolbar">
          <div className="mode-switcher">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`mode-switcher__item ${option.id === mode ? "is-active" : ""}`}
                onClick={() => onModeChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="workspace-main__meta">
            <span className={`status-pill status-pill--${thread?.status ?? "ready"}`}>
              {thread?.status ?? "ready"}
            </span>
            <span className={`source-pill source-pill--${thread?.source ?? "guide"}`}>
              {thread?.source ?? "guide"}
            </span>
            <span className={`tone-badge tone-badge--${backendConnected ? "ready" : "offline"}`}>
              {backendConnected ? "runtime live" : "offline"}
            </span>
          </div>
        </div>
      </header>

      <section className="workspace-main__body">
        <article className="workspace-section">
          <div className="workspace-section__header">
            <span>Progress</span>
          </div>
          <ol className="timeline">
            {thread?.progress.length ? (
              thread.progress.map((event) => (
                <li key={event.id} className="timeline__item">
                  <span className={`timeline__marker timeline__marker--${event.tone}`} />
                  <div>
                    <div className="timeline__meta">
                      <strong>{event.label}</strong>
                      <small>{event.timestamp}</small>
                    </div>
                    <p>{event.detail}</p>
                  </div>
                </li>
              ))
            ) : (
              <li className="timeline__item is-empty">
                <div>
                  <strong>No events yet</strong>
                  <p>Submitting a task will populate the runtime activity stream here.</p>
                </div>
              </li>
            )}
          </ol>
        </article>

        <article className="workspace-section workspace-section--grow">
          <div className="workspace-section__header">
            <span>Conversation</span>
            <small>{selectedSkillCount} skill(s) attached</small>
          </div>
          <div className="message-stream">
            {thread?.messages.length ? (
              thread.messages.map((message) => (
                <article key={message.id} className={`message message--${message.role}`}>
                  <div className="message__meta">
                    <span>{message.label}</span>
                    <small>{message.timestamp}</small>
                  </div>
                  <p className={`message__body message__body--${message.tone}`}>{message.body}</p>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <h4>No thread selected</h4>
                <p>Use the thread list to explore the workspace or create a new live task.</p>
              </div>
            )}
          </div>
        </article>
      </section>

      <form className="composer" onSubmit={onSubmit}>
        <div className="composer__row composer__row--compact">
          <input
            type="text"
            value={composerTitle}
            onChange={(event) => onComposerTitleChange(event.target.value)}
            placeholder="Optional thread title"
          />
        </div>
        <div className="composer__row">
          <textarea
            value={composerValue}
            onChange={(event) => onComposerValueChange(event.target.value)}
            placeholder="Ask Shipyard..."
            rows={4}
          />
        </div>

        <div className="composer__footer">
          <label className="composer__toggle">
            <input
              type="checkbox"
              checked={simulateFailure}
              onChange={(event) => onSimulateFailureChange(event.target.checked)}
            />
            <span>Simulate failure path</span>
          </label>

          <div className="composer__actions">
            {feedback ? (
              <p className={`composer__feedback composer__feedback--${feedback.tone}`}>
                {feedback.text}
              </p>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={submitting || project.kind !== "live" || !backendConnected}
            >
              {submitting ? "Submitting..." : "Submit task"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
