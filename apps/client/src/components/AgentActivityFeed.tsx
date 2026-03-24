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
          <strong>Agent activity</strong>
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
        <strong>Agent activity</strong>
        <span>{activity.length} updates</span>
      </div>

      <div className="agent-activity__list">
        {activity.map((item) => (
          <article
            key={item.id}
            className={`agent-activity__item agent-activity__item--${item.tone}`}
            style={
              {
                "--agent-activity-depth": item.depth
              } as CSSProperties
            }
          >
            <div className="agent-activity__item-head">
              <span className="agent-activity__badge">{item.badge}</span>
              <strong>{item.label}</strong>
              <span>{item.timestamp}</span>
            </div>

            <p>{item.detail}</p>

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
