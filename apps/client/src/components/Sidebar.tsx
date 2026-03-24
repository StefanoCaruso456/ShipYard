import type { ReactNode } from "react";

import { ThreadList } from "./ThreadList";

import type { SidebarNavItemId, ThreadGroup } from "../types";

type SidebarProps = {
  groups: ThreadGroup[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeNav: SidebarNavItemId;
  runtimeTone: "ready" | "busy" | "offline";
  runtimeLabel: string;
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
  runtimeTone,
  runtimeLabel,
  onSelectProject,
  onSelectThread,
  onCreateThread,
  onRenameProject,
  onDeleteProject,
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

      <button type="button" className="sidebar__primary-action" onClick={onCreateThread}>
        <ComposeIcon />
        <span>New thread</span>
      </button>

      <nav className="sidebar__nav">
        <SidebarNavButton
          icon={<ClockIcon />}
          label="Automations"
          active={activeNav === "automations"}
          onClick={() => onSelectNav("automations")}
        />
        <SidebarNavButton
          icon={<SparkIcon />}
          label="Skills"
          active={activeNav === "skills"}
          onClick={() => onSelectNav("skills")}
        />
      </nav>

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

function SidebarNavButton({
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
