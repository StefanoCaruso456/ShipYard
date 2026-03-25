import { ThreadList } from "./ThreadList";

import type { SidebarNavItemId, ThreadGroup, WorkspaceProject } from "../types";

type SidebarProps = {
  groups: ThreadGroup[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeNav: SidebarNavItemId;
  activeProject: WorkspaceProject | null;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onCreateProject: () => void;
  onCreateThread: (projectId?: string) => void;
  onReconnectProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectNav: (navId: SidebarNavItemId) => void;
};

export function Sidebar({
  groups,
  activeProjectId,
  activeThreadId,
  activeNav,
  activeProject,
  onSelectProject,
  onSelectThread,
  onCreateProject,
  onCreateThread,
  onReconnectProjectFolder,
  onRenameProject,
  onDeleteProject,
  onSelectNav
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <button type="button" className="sidebar__primary-action" onClick={onCreateProject}>
        <FolderPlusIcon />
        <span>New project</span>
      </button>

      <section className="sidebar__threads">
        <div className="sidebar__threads-header">
          <strong>Projects</strong>
          {activeProject ? (
            <button
              type="button"
              className="sidebar__header-action sidebar__icon-button"
              onClick={() => onCreateThread(activeProject.id)}
              aria-label={`Create a new thread in ${activeProject.name}`}
            >
              <ComposeIcon />
            </button>
          ) : null}
        </div>

        <ThreadList
          groups={groups}
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          onSelectProject={onSelectProject}
          onSelectThread={onSelectThread}
          onCreateThread={onCreateThread}
          onReconnectProjectFolder={onReconnectProjectFolder}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
      </section>

      <button
        type="button"
        className={`sidebar__settings ${activeNav === "settings" ? "is-active" : ""}`}
        onClick={() => onSelectNav("settings")}
      >
        <SettingsIcon />
        <span>Settings</span>
      </button>
    </aside>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 6.5h4l1.2 1.6h7.8v6.2a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2V7.7a1.2 1.2 0 0 1 1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12.5 4.4v4.2M10.4 6.5h4.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 5v10M5 10h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
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
