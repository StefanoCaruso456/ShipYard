import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type {
  AutomationItem,
  ModeOption,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  SidebarNavItemId,
  SkillCatalogItem,
  WorkspaceThread
} from "../types";

type TaskWorkspaceProps = {
  activeNav: SidebarNavItemId;
  project: {
    id: string;
    name: string;
    environment: string;
    kind: "live" | "preview";
  };
  projectBrief: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeHealth: RuntimeHealthResponse | null;
  runtimeStatus: RuntimeStatusResponse | null;
  instructions: RuntimeInstructionResponse | null;
  mode: ModeOption;
  modeOptions: Array<{ id: ModeOption; label: string; detail: string }>;
  composerValue: string;
  feedback: { tone: "success" | "danger" | "info"; text: string } | null;
  submitting: boolean;
  simulateFailure: boolean;
  selectedSkillIds: string[];
  skillCatalog: SkillCatalogItem[];
  automations: AutomationItem[];
  backendConnected: boolean;
  repositoryUrl: string;
  onModeChange: (mode: ModeOption) => void;
  onComposerValueChange: (value: string) => void;
  onSimulateFailureChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onHandoff: () => void;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
  onToggleSkill: (skillId: string) => void;
  onCreateAutomation: (input: {
    name: string;
    schedule: string;
    workspace: string;
    note: string;
  }) => void;
};

type FeedEntry =
  | {
      id: string;
      kind: "note";
      label: string;
      timestamp: string;
      tone: "default" | "info" | "success" | "danger";
      body: string;
    }
  | {
      id: string;
      kind: "log";
      label: string;
      timestamp: string;
      detail: string;
      tone: "default" | "info" | "success" | "warning" | "danger";
    };

