import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ThreadGroup } from "../types";

type ThreadListProps = {
  groups: ThreadGroup[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onCreateThread: (projectId?: string) => void;
  onReconnectProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
};

export function ThreadList({
  groups,
  activeProjectId,
  activeThreadId,
  onSelectProject,
  onSelectThread,
  onCreateThread,
  onReconnectProjectFolder,
  onRenameProject,
  onDeleteProject
}: ThreadListProps) {
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const openMenuProject = openMenuProjectId
    ? groups.find(({ project }) => project.id === openMenuProjectId)?.project ?? null
    : null;

  useLayoutEffect(() => {
    if (!openMenuProjectId) {
      setMenuPosition(null);
      return;
    }

    const projectId = openMenuProjectId;

    function updateMenuPosition() {
      const trigger = triggerRefs.current[projectId];

      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const panelWidth = 168;
      const panelHeight = 172;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        window.innerWidth - panelWidth - viewportPadding
      );
      const preferredTop = rect.bottom + 6;
      const top =
        preferredTop + panelHeight > window.innerHeight - viewportPadding
          ? Math.max(viewportPadding, rect.top - panelHeight - 6)
          : preferredTop;

      setMenuPosition({
        top,
        left
      });
    }

    updateMenuPosition();

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [openMenuProjectId]);

  useEffect(() => {
    if (!openMenuProjectId) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const trigger = openMenuProjectId ? triggerRefs.current[openMenuProjectId] : null;

      if (
        !menuRef.current?.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      ) {
        setOpenMenuProjectId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuProjectId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuProjectId]);

  function toggleProjectMenu(projectId: string) {
    setOpenMenuProjectId((current) => (current === projectId ? null : projectId));
  }

  function handleRename(projectId: string) {
    setOpenMenuProjectId(null);
    onRenameProject(projectId);
  }

  async function handleReconnect(projectId: string) {
    setOpenMenuProjectId(null);
    await onReconnectProjectFolder(projectId);
  }

  function handleDelete(projectId: string) {
    setOpenMenuProjectId(null);
    void onDeleteProject(projectId);
  }

  return (
    <>
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
                <span className="thread-group__project-copy">
                  <strong>{project.name}</strong>
                  <small>{project.branchLabel ?? project.folder?.displayPath ?? project.description}</small>
                </span>
              </button>

              <button
                type="button"
                className="thread-group__menu-trigger sidebar__icon-button"
                onClick={() => onCreateThread(project.id)}
                aria-label={`Create a new thread in ${project.name}`}
              >
                <PlusIcon />
              </button>

              {project.kind === "local" || project.removable ? (
                <div className={`thread-group__menu ${openMenuProjectId === project.id ? "is-open" : ""}`}>
                  <button
                    ref={(node) => {
                      triggerRefs.current[project.id] = node;
                    }}
                    type="button"
                    className="thread-group__menu-trigger sidebar__icon-button"
                    onClick={() => toggleProjectMenu(project.id)}
                    aria-label={`Open actions for ${project.name}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuProjectId === project.id}
                  >
                    <MoreIcon />
                  </button>
                </div>
              ) : null}
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

      {openMenuProjectId && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              className="thread-group__menu-panel thread-group__menu-panel--portal"
              role="menu"
              aria-label={`${openMenuProject?.name ?? "Project"} actions`}
              style={{
                top: menuPosition.top,
                left: menuPosition.left
              }}
            >
              {openMenuProject?.kind === "local" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="thread-group__menu-item"
                  onClick={() => void handleReconnect(openMenuProjectId)}
                >
                  <FolderRefreshIcon />
                  <span>
                    {openMenuProject.folder?.status === "connected"
                      ? "Reconnect folder"
                      : "Connect folder"}
                  </span>
                </button>
              ) : null}
              {openMenuProject?.removable ? (
                <button
                  type="button"
                  role="menuitem"
                  className="thread-group__menu-item"
                  onClick={() => handleRename(openMenuProjectId)}
                >
                  <RenameIcon />
                  <span>Rename</span>
                </button>
              ) : null}
              {openMenuProject?.removable ? (
                <button
                  type="button"
                  role="menuitem"
                  className="thread-group__menu-item thread-group__menu-item--danger"
                  onClick={() => handleDelete(openMenuProjectId)}
                >
                  <DeleteIcon />
                  <span>Remove project</span>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
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

function FolderRefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.2 6.8h3.6l1 1.4h7.2v5.3a1.1 1.1 0 0 1-1.1 1.1H5.3a1.1 1.1 0 0 1-1.1-1.1V8a1.1 1.1 0 0 1 1.1-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M12.7 5.6a3 3 0 0 1 2.8 2M15.2 5.3v2.4h-2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4.25" cy="10" r="1.3" fill="currentColor" />
      <circle cx="10" cy="10" r="1.3" fill="currentColor" />
      <circle cx="15.75" cy="10" r="1.3" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.8v10.4M4.8 10h10.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
