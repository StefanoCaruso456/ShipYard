import type { CSSProperties } from "react";

import type { AgentActivityItem, WorkspaceThreadStatus } from "../types";

type AgentActivityFeedProps = {
  activity: AgentActivityItem[];
  status: WorkspaceThreadStatus;
};

export function AgentActivityFeed({ activity, status }: AgentActivityFeedProps) {
  const liveStatusItem = buildLiveStatusItem(activity, status);
  const displayActivity = liveStatusItem ? [...activity, liveStatusItem] : activity;
  const isLive = status === "pending" || status === "running";
  const heading = isLive ? "Working" : "Execution trace";
  const headerDetail = isLive
    ? status === "pending"
      ? "Queued in runtime"
      : "Streaming execution path"
    : displayActivity.length === 1
      ? "1 update"
      : `${displayActivity.length} updates`;

  if (displayActivity.length === 0) {
    return (
      <section className="agent-activity agent-activity--empty">
        <div className="agent-activity__header">
          <div className="agent-activity__header-main">
            <strong>{heading}</strong>
          </div>
          <span>No trace captured yet</span>
        </div>
        <p>This thread does not have a detailed runtime trace yet.</p>
      </section>
    );
  }

  return (
    <section className={`agent-activity ${isLive ? "agent-activity--live" : ""}`}>
      <div className="agent-activity__header">
        <div className="agent-activity__header-main">
          <strong>{heading}</strong>
          {isLive ? (
            <span className="agent-activity__live-pill">
              <span className="agent-activity__live-pill-dot" aria-hidden="true" />
              {status === "pending" ? "Queued" : "Thinking"}
            </span>
          ) : null}
        </div>
        <span>{headerDetail}</span>
      </div>

      <div className="agent-activity__list" role="log" aria-live={isLive ? "polite" : "off"} aria-busy={isLive}>
        {displayActivity.map((item) => {
          const isActiveItem = item.sourceName === "live-status";

          return (
            <article
              key={item.id}
              className={`agent-activity__item agent-activity__item--${item.tone} agent-activity__item--${
                item.surface ?? "secondary"
              } ${isActiveItem ? "agent-activity__item--live" : ""}`}
              style={
                {
                  "--agent-activity-depth": item.depth
                } as CSSProperties
              }
            >
              <span className="agent-activity__marker" aria-hidden="true" />

              <div className="agent-activity__item-body">
                <div className="agent-activity__item-head">
                  <div className="agent-activity__title-row">
                    <span className="agent-activity__badge">{item.badge}</span>
                    <div className="agent-activity__copy">
                      <strong>{item.label}</strong>
                      {item.detail ? <p>{item.detail}</p> : null}
                    </div>
                  </div>
                  <span>{item.sourceName === "live-status" ? "Live" : item.timestamp}</span>
                </div>

                {item.meta && item.meta.length > 0 ? (
                  <div className="agent-activity__meta">
                    {item.meta.map((entry, index) => (
                      <span key={`${item.id}-meta-${index}`}>{entry}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildLiveStatusItem(
  activity: AgentActivityItem[],
  status: WorkspaceThreadStatus
): AgentActivityItem | null {
  if (status === "pending") {
    return {
      id: "agent-live-status",
      kind: "summary",
      badge: "Live",
      label: "Queued in the persistent runtime",
      detail: "The worker has accepted this thread and will start emitting execution steps shortly.",
      timestamp: "Live",
      tone: "info",
      depth: 0,
      surface: "secondary",
      status: "running",
      sourceType: "summary",
      sourceName: "live-status",
      meta: ["Awaiting worker pickup"]
    };
  }

  if (status !== "running") {
    return null;
  }

  const runningItem = [...activity].reverse().find((item) => item.status === "running");
  const latestItem = activity[activity.length - 1] ?? null;
  const label = runningItem
    ? `In progress: ${runningItem.label}`
    : latestItem?.sourceType === "model"
      ? "Waiting for the model response"
      : latestItem?.sourceType === "tool"
        ? "Waiting for the tool result"
        : "Reasoning through the next step";
  const detail = runningItem?.detail
    ? `${runningItem.detail} Still running now.`
    : latestItem?.detail
      ? `Latest step: ${latestItem.detail}`
      : "The runtime is still building context, choosing the next move, or waiting on the active step.";
  const meta = runningItem?.meta?.slice(0, 2) ?? [];

  return {
    id: "agent-live-status",
    kind: "summary",
    badge: "Live",
    label,
    detail,
    timestamp: "Live",
    tone: "info",
    depth: 0,
    surface: "secondary",
    status: "running",
    sourceType: "summary",
    sourceName: "live-status",
    meta
  };
}
