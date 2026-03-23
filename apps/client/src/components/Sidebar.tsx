import type {
  SidebarNavItem,
  SidebarNavItemId,
  WorkspaceProject,
  WorkspaceThread
} from "../types";

type SidebarProps = {
  projects: WorkspaceProject[];
  threads: WorkspaceThread[];
  navItems: SidebarNavItem[];
  activeProjectId: string;
  activeThreadId: string | null;
  activeNav: SidebarNavItemId;
  filterValue: string;
  runtimeTone: "ready" | "busy" | "offline";
  runtimeLabel: string;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onFilterChange: (value: string) => void;
  onCreateThread: () => void;
  onSelectNav: (navId: SidebarNavItemId) => void;
};

export function Sidebar({
  projects,
  threads,
  navItems,
  activeProjectId,
  activeThreadId,
  activeNav,
  filterValue,
  runtimeTone,
  runtimeLabel,
  onSelectProject,
  onSelectThread,
  onFilterChange,
  onCreateThread,
  onSelectNav
}: SidebarProps) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-mark">S</div>
        <div>
          <h1>Shipyard</h1>
          <p className="sidebar__eyebrow">Coding agent workspace</p>
        </div>
        <span className={`tone-badge tone-badge--${runtimeTone}`}>{runtimeLabel}</span>
      </div>

      <label className="sidebar__workspace-picker">
        <span className="sidebar__label">Workspace</span>
        <select
          value={activeProjectId}
          onChange={(event) => onSelectProject(event.target.value)}
          aria-label="Select workspace"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {project.environment}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="sidebar__action sidebar__action--primary" onClick={onCreateThread}>
        + New thread
      </button>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.id === activeNav;

          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar__action sidebar-nav__item ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectNav(item.id)}
            >
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="sidebar__threads">
        <div className="sidebar__threads-header">
          <div>
            <strong>Threads</strong>
            <small>{activeProject.name}</small>
          </div>
          <span>{threads.length}</span>
        </div>

        <input
          className="sidebar__search"
          type="search"
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search threads"
        />

        <div className="sidebar__thread-list">
          {threads.length > 0 ? (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId;

              return (
                <button
                  key={thread.id}
                  type="button"
                  className={`sidebar__thread ${isActive ? "is-active" : ""}`}
                  onClick={() => onSelectThread(thread.id)}
                >
                  <span className={`status-dot status-dot--${thread.status}`} />
                  <span className="sidebar__thread-copy">
                    <strong>{thread.title}</strong>
                    <small>{thread.summary}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="sidebar__empty">No threads match this filter.</div>
          )}
        </div>
      </section>
    </aside>
  );
}
