import type { SidebarNavItem, SidebarNavItemId, WorkspaceProject } from "../types";

type SidebarProps = {
  projects: WorkspaceProject[];
  navItems: SidebarNavItem[];
  activeProjectId: string;
  activeNav: SidebarNavItemId;
  runtimeTone: "ready" | "busy" | "offline";
  runtimeLabel: string;
  onSelectProject: (projectId: string) => void;
  onSelectNav: (navId: SidebarNavItemId) => void;
};

export function Sidebar({
  projects,
  navItems,
  activeProjectId,
  activeNav,
  runtimeTone,
  runtimeLabel,
  onSelectProject,
  onSelectNav
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-mark">SY</div>
        <div>
          <p className="sidebar__eyebrow">Coding Agent</p>
          <h1>Shipyard</h1>
        </div>
      </div>

      <section className="panel sidebar__section">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Workspace Switcher</p>
            <h2>Projects</h2>
          </div>
        </div>
        <div className="project-switcher">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;

            return (
              <button
                key={project.id}
                type="button"
                className={`project-switcher__item ${isActive ? "is-active" : ""}`}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-switcher__badge">{project.code}</span>
                <span className="project-switcher__meta">
                  <strong>{project.name}</strong>
                  <span>{project.environment}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel sidebar__section">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Navigation</p>
            <h2>Surfaces</h2>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const isActive = item.id === activeNav;

            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav__item ${isActive ? "is-active" : ""}`}
                onClick={() => onSelectNav(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            );
          })}
        </nav>
      </section>

      <section className="panel sidebar__section sidebar__runtime">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Runtime</p>
            <h2>Health</h2>
          </div>
          <span className={`tone-badge tone-badge--${runtimeTone}`}>{runtimeLabel}</span>
        </div>
        <p className="sidebar__runtime-copy">
          Live runtime status is wired from the backend. Skills, automations, and Git surfaces
          stay visible even when the API is offline.
        </p>
      </section>
    </aside>
  );
}
