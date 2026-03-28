import type {
  RuntimeOperatorApprovalDecision,
  RuntimeThreadFocusedRun,
  WorkspaceThread
} from "../types";
import { AttachmentPreviewList } from "./AttachmentPreviewList";
import { AgentActivityFeed } from "./AgentActivityFeed";
import { OperatorRunOverview } from "./OperatorRunOverview";

type LiveRuntimeStageProps = {
  thread: WorkspaceThread;
  onRequestSteer: () => void;
  onApprovalDecision: (
    runId: string,
    gateId: string,
    decision: RuntimeOperatorApprovalDecision,
    comment: string
  ) => Promise<void>;
};

export function LiveRuntimeStage({
  thread,
  onRequestSteer,
  onApprovalDecision
}: LiveRuntimeStageProps) {
  const liveRuntime = thread.liveRuntime;
  const focusedRun = liveRuntime?.focusedRun;
  const operatorView = liveRuntime?.operatorView;
  const hasActivity = (thread.activity?.length ?? 0) > 0;
  const shouldShowOperatorOverview =
    Boolean(operatorView) &&
    (Boolean(operatorView?.factory) || !hasActivity || Boolean(operatorView?.approval?.activeGate));

  if (!liveRuntime || !focusedRun) {
    return null;
  }

  const queuedFollowUps = liveRuntime.queuedFollowUps;
  const canSteer = thread.status === "running" || thread.status === "pending";
  const factory = focusedRun.factory;
  const isActiveRunVisible =
    thread.status === "running" || thread.status === "pending" || thread.status === "paused";
  const runtimeMetaLabel =
    focusedRun.status === "running"
      ? "Reasoning live"
      : focusedRun.status === "pending"
        ? "Accepted by runtime"
        : focusedRun.status === "paused"
          ? "Waiting for approval"
        : focusedRun.status === "failed"
          ? "Failed in runtime"
          : "Completed in runtime";
  const activeHeading =
    thread.status === "running"
      ? "Working on the current request"
      : thread.status === "pending"
        ? "Request queued in runtime"
        : "Waiting for approval";
  const activeDetail =
    thread.status === "running"
      ? queuedFollowUps.length > 0
        ? `${queuedFollowUps.length} steer follow-up${queuedFollowUps.length === 1 ? "" : "s"} will run next without interrupting the active reasoning.`
        : "You can queue a steer follow-up now and it will run after the current reasoning finishes."
      : thread.status === "pending"
        ? queuedFollowUps.length > 0
          ? `${queuedFollowUps.length} follow-up${queuedFollowUps.length === 1 ? "" : "s"} are already lined up on this thread.`
          : "The worker has accepted this request and will start the reasoning path shortly."
        : thread.status === "paused"
          ? operatorView?.approval?.activeGate
            ? `${operatorView.approval.activeGate.title} is waiting for a human decision before the run can continue.`
            : "The run is paused until the next approval decision is recorded."
        : "The run is paused until the next approval decision is recorded.";

  return (
    <section className="live-runtime-stage">
      {isActiveRunVisible ? (
        <article className="live-runtime-stage__active">
          <div className="live-runtime-stage__eyebrow">
            <span className="live-runtime-stage__badge">{runtimeMetaLabel}</span>
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

          {focusedRun.attachments.length > 0 ? (
            <div className="live-runtime-stage__attachments">
              <AttachmentPreviewList attachments={focusedRun.attachments} variant="inline" />
            </div>
          ) : null}

          {factory ? (
            <div className="live-runtime-stage__factory-card">
              <div className="live-runtime-stage__factory-head">
                <strong>Factory Mode</strong>
                <span>{humanizeFactoryStage(factory.currentStage)}</span>
              </div>
              <p>
                {factory.appName} · {factory.stackLabel}
              </p>
              <div className="live-runtime-stage__meta">
                <span>{factory.repositoryName}</span>
                <span>{factory.deploymentProvider}</span>
                {factory.workspacePath ? <span>{factory.workspacePath}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="live-runtime-stage__meta">
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
      ) : null}

      {shouldShowOperatorOverview && operatorView ? (
        <OperatorRunOverview
          runId={focusedRun.id}
          operatorView={operatorView}
          onApprovalDecision={onApprovalDecision}
        />
      ) : null}

      <AgentActivityFeed activity={thread.activity ?? []} status={thread.status} />

    </section>
  );
}

function humanizeFactoryStage(stage: NonNullable<RuntimeThreadFocusedRun["factory"]>["currentStage"]) {
  switch (stage) {
    case "bootstrap":
      return "Bootstrap";
    case "implementation":
      return "Implementation";
    case "delivery":
      return "Delivery";
    default:
      return "Intake";
  }
}
