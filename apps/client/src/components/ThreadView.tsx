import type { WorkspaceProject, WorkspaceThread } from "../types";
import { AgentActivityFeed } from "./AgentActivityFeed";
import { AttachmentPreviewList } from "./AttachmentPreviewList";
import { ThreadMessageCard } from "./ThreadMessageCard";

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

  const hasActivity = (thread.activity?.length ?? 0) > 0;
  const visibleMessages = hasActivity
    ? thread.messages.filter((message) => message.role !== "system")
    : thread.messages;
  const userMessages = visibleMessages.filter((message) => message.role === "user");
  const responseMessages = visibleMessages.filter((message) => message.role !== "user");

  return (
    <section className="thread-view">
      <div className="thread-view__status">
        <span>Runtime {runtimeState}</span>
        <span>{thread.updatedLabel}</span>
      </div>

      <div className="thread-view__stream">
        <AttachmentPreviewList attachments={thread.attachments} />

        {userMessages.map((message) => (
          <ThreadMessageCard key={message.id} message={message} />
        ))}

        {hasActivity || thread.source === "live" ? (
          <AgentActivityFeed activity={thread.activity ?? []} status={thread.status} />
        ) : null}

        {!hasActivity
          ? thread.progress.map((event) => (
              <div key={event.id} className={`event-row event-row--${event.tone}`}>
                <strong>{event.label}</strong>
                <span>{event.timestamp}</span>
                <p>{event.detail}</p>
              </div>
            ))
          : null}

        {responseMessages.map((message) => (
          <ThreadMessageCard key={message.id} message={message} />
        ))}
      </div>
    </section>
  );
}
