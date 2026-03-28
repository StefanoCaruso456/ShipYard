import { useState } from "react";

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
    Boolean(operatorView) && (!hasActivity || Boolean(operatorView?.approval?.activeGate));
  const activeGate = operatorView?.approval?.activeGate ?? null;
  const canResolveGate =
    activeGate !== null &&
    (activeGate.status === "waiting" || activeGate.status === "rejected");
  const [approvalComment, setApprovalComment] = useState("");
  const [submittingDecision, setSubmittingDecision] =
    useState<RuntimeOperatorApprovalDecision | null>(null);

  if (!liveRuntime || !focusedRun) {
    return null;
  }

  const queuedFollowUps = liveRuntime.queuedFollowUps;
  const canSteer = thread.status === "running" || thread.status === "pending";
  const factory = focusedRun.factory;
  const focusedRunId = focusedRun.id;
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

  async function handleApprovalDecision(decision: RuntimeOperatorApprovalDecision) {
    if (!activeGate) {
      return;
    }

    setSubmittingDecision(decision);

    try {
      await onApprovalDecision(focusedRunId, activeGate.id, decision, approvalComment);

      if (decision !== "reject") {
        setApprovalComment("");
      }
    } finally {
      setSubmittingDecision(null);
    }
  }

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

          {activeGate ? (
            <div className="live-runtime-stage__approval-card">
              <div className="live-runtime-stage__approval-head">
                <strong>{activeGate.title}</strong>
                <span>{humanizeApprovalStatus(activeGate.status)}</span>
              </div>
              <p className="live-runtime-stage__approval-copy">
                {activeGate.instructions?.trim() ||
                  `${activeGate.ownerLabel} is waiting on a decision before this phase can continue.`}
              </p>
              <div className="live-runtime-stage__meta">
                <span>
                  {activeGate.phaseName} · {humanizeApprovalKind(activeGate.kind)}
                </span>
                {activeGate.waitingAt ? <span>{activeGate.waitingAt}</span> : null}
              </div>

              {canResolveGate ? (
                <div className="live-runtime-stage__approval-actions">
                  <textarea
                    className="live-runtime-stage__approval-comment"
                    rows={3}
                    value={approvalComment}
                    onChange={(event) => setApprovalComment(event.target.value)}
                    placeholder="Add optional approval notes for the runtime."
                  />
                  <div className="live-runtime-stage__approval-buttons">
                    <button
                      type="button"
                      className="live-runtime-stage__approval-button live-runtime-stage__approval-button--approve"
                      disabled={submittingDecision !== null}
                      onClick={() => void handleApprovalDecision("approve")}
                    >
                      {submittingDecision === "approve" ? "Approving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="live-runtime-stage__approval-button live-runtime-stage__approval-button--retry"
                      disabled={submittingDecision !== null}
                      onClick={() => void handleApprovalDecision("request_retry")}
                    >
                      {submittingDecision === "request_retry" ? "Requesting..." : "Request retry"}
                    </button>
                    <button
                      type="button"
                      className="live-runtime-stage__approval-button live-runtime-stage__approval-button--reject"
                      disabled={submittingDecision !== null}
                      onClick={() => void handleApprovalDecision("reject")}
                    >
                      {submittingDecision === "reject" ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                </div>
              ) : null}
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

function humanizeApprovalStatus(status: "waiting" | "approved" | "rejected" | "pending") {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
      return "Pending";
    default:
      return "Waiting";
  }
}

function humanizeApprovalKind(kind: "architecture" | "implementation" | "deployment") {
  switch (kind) {
    case "architecture":
      return "Architecture approval";
    case "implementation":
      return "Implementation approval";
    default:
      return "Deployment approval";
  }
}
