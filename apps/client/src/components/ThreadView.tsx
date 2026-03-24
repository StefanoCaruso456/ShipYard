import type { WorkspaceProject, WorkspaceThread } from "../types";

type SuggestionCard = {
  id: string;
  title: string;
  prompt: string;
};

type ThreadViewProps = {
  project: WorkspaceProject | null;
  thread: WorkspaceThread | null;
  runtimeState: "running" | "idle" | "error";
  suggestions: SuggestionCard[];
  onSelectSuggestion: (prompt: string) => void;
};

export function ThreadView({
  project,
  thread,
  runtimeState,
  suggestions,
  onSelectSuggestion
}: ThreadViewProps) {
  const isEmpty = !thread || thread.messages.length === 0;

  if (isEmpty) {
    return (
      <section className="thread-view thread-view--empty">
        <div className="thread-view__empty">
          <p className="thread-view__runtime">Runtime {runtimeState}</p>
          <h3>Let&apos;s build {project?.name ?? "Shipyard"}</h3>
          <p>Start with a concrete task, repo question, or implementation request.</p>

          <div className="suggestion-grid">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="suggestion-card"
                onClick={() => onSelectSuggestion(suggestion.prompt)}
              >
                <strong>{suggestion.title}</strong>
                <span>{suggestion.prompt}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="thread-view">
      <div className="thread-view__status">
        <span>Runtime {runtimeState}</span>
        <span>{thread.updatedLabel}</span>
      </div>

      <div className="thread-view__stream">
        {thread.progress.map((event) => (
          <div key={event.id} className={`event-row event-row--${event.tone}`}>
            <strong>{event.label}</strong>
            <span>{event.timestamp}</span>
            <p>{event.detail}</p>
          </div>
        ))}

        {thread.messages.map((message) => (
          <article key={message.id} className={`message message--${message.role}`}>
            <div className="message__meta">
              <strong>{message.label}</strong>
              <span>{message.timestamp}</span>
            </div>
            <p>{message.body}</p>
          </article>
        ))}

        <div className="agent-placeholder">
          <strong>Agent updates</strong>
          <p>Planner, executor, and verifier events will stream here as the runtime grows.</p>
        </div>
      </div>
    </section>
  );
}
