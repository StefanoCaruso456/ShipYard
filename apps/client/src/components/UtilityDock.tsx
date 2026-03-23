import { useState } from "react";

import type {
  AutomationItem,
  GitChange,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  SkillCatalogItem,
  TerminalEntry,
  UtilityTab,
  WorkspaceThread
} from "../types";

type UtilityDockProps = {
  activeTab: UtilityTab;
  tabs: Array<{ id: UtilityTab; label: string; tone: "live" | "preview" }>;
  project: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeHealth: RuntimeHealthResponse | null;
  runtimeStatus: RuntimeStatusResponse | null;
  instructions: RuntimeInstructionResponse | null;
  gitChanges: GitChange[];
  terminalEntries: TerminalEntry[];
  skillCatalog: SkillCatalogItem[];
  selectedSkillIds: string[];
  automations: AutomationItem[];
  onSelectTab: (tab: UtilityTab) => void;
  onToggleSkill: (skillId: string) => void;
  onCreateAutomation: (input: {
    name: string;
    schedule: string;
    workspace: string;
    note: string;
  }) => void;
};

export function UtilityDock({
  activeTab,
  tabs,
  project,
  thread,
  runtimeHealth,
  runtimeStatus,
  instructions,
  gitChanges,
  terminalEntries,
  skillCatalog,
  selectedSkillIds,
  automations,
  onSelectTab,
  onToggleSkill,
  onCreateAutomation
}: UtilityDockProps) {
  return (
    <aside className="utility-dock">
      <div className="utility-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`utility-tabs__item ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.tone === "live" ? "wired" : "preview"}</small>
          </button>
        ))}
      </div>

      {activeTab === "run" ? (
        <RunPanel
          project={project}
          thread={thread}
          runtimeHealth={runtimeHealth}
          runtimeStatus={runtimeStatus}
          instructions={instructions}
        />
      ) : null}
      {activeTab === "diff" ? <DiffPanel gitChanges={gitChanges} /> : null}
      {activeTab === "terminal" ? <TerminalPanel entries={terminalEntries} /> : null}
      {activeTab === "skills" ? (
        <SkillsPanel
          instructions={instructions}
          skillCatalog={skillCatalog}
          selectedSkillIds={selectedSkillIds}
          onToggleSkill={onToggleSkill}
        />
      ) : null}
      {activeTab === "automations" ? (
        <AutomationsPanel automations={automations} onCreateAutomation={onCreateAutomation} />
      ) : null}
    </aside>
  );
}

