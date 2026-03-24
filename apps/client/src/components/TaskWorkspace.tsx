import type { FormEvent } from "react";

import { buildSkillCatalog, seededAutomations } from "../mockData";
import type {
  ComposerAttachment,
  ComposerMode,
  ModeOption,
  ProjectPayload,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  SidebarNavItemId,
  WorkspaceProject,
  WorkspaceThread
} from "../types";
import { Composer } from "./Composer";
import { ThreadView } from "./ThreadView";

type TaskWorkspaceProps = {
  activeNav: SidebarNavItemId;
  project: WorkspaceProject | null;
  projects: WorkspaceProject[];
  projectBrief: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeStatus: RuntimeStatusResponse | null;
  instructions: RuntimeInstructionResponse | null;
  mode: ModeOption;
  modeOptions: Array<{ id: ModeOption; label: string; detail: string }>;
  composerMode: ComposerMode;
  composerValue: string;
  composerAttachments: ComposerAttachment[];
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  backendConnected: boolean;
  onProjectChange: (projectId: string) => void;
  onModeChange: (mode: ModeOption) => void;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerValueChange: (value: string) => void;
  onComposerAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onSelectSuggestion: (prompt: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const navTitles: Record<SidebarNavItemId, string> = {
  projects: "Workspace",
  skills: "Skills",
  automations: "Automations",
  settings: "Settings"
};

export function TaskWorkspace({
  activeNav,
  project,
  projects,
  projectBrief,
  thread,
  runtimeStatus,
  instructions,
  mode,
  modeOptions,
  composerMode,
  composerValue,
  composerAttachments,
  feedback,
  submitting,
  backendConnected,
  onProjectChange,
  onModeChange,
  onComposerModeChange,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onSelectSuggestion,
  onSubmit
}: TaskWorkspaceProps) {
  const runtimeState = backendConnected
    ? runtimeStatus?.workerState === "running"
      ? "running"
      : "idle"
    : "error";
  const runtimeLabel = backendConnected
    ? runtimeState === "running"
      ? "Running"
      : "Idle"
    : "Error";
  const activeTitle =
    activeNav === "projects" ? thread?.title ?? "New thread" : navTitles[activeNav];
  const suggestionCards = buildSuggestions(project);
  const skills = buildSkillCatalog(instructions);

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div className="workspace__header-main">
          <label className="workspace__project-select">
            <span className="workspace__project-label">Project</span>
            <select
              value={project?.id ?? ""}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>

          <div className="workspace__title">
            <p>{project?.environment ?? "Workspace"}</p>
            <h2>{activeTitle}</h2>
          </div>
        </div>

        <div className="workspace__actions">
          <div className="workspace__modes" aria-label="Execution mode">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`workspace__mode ${option.id === mode ? "is-active" : ""}`}
                onClick={() => onModeChange(option.id)}
                title={option.detail}
              >
                {option.label}
              </button>
            ))}
          </div>

          <span className={`workspace__runtime workspace__runtime--${runtimeState}`}>
            {runtimeLabel}
          </span>

          <div className="workspace__utility-buttons" aria-label="Utility controls">
            <button type="button" className="workspace__icon-button" aria-label="Open thread history">
              <HistoryIcon />
            </button>
            <button type="button" className="workspace__icon-button" aria-label="Open repo overview">
              <RepoIcon />
            </button>
            <button type="button" className="workspace__icon-button" aria-label="Open split view">
              <SplitIcon />
            </button>
          </div>
        </div>
      </header>

      <div className="workspace__content">
        {activeNav === "projects" ? (
          <ThreadView
            project={project}
            thread={thread}
            runtimeState={runtimeState}
            suggestions={suggestionCards}
            onSelectSuggestion={onSelectSuggestion}
          />
        ) : activeNav === "skills" ? (
          <section className="workspace-panel">
            <div className="workspace-panel__header">
              <h3>Skills</h3>
              <span>{skills.length} available</span>
            </div>
            <div className="workspace-panel__stack">
              {skills.map((skill) => (
                <article key={skill.id} className="workspace-card">
                  <strong>{skill.name}</strong>
                  <p>{skill.description}</p>
                  <div className="workspace-card__meta">
                    <span>{skill.scope}</span>
                    <span>{skill.status}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : activeNav === "automations" ? (
          <section className="workspace-panel">
            <div className="workspace-panel__header">
              <h3>Automations</h3>
              <span>Preview surfaces</span>
            </div>
            <div className="workspace-panel__stack">
              {seededAutomations.map((automation) => (
                <article key={automation.id} className="workspace-card">
                  <strong>{automation.name}</strong>
                  <p>{automation.note}</p>
                  <div className="workspace-card__meta">
                    <span>{automation.schedule}</span>
                    <span>{automation.workspace}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="workspace-panel">
            <div className="workspace-panel__header">
              <h3>Runtime settings</h3>
              <span>{backendConnected ? "Connected" : "Offline"}</span>
            </div>
            <div className="settings-grid">
              <div className="settings-grid__row">
                <span>Status</span>
                <strong>{runtimeLabel}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Queued runs</span>
                <strong>{runtimeStatus?.queuedRuns ?? 0}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Total runs</span>
                <strong>{runtimeStatus?.totalRuns ?? 0}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Instruction skill</span>
                <strong>{instructions?.skill.meta.name ?? "Unavailable"}</strong>
              </div>
              <div className="settings-grid__row">
                <span>Next step</span>
                <strong>{projectBrief.nextStep}</strong>
              </div>
            </div>
          </section>
        )}
      </div>

      <Composer
        project={project}
        composerMode={composerMode}
        composerValue={composerValue}
        attachments={composerAttachments}
        feedback={feedback}
        submitting={submitting}
        backendConnected={backendConnected}
        onComposerModeChange={onComposerModeChange}
        onComposerValueChange={onComposerValueChange}
        onAttachmentsChange={onComposerAttachmentsChange}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function buildSuggestions(project: WorkspaceProject | null) {
  const label = project?.name ?? "Shipyard";

  return [
    {
      id: "suggestion-1",
      title: "Plan the next feature",
      prompt: `Map the next implementation step for ${label} and keep it scoped.`
    },
    {
      id: "suggestion-2",
      title: "Review runtime status",
      prompt: `Summarize the current runtime state for ${label} and identify the next backend task.`
    },
    {
      id: "suggestion-3",
      title: "Refine the frontend shell",
      prompt: `Review the current workspace shell against the frontend UI rules and suggest the next improvement.`
    },
    {
      id: "suggestion-4",
      title: "Draft a coding task",
      prompt: `Create a clear task prompt for the next coding step in ${label}.`
    }
  ];
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5.5 6.5V3.8M5.5 3.8H8M5.5 3.8A7 7 0 1 1 3 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 6.7v3.4l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6.2 5h7.6A1.2 1.2 0 0 1 15 6.2v7.6a1.2 1.2 0 0 1-1.2 1.2H6.2A1.2 1.2 0 0 1 5 13.8V6.2A1.2 1.2 0 0 1 6.2 5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M7.5 8h5M7.5 10.5h5M7.5 13h3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.8 5.2h10.4A1.2 1.2 0 0 1 16.4 6.4v7.2a1.2 1.2 0 0 1-1.2 1.2H4.8a1.2 1.2 0 0 1-1.2-1.2V6.4a1.2 1.2 0 0 1 1.2-1.2zM10 5.2v9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
