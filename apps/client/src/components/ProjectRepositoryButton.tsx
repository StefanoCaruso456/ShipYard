import { useEffect, useRef, useState } from "react";

import type { WorkspaceProject } from "../types";

type ProjectRepositoryButtonProps = {
  project: WorkspaceProject;
  onRefresh: (projectId: string) => Promise<void>;
};

export function ProjectRepositoryButton({
  project,
  onRefresh
}: ProjectRepositoryButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const repository = project.repository;
  const isGitHub = repository?.provider === "github" && Boolean(repository.url);
  const heading = isGitHub ? "GitHub connection" : "Repository connection";
  const subtitle = repository?.label ?? project.folder?.displayPath ?? project.name;
  const triggerLabel = isGitHub
    ? "GitHub"
    : repository
      ? "Repository"
      : "Repo";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleRefresh() {
    setRefreshing(true);

    try {
      await onRefresh(project.id);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`project-repository-button ${isOpen ? "is-open" : ""}`}
    >
      <button
        type="button"
        className="project-repository-button__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isGitHub ? "Open GitHub connection details" : "Open repository connection details"}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={repository?.url ?? "Repository connection"}
      >
        {isGitHub ? <GitHubIcon /> : <RepositoryIcon />}
        <span className="project-repository-button__label">{triggerLabel}</span>
        <ChevronIcon />
      </button>

      {isOpen ? (
        <div
          className="project-repository-button__panel"
          role="dialog"
          aria-label={heading}
        >
          <div className="project-repository-button__header">
            <div>
              <strong>{heading}</strong>
              <span>{subtitle}</span>
            </div>
            {repository?.currentBranch ? (
              <span className="project-repository-button__badge">{repository.currentBranch}</span>
            ) : null}
          </div>

          {project.folder?.status === "needs-access" ? (
            <p className="project-repository-button__notice">
              Reconnect the local folder to refresh repository metadata.
            </p>
          ) : null}

          {repository ? (
            <dl className="project-repository-button__details">
              <div>
                <dt>Provider</dt>
                <dd>{repository.provider === "github" ? "GitHub" : "Git"}</dd>
              </div>
              <div>
                <dt>Remote</dt>
                <dd>{repository.remoteName ?? "origin"}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{repository.currentBranch ?? "Detached / unknown"}</dd>
              </div>
              <div>
                <dt>Link</dt>
                <dd>{repository.url ?? "No remote URL detected"}</dd>
              </div>
            </dl>
          ) : (
            <p className="project-repository-button__notice">
              No git repository metadata has been detected for this connected folder yet.
            </p>
          )}

          <div className="project-repository-button__actions">
            {repository?.url ? (
              <a
                className="project-repository-button__action project-repository-button__action--primary"
                href={repository.url}
                target="_blank"
                rel="noreferrer"
              >
                {isGitHub ? "Open GitHub" : "Open repository"}
                <OpenLinkIcon />
              </a>
            ) : null}

            <button
              type="button"
              className="project-repository-button__action"
              onClick={() => void handleRefresh()}
              disabled={refreshing || project.folder?.status === "needs-access"}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 .9a9.1 9.1 0 0 0-2.88 17.73c.45.08.62-.2.62-.45v-1.57c-2.52.55-3.05-1.08-3.05-1.08-.4-1.03-1-1.3-1-1.3-.82-.56.06-.55.06-.55.9.07 1.37.93 1.37.93.8 1.39 2.1.99 2.6.75.08-.58.31-.99.57-1.22-2.01-.23-4.12-1.01-4.12-4.5 0-1 .35-1.83.92-2.47-.1-.23-.4-1.17.08-2.44 0 0 .76-.24 2.5.94a8.7 8.7 0 0 1 4.56 0c1.74-1.18 2.5-.94 2.5-.94.48 1.27.18 2.21.08 2.44.57.64.92 1.47.92 2.47 0 3.5-2.1 4.27-4.12 4.5.32.28.6.82.6 1.66v2.45c0 .25.16.53.62.45A9.1 9.1 0 0 0 10 .9Z"
      />
    </svg>
  );
}

function RepositoryIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 4.5h6.2l1.1 1.25h3.7v9.75H4.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 7.1h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6.25 8.25 10 12l3.75-3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OpenLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M8 4.75h7.25V12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 5.2 7.1 12.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12.25 9.25v5H4.75v-7.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
