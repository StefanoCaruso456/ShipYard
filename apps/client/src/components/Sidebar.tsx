import type { WorkspaceProject, WorkspaceThread } from "../types";

type SidebarProps = {
  projects: WorkspaceProject[];
  threads: WorkspaceThread[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  runtimeTone: "ready" | "busy" | "offline";
  runtimeLabel: string;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
};

export function Sidebar({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  runtimeTone,
  runtimeLabel,
  onSelectProject,
  onSelectThread,
  onCreateThread,
  onRenameProject,
  onDeleteProject,
  onOpenSettings
}: SidebarProps) {
  const activeProject = projects.find((candidate) => candidate.id === activeProjectId) ?? projects[0] ?? null;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-lockup">
          <div className="sidebar__brand-mark">S</div>
          <div>
            <h1>Shipyard</h1>
            <p>Coding agent workspace</p>
          </div>
        </div>
        <span className={`sidebar__runtime sidebar__runtime--${runtimeTone}`}>{runtimeLabel}</span>
      </div>

      <button type="button" className="sidebar__primary-action" onClick={onCreateThread}>
        <ComposeIcon />
        <span>New thread</span>
      </button>

      <section className="sidebar__threads">
        <div className="sidebar__threads-header">
          <strong>Threads</strong>
        </div>

        {activeProject ? (
          <div className="sidebar__session-row">
            <button
              type="button"
              className="sidebar__session-link"
              onClick={() => onSelectProject(activeProject.id)}
            >
              <FolderIcon />
              <span>{activeProject.name}</span>
            </button>

            <div className="sidebar__session-actions">
              <button
                type="button"
                className="sidebar__icon-button"
                aria-label="Rename session"
                onClick={() => onRenameProject(activeProject.id)}
              >
                <RenameIcon />
              </button>
              <button
                type="button"
                className="sidebar__icon-button"
                aria-label="Delete session"
                onClick={() => onDeleteProject(activeProject.id)}
              >
                <DeleteIcon />
              </button>
            </div>
          </div>
        ) : null}

        <div className="sidebar__thread-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`thread-row ${thread.id === activeThreadId ? "is-active" : ""}`}
              onClick={() => onSelectThread(thread.id)}
            >
              <span className="thread-row__title">{thread.title}</span>
              <span className="thread-row__meta">{thread.updatedLabel}</span>
            </button>
          ))}
        </div>
      </section>

      <button type="button" className="sidebar__settings" onClick={onOpenSettings}>
        <SettingsIcon />
        <span>Settings</span>
      </button>
    </aside>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 14.5l.5-2.75L12.9 3.8a1.8 1.8 0 0 1 2.55 2.55l-7.95 7.9-3 .25z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11.7 5l2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 4.4l1 .3.7 1.7 1.8.6 1.1-.6 1 1.8-.8 1.1.3 1.8 1.4 1-.8 2-1.7.1-1.5 1.2-.3 1.1h-2l-.7-1.5-1.8-.4-1.4.8-1.4-1.5.6-1.7-.8-1.7-1.6-.8V9l1.5-.8.4-1.8-.8-1.2 1.7-1 .9.6 1.9-.4L10 4.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
