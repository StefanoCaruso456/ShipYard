import type { WorkspaceProject, WorkspaceThread } from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";
import { LiveRuntimeStage } from "./LiveRuntimeStage";
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
  onRequestSteer: () => void;
};

export function ThreadView({
  project,
  thread,
  runtimeState,
  suggestions,
  onSelectSuggestion,
  onRequestSteer
}: ThreadViewProps) {
  const isEmpty = !thread || thread.messages.length === 0;
  const threadStatusTone = thread?.status === "failed" ? "error" : thread?.status ?? runtimeState;
  const statusLabel = thread
    ? thread.status === "pending"
      ? "Queued"
      : thread.status === "running"
        ? "Thinking"
        : thread.status === "completed"
          ? "Completed"
          : thread.status === "failed"
            ? "Failed"
            : `Runtime ${runtimeState}`
    : `Runtime ${runtimeState}`;

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
  const hiddenMessageIds = new Set<string>();

  if (thread.source === "live" && thread.liveRuntime?.focusedRunId) {
    hiddenMessageIds.add(`${thread.liveRuntime.focusedRunId}-user`);
  }

  const filteredMessages = thread.messages.filter((message) => !hiddenMessageIds.has(message.id));
  const showLiveRuntimeStage = thread.source === "live" && Boolean(thread.liveRuntime?.focusedRun);
  const visibleMessages = hasActivity || showLiveRuntimeStage
    ? filteredMessages.filter((message) => message.role !== "system")
    : filteredMessages;
  const userMessages = visibleMessages.filter((message) => message.role === "user");
  const responseMessages = visibleMessages.filter((message) => message.role !== "user");

  return (
    <section className="thread-view">
      <div className="thread-view__status">
        <span className={`thread-view__status-pill thread-view__status-pill--${threadStatusTone}`}>
          <span className="thread-view__status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span>{thread.updatedLabel}</span>
      </div>

      <div className="thread-view__stream">
        <AttachmentPreviewList attachments={thread.attachments} />

        {showLiveRuntimeStage ? (
          <LiveRuntimeStage thread={thread} onRequestSteer={onRequestSteer} />
        ) : null}

        {userMessages.map((message) => (
          <ThreadMessageCard key={message.id} message={message} />
        ))}

        {!hasActivity && !showLiveRuntimeStage
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
