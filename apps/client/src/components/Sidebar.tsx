import { ThreadList } from "./ThreadList";

import type { SidebarNavItemId, ThreadGroup } from "../types";

type SidebarProps = {
  groups: ThreadGroup[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeNav: SidebarNavItemId;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onCreateThread: () => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectNav: (navId: SidebarNavItemId) => void;
};

export function Sidebar({
  groups,
  activeProjectId,
  activeThreadId,
  activeNav,
  onSelectProject,
  onSelectThread,
  onCreateThread,
  onRenameProject,
  onDeleteProject,
  onSelectNav
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <button type="button" className="sidebar__primary-action" onClick={onCreateThread}>
        <ComposeIcon />
        <span>New thread</span>
      </button>

      <section className="sidebar__threads">
        <div className="sidebar__threads-header">
          <strong>Threads</strong>
        </div>

        <ThreadList
          groups={groups}
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          onSelectProject={onSelectProject}
          onSelectThread={onSelectThread}
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
