import type { WorkspaceThread } from "../types";
import { AgentActivityFeed } from "./AgentActivityFeed";

type LiveRuntimeStageProps = {
  thread: WorkspaceThread;
  onRequestSteer: () => void;
};

export function LiveRuntimeStage({ thread, onRequestSteer }: LiveRuntimeStageProps) {
  const liveRuntime = thread.liveRuntime;
  const focusedRun = liveRuntime?.focusedRun;

  if (!liveRuntime || !focusedRun) {
    return null;
  }

  const queuedFollowUps = liveRuntime.queuedFollowUps;
  const canSteer = thread.status === "running" || thread.status === "pending";
  const activeHeading =
    thread.status === "running"
      ? "Reasoning through the current request"
      : thread.status === "pending"
        ? "Current request is queued"
        : "Latest request";
  const activeDetail =
    thread.status === "running"
      ? queuedFollowUps.length > 0
        ? `${queuedFollowUps.length} steer follow-up${queuedFollowUps.length === 1 ? "" : "s"} will run next without interrupting the active reasoning.`
        : "You can queue a steer follow-up now and it will run after the current reasoning finishes."
      : thread.status === "pending"
        ? queuedFollowUps.length > 0
          ? `${queuedFollowUps.length} follow-up${queuedFollowUps.length === 1 ? "" : "s"} are already lined up on this thread.`
          : "The worker has accepted this request and will start the reasoning path shortly."
        : liveRuntime.completedRunCount > 1
          ? `${liveRuntime.completedRunCount} requests have completed on this thread.`
          : "The latest runtime request has finished.";

  return (
    <section className="live-runtime-stage">
      <article className="live-runtime-stage__active">
        <div className="live-runtime-stage__eyebrow">
          <span className="live-runtime-stage__badge">Current prompt</span>
          <span>{focusedRun.startedAt ?? focusedRun.createdAt}</span>
        </div>

        <div className="live-runtime-stage__title-row">
          <div className="live-runtime-stage__title-copy">
            <strong>{activeHeading}</strong>
            <p>{activeDetail}</p>
          </div>

          {canSteer ? (
            <button
              type="button"
              className="live-runtime-stage__steer-button"
              onClick={onRequestSteer}
            >
              Steer
            </button>
          ) : null}
        </div>

        <p className="live-runtime-stage__prompt">{focusedRun.instruction}</p>

        <div className="live-runtime-stage__meta">
          <span>{focusedRun.status === "running" ? "Reasoning live" : "Accepted by runtime"}</span>
          {focusedRun.attachmentsCount > 0 ? (
            <span>
              {focusedRun.attachmentsCount} attachment{focusedRun.attachmentsCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {queuedFollowUps.length > 0 ? (
            <span>
              {queuedFollowUps.length} queued next
            </span>
          ) : null}
        </div>
      </article>

      <AgentActivityFeed activity={thread.activity ?? []} status={thread.status} />

      <section className="steer-queue">
        <div className="steer-queue__header">
          <div>
            <strong>Steer queue</strong>
            <span>
              {queuedFollowUps.length > 0
                ? `${queuedFollowUps.length} follow-up${queuedFollowUps.length === 1 ? "" : "s"} staged`
                : "No follow-up queued yet"}
            </span>
          </div>

          {canSteer ? (
            <button
              type="button"
              className="steer-queue__action"
              onClick={onRequestSteer}
            >
              Open steer
            </button>
          ) : null}
        </div>

        {queuedFollowUps.length > 0 ? (
          <div className="steer-queue__list">
            {queuedFollowUps.map((item, index) => (
              <article
                key={item.id}
                className={`steer-queue__item steer-queue__item--${item.state}`}
              >
                <div className="steer-queue__item-head">
                  <div className="steer-queue__label-row">
                    <span className="steer-queue__badge">
                      {item.state === "sending"
                        ? "Sending"
                        : index === 0
                          ? "Queued next"
                          : "Queued later"}
                    </span>
                    <strong>
                      {item.state === "sending"
                        ? "Submitting steer follow-up"
                        : "Steer follow-up ready"}
                    </strong>
                  </div>
                  <span>{item.createdAt}</span>
                </div>

                <p>{item.instruction}</p>

                <div className="steer-queue__meta">
                  <span>{item.state === "sending" ? "Keeping the current run uninterrupted" : "Runs after the active prompt"}</span>
                  {item.attachmentsCount > 0 ? (
                    <span>
                      {item.attachmentsCount} attachment{item.attachmentsCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="steer-queue__empty">
            While this run is working, open steer and send a follow-up. It will queue on this thread instead of interrupting the current reasoning.
          </p>
        )}
      </section>
    </section>
  );
}
