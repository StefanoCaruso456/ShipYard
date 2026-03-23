import type { ReactNode } from "react";

import type { SidebarNavItemId, WorkspaceProject, WorkspaceThread } from "../types";

type SidebarProps = {
  projects: WorkspaceProject[];
  threads: WorkspaceThread[];
  activeProjectId: string;
  activeThreadId: string | null;
  activeNav: SidebarNavItemId;
  runtimeTone: "ready" | "busy" | "offline";
  runtimeLabel: string;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onSelectNav: (navId: SidebarNavItemId) => void;
};

export function Sidebar({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  activeNav,
  runtimeTone,
  runtimeLabel,
  onSelectProject,
  onSelectThread,
  onCreateThread,
  onSelectNav
}: SidebarProps) {
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

      <nav className="sidebar__primary-nav" aria-label="Primary navigation">
        <SidebarButton
          icon={<ComposeIcon />}
          label="New thread"
          active={false}
          onClick={onCreateThread}
        />
        <SidebarButton
          icon={<ClockIcon />}
          label="Automations"
          active={activeNav === "automations"}
          onClick={() => onSelectNav("automations")}
        />
        <SidebarButton
          icon={<SparkIcon />}
          label="Skills"
          active={activeNav === "skills"}
          onClick={() => onSelectNav("skills")}
        />
      </nav>

      <section className="sidebar__threads">
        <div className="sidebar__threads-header">
          <strong>Threads</strong>
          <div className="sidebar__threads-actions" aria-hidden="true">
            <button type="button" onClick={onCreateThread}>
              <PlusIcon />
            </button>
            <button type="button" onClick={() => onSelectNav("projects")}>
              <FilterIcon />
            </button>
          </div>
        </div>

        <label className="sidebar__project-picker">
          <FolderIcon />
          <select
            value={activeProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            aria-label="Select workspace"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <div className="sidebar__thread-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`thread-row ${thread.id === activeThreadId && activeNav === "projects" ? "is-active" : ""}`}
              onClick={() => onSelectThread(thread.id)}
            >
              <span className="thread-row__title">{thread.title}</span>
              <span className="thread-row__meta">{thread.updatedLabel}</span>
            </button>
          ))}
        </div>
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

function SidebarButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sidebar__nav-item ${active ? "is-active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
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

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5v3.7l2.5 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6 5.5h8a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 14 14H6a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 6 5.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M7.5 9.8h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 7.3l1.3 2.5L10 12.3 8.7 9.8 10 7.3z" fill="currentColor" />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 6h11M7 10h6M8.8 14h2.4"
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
