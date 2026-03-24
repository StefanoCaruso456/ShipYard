import type { CSSProperties } from "react";

import type { AgentActivityItem, WorkspaceThreadStatus } from "../types";

type AgentActivityFeedProps = {
  activity: AgentActivityItem[];
  status: WorkspaceThreadStatus;
};

export function AgentActivityFeed({ activity, status }: AgentActivityFeedProps) {
  if (activity.length === 0) {
    return (
      <section className="agent-activity agent-activity--empty">
        <div className="agent-activity__header">
          <strong>Working</strong>
          <span>{status === "running" ? "Waiting for live trace..." : "No trace captured yet"}</span>
        </div>
        <p>
          {status === "running"
            ? "Planner, executor, tool, and validation updates will appear here as the runtime emits them."
            : "This thread does not have a detailed runtime trace yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="agent-activity">
      <div className="agent-activity__header">
        <strong>Working</strong>
        <span>{activity.length} updates</span>
      </div>

      <div className="agent-activity__list">
        {activity.map((item) => (
          <article
            key={item.id}
            className={`agent-activity__item agent-activity__item--${item.tone} agent-activity__item--${
              item.surface ?? "secondary"
            }`}
            style={
              {
                "--agent-activity-depth": item.depth
              } as CSSProperties
            }
          >
            <div className="agent-activity__item-head">
              <span className="agent-activity__badge">{item.badge}</span>
              <div className="agent-activity__copy">
                <strong>{item.label}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <span>{item.timestamp}</span>
            </div>

            {item.meta && item.meta.length > 0 ? (
              <div className="agent-activity__meta">
                {item.meta.map((entry, index) => (
                  <span key={`${item.id}-meta-${index}`}>{entry}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
