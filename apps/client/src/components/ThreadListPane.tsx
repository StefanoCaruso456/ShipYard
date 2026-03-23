import type { WorkspaceProject, WorkspaceThread } from "../types";

type ThreadListPaneProps = {
  project: WorkspaceProject;
  threads: WorkspaceThread[];
  activeThreadId: string | null;
  filterValue: string;
  onFilterChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
};

export function ThreadListPane({
  project,
  threads,
  activeThreadId,
  filterValue,
  onFilterChange,
  onSelectThread,
  onCreateThread
}: ThreadListPaneProps) {
  return (
    <section className="thread-pane">
      <div className="thread-pane__header">
        <div>
          <p className="panel__eyebrow">{project.environment}</p>
          <h2>{project.name}</h2>
          <p className="thread-pane__description">{project.description}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onCreateThread}>
          + New Task
        </button>
      </div>

      <label className="thread-filter">
        <span>Find thread</span>
        <input
          type="search"
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search title, summary, or tags"
        />
      </label>

      <div className="thread-list">
        {threads.length > 0 ? (
          threads.map((thread) => {
            const isActive = thread.id === activeThreadId;

            return (
              <button
                key={thread.id}
                type="button"
                className={`thread-card ${isActive ? "is-active" : ""}`}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="thread-card__top">
                  <span className={`status-dot status-dot--${thread.status}`} />
                  <span className="thread-card__status">{thread.status}</span>
                  <span className="thread-card__source">{thread.source}</span>
                </div>
                <strong>{thread.title}</strong>
                <p>{thread.summary}</p>
                <div className="thread-card__meta">
                  <span>{thread.createdLabel}</span>
                  <span>{thread.updatedLabel}</span>
                </div>
                <div className="thread-card__tags">
                  {thread.tags.slice(0, 3).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </button>
            );
          })
        ) : (
          <div className="thread-empty">
            <h3>No matching threads</h3>
            <p>Clear the filter or submit a new live task to populate this workspace.</p>
          </div>
        )}
      </div>
    </section>
  );
}