function RunPanel({
  project,
  thread,
  runtimeHealth,
  runtimeStatus,
  instructions
}: {
  project: ProjectPayload;
  thread: WorkspaceThread | null;
  runtimeHealth: RuntimeHealthResponse | null;
  runtimeStatus: RuntimeStatusResponse | null;
  instructions: RuntimeInstructionResponse | null;
}) {
  return (
    <section className="panel utility-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Debug</p>
          <h3>Run details</h3>
        </div>
        <span className={`tone-badge tone-badge--${runtimeHealth?.status === "ok" ? "ready" : "offline"}`}>
          {runtimeHealth?.status === "ok" ? "Live" : "Unavailable"}
        </span>
      </div>

      <div className="metric-grid">
        <MetricCard label="Worker" value={runtimeStatus?.workerState ?? "offline"} />
        <MetricCard label="Queued" value={String(runtimeStatus?.queuedRuns ?? 0)} />
        <MetricCard label="Total runs" value={String(runtimeStatus?.totalRuns ?? 0)} />
        <MetricCard label="Skill" value={runtimeStatus?.instructions.skillId ?? "n/a"} />
      </div>

      <div className="utility-stack">
        <article className="subpanel">
          <h4>Selected thread</h4>
          <p>{thread?.title ?? "No thread selected."}</p>
          <small>{thread?.summary ?? "Choose a thread to inspect its runtime surface."}</small>
        </article>

        <article className="subpanel">
          <h4>Instruction precedence</h4>
          <ol className="ordered-list">
            {(instructions?.instructionPrecedence ?? ["Runtime unavailable"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>

        <article className="subpanel">
          <h4>Decision board</h4>
          <div className="decision-list">
            {project.agentDecisions.slice(0, 3).map((decision) => (
              <div key={decision.area} className="decision-item">
                <strong>{decision.area}</strong>
                <span className={`status-pill status-pill--${decision.status}`}>{decision.status}</span>
                <p>{decision.note}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function DiffPanel({ gitChanges }: { gitChanges: GitChange[] }) {
  return (
    <section className="panel utility-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Preview Surface</p>
          <h3>Diff / Git</h3>
        </div>
        <span className="tone-badge tone-badge--busy">UI shell</span>
      </div>
      <p className="utility-copy">
        This surface is intentionally frontend-only in Phase 2. It shows where diff review and Git
        state will live once file editing is wired.
      </p>
      <div className="change-list">
        {gitChanges.map((change) => (
          <article key={change.path} className="change-row">
            <span className={`change-pill change-pill--${change.changeType.toLowerCase()}`}>
              {change.changeType}
            </span>
            <div>
              <strong>{change.path}</strong>
              <p>{change.summary}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TerminalPanel({ entries }: { entries: TerminalEntry[] }) {
  return (
    <section className="panel utility-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Preview Surface</p>
          <h3>Terminal</h3>
        </div>
        <span className="tone-badge tone-badge--busy">Playback</span>
      </div>
      <div className="terminal">
        {entries.map((entry) => (
          <div key={entry.id} className={`terminal__line terminal__line--${entry.tone}`}>
            <span>{entry.timestamp}</span>
            <code>{entry.text}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function SkillsPanel({
  instructions,
  skillCatalog,
  selectedSkillIds,
  onToggleSkill
}: {
  instructions: RuntimeInstructionResponse | null;
  skillCatalog: SkillCatalogItem[];
  selectedSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
}) {
  return (
    <section className="panel utility-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Wired + Preview</p>
          <h3>Skills</h3>
        </div>
        <span className="tone-badge tone-badge--ready">
          {selectedSkillIds.length} selected
        </span>
      </div>

      {instructions ? (
        <article className="subpanel">
          <h4>Loaded runtime skill</h4>
          <p>
            {instructions.skill.meta.name} v{instructions.skill.meta.version}
          </p>
          <small>{instructions.skill.sectionCount} sections parsed into role-specific views.</small>
        </article>
      ) : null}

      <div className="skill-list">
        {skillCatalog.map((skill) => {
          const isSelected = selectedSkillIds.includes(skill.id);

          return (
            <article key={skill.id} className="skill-card">
              <div className="skill-card__top">
                <div>
                  <strong>{skill.name}</strong>
                  <p>{skill.scope}</p>
                </div>
                <button
                  type="button"
                  className={`ghost-button ${isSelected ? "is-active" : ""}`}
                  onClick={() => onToggleSkill(skill.id)}
                >
                  {isSelected ? "Attached" : "Attach"}
                </button>
              </div>
              <p>{skill.description}</p>
              <small>{skill.status}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AutomationsPanel({
  automations,
  onCreateAutomation
}: {
  automations: AutomationItem[];
  onCreateAutomation: (input: {
    name: string;
    schedule: string;
    workspace: string;
    note: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("Weekdays · 9:00 AM");
  const [workspace, setWorkspace] = useState("Shipyard Runtime");
  const [note, setNote] = useState("");

  return (
    <section className="panel utility-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Preview Surface</p>
          <h3>Automations</h3>
        </div>
        <span className="tone-badge tone-badge--busy">Form staged</span>
      </div>

      <form
        className="automation-form"
        onSubmit={(event) => {
          event.preventDefault();

          if (!name.trim()) {
            return;
          }

          onCreateAutomation({
            name: name.trim(),
            schedule: schedule.trim(),
            workspace: workspace.trim(),
            note: note.trim() || "UI-only draft until scheduling is wired."
          });

          setName("");
          setSchedule("Weekdays · 9:00 AM");
          setWorkspace("Shipyard Runtime");
          setNote("");
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Automation name"
        />
        <input
          type="text"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          placeholder="Schedule"
        />
        <input
          type="text"
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
          placeholder="Workspace"
        />
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What should this automation do?"
          rows={3}
        />
        <button type="submit" className="primary-button">
          Draft automation
        </button>
      </form>

      <div className="automation-list">
        {automations.map((automation) => (
          <article key={automation.id} className="automation-card">
            <div className="automation-card__top">
              <strong>{automation.name}</strong>
              <span className={`status-pill status-pill--${automation.status}`}>{automation.status}</span>
            </div>
            <p>{automation.workspace}</p>
            <small>{automation.schedule}</small>
            <p>{automation.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
