import type { ThreadGroup } from "../types";

type ThreadListProps = {
  groups: ThreadGroup[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
};

export function ThreadList({
  groups,
  activeProjectId,
  activeThreadId,
  onSelectProject,
  onSelectThread,
  onRenameProject,
  onDeleteProject
}: ThreadListProps) {
  return (
    <div className="thread-list">
      {groups.map(({ project, threads }) => (
        <section key={project.id} className="thread-group">
          <div className="thread-group__header">
            <button
              type="button"
              className={`thread-group__project ${project.id === activeProjectId ? "is-active" : ""}`}
              onClick={() => onSelectProject(project.id)}
            >
              <FolderIcon />
              <span>{project.name}</span>
            </button>

            <div className="thread-group__actions">
              <button type="button" className="sidebar__icon-button" onClick={() => onRenameProject(project.id)} aria-label={`Rename ${project.name}`}>
                <RenameIcon />
              </button>
              <button type="button" className="sidebar__icon-button" onClick={() => onDeleteProject(project.id)} aria-label={`Delete ${project.name}`}>
                <DeleteIcon />
              </button>
            </div>
          </div>

          <div className="thread-group__threads">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread-row ${project.id === activeProjectId && thread.id === activeThreadId ? "is-active" : ""}`}
                onClick={() => onSelectThread(project.id, thread.id)}
              >
                <span className="thread-row__title">{thread.title}</span>
                <span className="thread-row__meta">{thread.updatedLabel}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 6.5h4l1.2 1.6h7.8v6.2a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2V7.7a1.2 1.2 0 0 1 1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 13.8V15h1.2l7.2-7.2-1.2-1.2L5 13.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M11.6 5.4l1.2 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6.2 6.2h7.6M8 6.2v8M12 6.2v8M7.2 6.2l.4-1.2h4.8l.4 1.2m-7 0 .5 8a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9l.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
