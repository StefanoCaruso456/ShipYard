import type {
  RuntimeRepoBranchSnapshot,
  RuntimeOperatorApprovalDecision,
  WorkspaceProject,
  WorkspaceThread
} from "../types";
import { LiveRuntimeStage } from "./LiveRuntimeStage";
import { RuntimeBranchSwitcher } from "./RuntimeBranchSwitcher";
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
  runtimeRepo: {
    snapshot: RuntimeRepoBranchSnapshot | null;
    loading: boolean;
    switchingBranchName: string | null;
    error: string | null;
  };
  suggestions: SuggestionCard[];
  onSelectSuggestion: (prompt: string) => void;
  onReconnectProjectFolder: (projectId: string) => Promise<void>;
  onRefreshRuntimeBranches: () => Promise<void>;
  onSwitchRuntimeBranch: (branchName: string) => Promise<void>;
  onRequestSteer: () => void;
  onApprovalDecision: (
    runId: string,
    gateId: string,
    decision: RuntimeOperatorApprovalDecision,
    comment: string
  ) => Promise<void>;
};

export function ThreadView({
  project,
  thread,
  runtimeState,
  runtimeRepo,
  suggestions,
  onSelectSuggestion,
  onReconnectProjectFolder,
  onRefreshRuntimeBranches,
  onSwitchRuntimeBranch,
  onRequestSteer,
  onApprovalDecision
}: ThreadViewProps) {
  const isEmpty = !thread || thread.messages.length === 0;
  const projectNeedsAccess = project?.kind === "local" && project.folder?.status === "needs-access";
  const emptyRuntimeLabel =
    project?.kind === "local"
      ? projectNeedsAccess
        ? "Local folder access needed"
        : "Local folder connected"
      : `Runtime ${runtimeState}`;
  const threadStatusTone = thread?.status === "failed" ? "error" : thread?.status ?? runtimeState;
  const statusLabel = thread
    ? thread.status === "pending"
      ? "Queued"
      : thread.status === "running"
        ? "Thinking"
        : thread.status === "paused"
          ? "Awaiting approval"
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
          <p className="thread-view__runtime">{emptyRuntimeLabel}</p>
          <h3>
            {projectNeedsAccess
              ? `Reconnect ${project?.name ?? "project"}`
              : `Let's build ${project?.name ?? "Shipyard"}`}
          </h3>
          <p>
            {projectNeedsAccess
              ? `Restore folder access for ${project?.folder?.name ?? project?.name ?? "this project"} before starting new threads.`
              : project?.kind === "local"
                ? `Connected folder: ${project.folder?.displayPath ?? project.name}. Start with a concrete task, repo question, or implementation request.`
                : "Start with a concrete task, repo question, or implementation request."}
          </p>

          {project?.kind === "local" ? (
            <div className="thread-view__project-meta">
              <span>{project.environment}</span>
              <span>{project.folder?.displayPath ?? "Folder not connected"}</span>
              <span>{projectNeedsAccess ? "Reconnect required" : "Ready for new threads"}</span>
            </div>
          ) : null}

          {project?.kind === "live" && runtimeState !== "error" ? (
            <div className="thread-view__empty-runtime-actions">
              <RuntimeBranchSwitcher
                snapshot={runtimeRepo.snapshot}
                loading={runtimeRepo.loading}
                switchingBranchName={runtimeRepo.switchingBranchName}
                error={runtimeRepo.error}
                onRefresh={onRefreshRuntimeBranches}
                onSwitchBranch={onSwitchRuntimeBranch}
              />
            </div>
          ) : null}

          {projectNeedsAccess && project ? (
            <button
              type="button"
              className="thread-view__empty-action"
              onClick={() => void onReconnectProjectFolder(project.id)}
            >
              Reconnect folder
            </button>
          ) : null}

          {!projectNeedsAccess ? (
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
          ) : null}
        </div>
      </section>
    );
  }

  const hasActivity = (thread.activity?.length ?? 0) > 0;
  const hiddenMessageIds = new Set<string>();

  if (
    thread.source === "live" &&
    thread.liveRuntime?.focusedRunId &&
    (thread.status === "running" || thread.status === "pending" || thread.status === "paused")
  ) {
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
        <div className="thread-view__status-main">
          <span className={`thread-view__status-pill thread-view__status-pill--${threadStatusTone}`}>
            <span className="thread-view__status-dot" aria-hidden="true" />
            {statusLabel}
          </span>

          {project?.kind === "live" && runtimeState !== "error" ? (
            <RuntimeBranchSwitcher
              snapshot={runtimeRepo.snapshot}
              loading={runtimeRepo.loading}
              switchingBranchName={runtimeRepo.switchingBranchName}
              error={runtimeRepo.error}
              onRefresh={onRefreshRuntimeBranches}
              onSwitchBranch={onSwitchRuntimeBranch}
            />
          ) : null}
        </div>
        <span>{thread.updatedLabel}</span>
      </div>

      <div className="thread-view__stream">
        {showLiveRuntimeStage ? (
          <LiveRuntimeStage
            thread={thread}
            onRequestSteer={onRequestSteer}
            onApprovalDecision={onApprovalDecision}
          />
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
