import type { WorkspaceThread } from "../types";
import { AgentActivityFeed } from "./AgentActivityFeed";
import { OperatorRunOverview } from "./OperatorRunOverview";

type LiveRuntimeStageProps = {
  thread: WorkspaceThread;
  onRequestSteer: () => void;
};

export function LiveRuntimeStage({ thread, onRequestSteer }: LiveRuntimeStageProps) {
  const liveRuntime = thread.liveRuntime;
  const focusedRun = liveRuntime?.focusedRun;
  const operatorView = liveRuntime?.operatorView;
  const hasActivity = (thread.activity?.length ?? 0) > 0;

  if (!liveRuntime || !focusedRun) {
    return null;
  }

  const queuedFollowUps = liveRuntime.queuedFollowUps;
  const canSteer = thread.status === "running" || thread.status === "pending";
  const runtimeMetaLabel =
    focusedRun.status === "running"
      ? "Reasoning live"
      : focusedRun.status === "pending"
        ? "Accepted by runtime"
        : focusedRun.status === "failed"
          ? "Failed in runtime"
          : "Completed in runtime";
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
          <span>{runtimeMetaLabel}</span>
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

      {operatorView && !hasActivity ? <OperatorRunOverview operatorView={operatorView} /> : null}

      <AgentActivityFeed activity={thread.activity ?? []} status={thread.status} />

      {canSteer || queuedFollowUps.length > 0 ? (
        <section className="live-runtime-stage__follow-up-strip">
          <div className="live-runtime-stage__follow-up-copy">
            <strong>Steer drawer</strong>
            <p>
              {queuedFollowUps.length > 0
                ? `${queuedFollowUps.length} follow-up${queuedFollowUps.length === 1 ? "" : "s"} are staged in the docked steer drawer below.`
                : "Open the steer drawer from the prompt bar below to queue the next follow-up without interrupting the current run."}
            </p>
          </div>

          {canSteer ? (
            <button
              type="button"
              className="live-runtime-stage__steer-button"
              onClick={onRequestSteer}
            >
              Open steer
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
