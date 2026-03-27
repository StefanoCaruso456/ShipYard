import { useState } from "react";

import type { RuntimeTerminalCommandEntry } from "../types";

type TerminalPanelProps = {
  entries: RuntimeTerminalCommandEntry[];
};

const COLLAPSE_OUTPUT_LENGTH = 900;
const COLLAPSE_OUTPUT_LINES = 18;

export function TerminalPanel({ entries }: TerminalPanelProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="terminal-panel">
      <div className="terminal-panel__header">
        <div className="terminal-panel__header-main">
          <strong>Terminal</strong>
          <span className="terminal-panel__header-pill">Live transcript</span>
        </div>
        <span>{entries.length === 1 ? "1 command" : `${entries.length} commands`}</span>
      </div>

      <div className="terminal-panel__list">
        {entries.map((entry) => (
          <TerminalPanelEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function TerminalPanelEntry({ entry }: { entry: RuntimeTerminalCommandEntry }) {
  const output = entry.combinedOutput.trim() ? entry.combinedOutput : "(no output)";
  const collapsible =
    output.length > COLLAPSE_OUTPUT_LENGTH || output.split("\n").length > COLLAPSE_OUTPUT_LINES;
  const [expanded, setExpanded] = useState(entry.status === "running" || !collapsible);
  const preview = collapsible ? createOutputPreview(output) : output;

  return (
    <article className={`terminal-panel__entry terminal-panel__entry--${entry.status}`}>
      <div className="terminal-panel__entry-head">
        <div className="terminal-panel__entry-copy">
          <span className={`terminal-panel__badge terminal-panel__badge--${entry.category}`}>
            {humanizeCategory(entry.category)}
          </span>
          <strong>{entry.commandLine}</strong>
          <span className="terminal-panel__entry-meta">
            {entry.cwd} · {entry.status === "running" ? "running" : `exit ${entry.exitCode ?? "?"}`}
            {typeof entry.durationMs === "number" ? ` · ${entry.durationMs} ms` : ""}
          </span>
        </div>
        <span>{formatTerminalTimestamp(entry.startedAt)}</span>
      </div>

      <pre className="terminal-panel__command">
        <code>$ {entry.commandLine}</code>
      </pre>

      <pre className="terminal-panel__output">
        <code>{expanded ? output : preview}</code>
      </pre>

      {collapsible ? (
        <button
          type="button"
          className="terminal-panel__toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Collapse output" : "Show full output"}
        </button>
      ) : null}
    </article>
  );
}

function createOutputPreview(output: string) {
  const lines = output.split("\n");
  const previewLines = lines.slice(0, COLLAPSE_OUTPUT_LINES);
  const preview = previewLines.join("\n");

  if (preview.length >= COLLAPSE_OUTPUT_LENGTH) {
    return `${preview.slice(0, COLLAPSE_OUTPUT_LENGTH)}\n…`;
  }

  return lines.length > COLLAPSE_OUTPUT_LINES ? `${preview}\n…` : preview;
}

function humanizeCategory(category: RuntimeTerminalCommandEntry["category"]) {
  switch (category) {
    case "git":
      return "Git";
    case "ci":
      return "CI";
    case "browser":
      return "Browser";
    default:
      return "Shell";
  }
}

function formatTerminalTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}