export function TaskWorkspace({
  activeNav,
  project,
  projectBrief,
  thread,
  runtimeHealth,
  runtimeStatus,
  instructions,
  mode,
  modeOptions,
  composerValue,
  feedback,
  submitting,
  simulateFailure,
  selectedSkillIds,
  skillCatalog,
  automations,
  backendConnected,
  repositoryUrl,
  onModeChange,
  onComposerValueChange,
  onSimulateFailureChange,
  onSubmit,
  onHandoff,
  onOpenSettings,
  onOpenProjects,
  onToggleSkill,
  onCreateAutomation
}: TaskWorkspaceProps) {
  const [automationName, setAutomationName] = useState("");
  const [automationSchedule, setAutomationSchedule] = useState("Weekdays · 9:00 AM");
  const [automationNote, setAutomationNote] = useState("");

  const headerTitle =
    activeNav === "projects"
      ? thread?.title ?? "New thread"
      : activeNav === "skills"
        ? "Skills"
        : activeNav === "automations"
          ? "Automations"
          : "Settings";
  const headerMeta =
    activeNav === "projects"
      ? project.name
      : activeNav === "skills"
        ? "Runtime skills and attachments"
        : activeNav === "automations"
          ? "Scheduled work and drafts"
          : "Runtime and instruction status";
  const feedEntries = useMemo(() => buildFeedEntries(thread), [thread]);
  const runningServices = 1 + (backendConnected ? 1 : 0);

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div className="workspace__title">
          <p>{headerMeta}</p>
          <h2>{headerTitle}</h2>
        </div>

        <div className="workspace__actions">
          <div className="workspace__modes">
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

          <button type="button" className="workspace__action-button" onClick={onHandoff}>
            Handoff
          </button>
          <a className="workspace__action-button" href={repositoryUrl} target="_blank" rel="noreferrer">
            Repo
          </a>
          <button type="button" className="workspace__icon-button" onClick={onOpenSettings} aria-label="Open settings">
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="workspace__body">
        {activeNav === "projects" ? (
          <div className="workspace__scroll">
            {feedEntries.length > 0 ? (
              feedEntries.map((entry) =>
                entry.kind === "log" ? (
                  <div key={entry.id} className={`feed-log feed-log--${entry.tone}`}>
                    <strong>{entry.label}</strong>
                    <span>{entry.timestamp}</span>
                    <p>{entry.detail}</p>
                  </div>
                ) : (
                  <article key={entry.id} className={`feed-note feed-note--${entry.tone}`}>
                    <div className="feed-note__meta">
                      <strong>{entry.label}</strong>
                      <span>{entry.timestamp}</span>
                    </div>
                    <p>{entry.body}</p>
                  </article>
                )
              )
            ) : (
              <div className="empty-panel">
                <h3>No thread selected</h3>
                <p>Choose a thread from the left rail or create a new one.</p>
              </div>
            )}

            {thread?.id === "runtime-guide" && projectBrief.what.length > 0 ? (
              <section className="brief-section">
                <BriefBlock title="What" items={projectBrief.what} />
                <BriefBlock title="Why" items={projectBrief.why} />
                <BriefBlock title="How" items={projectBrief.how} />
                <BriefBlock title="Outcome" items={projectBrief.outcome} />
              </section>
            ) : null}
          </div>
        ) : null}

        {activeNav === "skills" ? (
          <div className="workspace__scroll">
            <section className="panel-stack">
              <div className="info-banner">
                <strong>{instructions?.skill.meta.name ?? "Runtime skill unavailable"}</strong>
                <p>
                  {instructions
                    ? `${instructions.skill.sectionCount} sections are loaded into the runtime.`
                    : "Start the backend to inspect the loaded runtime skill."}
                </p>
              </div>

              {skillCatalog.map((skill) => {
                const attached = selectedSkillIds.includes(skill.id);

                return (
                  <article key={skill.id} className="list-card">
                    <div className="list-card__header">
                      <div>
                        <strong>{skill.name}</strong>
                        <p>{skill.scope}</p>
                      </div>
                      <button
                        type="button"
                        className={`pill-button ${attached ? "is-active" : ""}`}
                        onClick={() => onToggleSkill(skill.id)}
                      >
                        {attached ? "Attached" : "Attach"}
                      </button>
                    </div>
                    <p className="list-card__body">{skill.description}</p>
                    <small>{skill.status}</small>
                  </article>
                );
              })}
            </section>
          </div>
        ) : null}

        {activeNav === "automations" ? (
          <div className="workspace__scroll">
            <section className="panel-stack">
              <form
                className="automation-form"
                onSubmit={(event) => {
                  event.preventDefault();

                  if (!automationName.trim()) {
                    return;
                  }

                  onCreateAutomation({
                    name: automationName.trim(),
                    schedule: automationSchedule.trim(),
                    workspace: project.name,
                    note: automationNote.trim() || "UI-only draft until scheduling is wired."
                  });

                  setAutomationName("");
                  setAutomationSchedule("Weekdays · 9:00 AM");
                  setAutomationNote("");
                }}
              >
                <div className="list-card__header">
                  <div>
                    <strong>New automation</strong>
                    <p>Stage recurring work without leaving the shell.</p>
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Automation name"
                  value={automationName}
                  onChange={(event) => setAutomationName(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Schedule"
                  value={automationSchedule}
                  onChange={(event) => setAutomationSchedule(event.target.value)}
                />
                <textarea
                  rows={4}
                  placeholder="Notes"
                  value={automationNote}
                  onChange={(event) => setAutomationNote(event.target.value)}
                />
                <button type="submit" className="pill-button is-active">
                  Save draft
                </button>
              </form>

              {automations.map((automation) => (
                <article key={automation.id} className="list-card">
                  <div className="list-card__header">
                    <div>
                      <strong>{automation.name}</strong>
                      <p>{automation.workspace}</p>
                    </div>
                    <span className={`status-chip status-chip--${automation.status}`}>{automation.status}</span>
                  </div>
                  <p className="list-card__body">{automation.note}</p>
                  <small>{automation.schedule}</small>
                </article>
              ))}
            </section>
          </div>
        ) : null}

        {activeNav === "settings" ? (
          <div className="workspace__scroll">
            <section className="panel-stack">
              <article className="list-card">
                <div className="list-card__header">
                  <div>
                    <strong>Runtime</strong>
                    <p>Persistent loop service</p>
                  </div>
                  <span className={`status-chip status-chip--${backendConnected ? "active" : "draft"}`}>
                    {backendConnected ? "live" : "offline"}
                  </span>
                </div>
                <p className="list-card__body">
                  Worker: {runtimeStatus?.workerState ?? "offline"} · queued: {runtimeStatus?.queuedRuns ?? 0} · total runs:{" "}
                  {runtimeStatus?.totalRuns ?? 0}
                </p>
                <small>{runtimeHealth?.instructions.loadedAt ?? "Instruction runtime unavailable"}</small>
              </article>

              <article className="list-card">
                <div className="list-card__header">
                  <div>
                    <strong>Instruction precedence</strong>
                    <p>Current runtime ordering</p>
                  </div>
                </div>
                <ol className="ordered-list">
                  {(instructions?.instructionPrecedence ?? ["Runtime unavailable"]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </article>

              <article className="list-card">
                <div className="list-card__header">
                  <div>
                    <strong>Direction lock</strong>
                    <p>Current product brief</p>
                  </div>
                </div>
                <p className="list-card__body">{projectBrief.tagline}</p>
                <div className="mini-grid">
                  {projectBrief.agentDecisions.slice(0, 4).map((decision) => (
                    <div key={decision.area} className="mini-grid__item">
                      <strong>{decision.area}</strong>
                      <span>{decision.status}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>
        ) : null}
      </div>

      <div className="workspace__console-bar">
        <button type="button" className="workspace__console-button" onClick={onOpenProjects}>
          Running {runningServices} service{runningServices === 1 ? "" : "s"}
        </button>
        <div className="workspace__console-meta">
          <span>{mode}</span>
          <span>{backendConnected ? "Runtime live" : "Runtime offline"}</span>
          <span>{selectedSkillIds.length} skill{selectedSkillIds.length === 1 ? "" : "s"} attached</span>
        </div>
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={composerValue}
          onChange={(event) => onComposerValueChange(event.target.value)}
          placeholder="Ask for follow-up changes"
          rows={4}
        />

        <div className="composer__footer">
          <div className="composer__meta">
            <label className="composer__toggle">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(event) => onSimulateFailureChange(event.target.checked)}
              />
              <span>Simulate failure path</span>
            </label>
            {feedback ? <p className={`composer__feedback composer__feedback--${feedback.tone}`}>{feedback.text}</p> : null}
          </div>

          <button
            type="submit"
            className="composer__submit"
            disabled={submitting || project.kind !== "live" || !backendConnected}
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

function buildFeedEntries(thread: WorkspaceThread | null): FeedEntry[] {
  if (!thread) {
    return [];
  }

  return [
    ...thread.progress.map(
      (event): FeedEntry => ({
        id: event.id,
        kind: "log",
        label: event.label,
        timestamp: event.timestamp,
        detail: event.detail,
        tone: event.tone
      })
    ),
    ...thread.messages.map(
      (message): FeedEntry => ({
        id: message.id,
        kind: "note",
        label: message.label,
        timestamp: message.timestamp,
        tone: message.tone,
        body: message.body
      })
    )
  ];
}

function BriefBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="brief-block">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 5.5h4.3v9H4.5zM11.2 5.5h4.3v4.3h-4.3zM11.2 11.2h4.3v3.8h-4.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
