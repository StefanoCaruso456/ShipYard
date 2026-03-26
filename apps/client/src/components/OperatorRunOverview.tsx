import { useState } from "react";

import type {
  RuntimeOperatorApprovalDecision,
  RuntimeOperatorApprovalGate,
  RuntimeOperatorStageStatus,
  RuntimeOperatorView
} from "../types";

type OperatorRunOverviewProps = {
  runId: string;
  operatorView: RuntimeOperatorView;
  onApprovalDecision: (
    runId: string,
    gateId: string,
    decision: RuntimeOperatorApprovalDecision,
    comment: string
  ) => Promise<void>;
};

export function OperatorRunOverview({
  runId,
  operatorView,
  onApprovalDecision
}: OperatorRunOverviewProps) {
  const visibleJournal = operatorView.journal.slice(0, 8);
  const activeGate = operatorView.approval?.activeGate ?? null;
  const [comment, setComment] = useState("");
  const [submittingDecision, setSubmittingDecision] =
    useState<RuntimeOperatorApprovalDecision | null>(null);
  const canResolveGate =
    activeGate !== null &&
    (activeGate.status === "waiting" || activeGate.status === "rejected");

  async function handleApprovalDecision(decision: RuntimeOperatorApprovalDecision) {
    if (!activeGate) {
      return;
    }

    setSubmittingDecision(decision);

    try {
      await onApprovalDecision(runId, activeGate.id, decision, comment);

      if (decision !== "reject") {
        setComment("");
      }
    } finally {
      setSubmittingDecision(null);
    }
  }

  return (
    <section className="operator-overview">
      <div className="operator-overview__header">
        <div>
          <span className="operator-overview__badge">Operator view</span>
          <strong>{operatorView.stage.label}</strong>
          <p>{operatorView.summary}</p>
        </div>
      </div>

      <div className="operator-overview__stages" aria-label="Operator stage flow">
        {operatorView.stages.map((stage) => (
          <div
            key={stage.id}
            className={`operator-overview__stage operator-overview__stage--${stage.status}`}
          >
            <span>{stage.label}</span>
            <small>{stage.detail}</small>
          </div>
        ))}
      </div>

      <div className="operator-overview__grid">
        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Owner</span>
          <strong>{operatorView.owner.label}</strong>
          <p>{operatorView.current.label ?? "Waiting for the next unit of work."}</p>
        </article>

        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Next action</span>
          <strong>{operatorView.nextAction ?? "No further action is needed."}</strong>
          <p>{renderRetrySummary(operatorView)}</p>
        </article>

        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Progress</span>
          <strong>{renderProgress(operatorView)}</strong>
          <p>{renderCurrentStatus(operatorView)}</p>
        </article>
      </div>

      {activeGate ? (
        <section className="operator-overview__approval">
          <div className="operator-overview__section-head">
            <strong>{activeGate.title}</strong>
            <span>{humanizeApprovalStatus(activeGate.status)}</span>
          </div>

          <div className="operator-overview__approval-card">
            <span className="operator-overview__eyebrow">
              {activeGate.phaseName} · {humanizeApprovalKind(activeGate.kind)}
            </span>
            <p>
              {activeGate.instructions?.trim() ||
                `${activeGate.ownerLabel} is waiting on a decision before this phase can continue.`}
            </p>
            {activeGate.decisions.length > 0 ? (
              <div className="operator-overview__meta">
                {activeGate.decisions
                  .slice(-2)
                  .reverse()
                  .map((decision) => (
                    <span key={decision.id}>
                      {humanizeApprovalDecision(decision.decision)} · {formatDateTime(decision.decidedAt)}
                    </span>
                  ))}
              </div>
            ) : null}

            {canResolveGate ? (
              <div className="operator-overview__approval-actions">
                <textarea
                  className="operator-overview__approval-comment"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add optional approval notes for the runtime."
                />
                <div className="operator-overview__approval-buttons">
                  <button
                    type="button"
                    className="operator-overview__approval-button operator-overview__approval-button--approve"
                    disabled={submittingDecision !== null}
                    onClick={() => void handleApprovalDecision("approve")}
                  >
                    {submittingDecision === "approve" ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="operator-overview__approval-button operator-overview__approval-button--retry"
                    disabled={submittingDecision !== null}
                    onClick={() => void handleApprovalDecision("request_retry")}
                  >
                    {submittingDecision === "request_retry" ? "Requesting..." : "Request retry"}
                  </button>
                  <button
                    type="button"
                    className="operator-overview__approval-button operator-overview__approval-button--reject"
                    disabled={submittingDecision !== null}
                    onClick={() => void handleApprovalDecision("reject")}
                  >
                    {submittingDecision === "reject" ? "Rejecting..." : "Reject"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {operatorView.blockers.length > 0 ? (
        <section className="operator-overview__blockers">
          <div className="operator-overview__section-head">
            <strong>Open blockers</strong>
            <span>{operatorView.blockers.length}</span>
          </div>

          <div className="operator-overview__blocker-list">
            {operatorView.blockers.map((blocker) => (
              <article key={blocker.id} className="operator-overview__blocker">
                <strong>{blocker.summary}</strong>
                <p>
                  {blocker.entityKind} {blocker.entityId} · {blocker.ownerLabel}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="operator-overview__journal">
        <div className="operator-overview__section-head">
          <strong>Run journal</strong>
          <span>{operatorView.journal.length}</span>
        </div>

        <div className="operator-overview__journal-list">
          {visibleJournal.map((entry) => (
            <article
              key={entry.id}
              className={`operator-overview__journal-item operator-overview__journal-item--${entry.tone}`}
            >
              <div className="operator-overview__journal-head">
                <strong>{entry.label}</strong>
                <span>{formatDateTime(entry.at)}</span>
              </div>
              <p>{entry.detail}</p>
              {entry.meta.length > 0 ? (
                <div className="operator-overview__meta">
                  {entry.meta.slice(0, 3).map((item) => (
                    <span key={`${entry.id}-${item}`}>{item}</span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function renderRetrySummary(operatorView: RuntimeOperatorView) {
  if (operatorView.retries.totalRetries === 0) {
    return "No retries so far.";
  }

  return `${operatorView.retries.totalRetries} total retr${
    operatorView.retries.totalRetries === 1 ? "y" : "ies"
  } so far.`;
}

function renderProgress(operatorView: RuntimeOperatorView) {
  const progress = operatorView.progress;

  if (!progress) {
    return humanizeStageStatus(operatorView.stage.status);
  }

  return `${progress.completedTasks}/${progress.totalTasks} tasks · ${progress.completedStories}/${progress.totalStories} stories`;
}

function renderCurrentStatus(operatorView: RuntimeOperatorView) {
  if (!operatorView.current.label) {
    return operatorView.stage.detail;
  }

  return `${operatorView.current.entityKind ?? "run"} · ${operatorView.current.label}`;
}

function humanizeStageStatus(status: RuntimeOperatorStageStatus) {
  switch (status) {
    case "active":
      return "In progress";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function humanizeApprovalStatus(status: RuntimeOperatorApprovalGate["status"]) {
  switch (status) {
    case "waiting":
      return "Waiting for approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

function humanizeApprovalKind(kind: RuntimeOperatorApprovalGate["kind"]) {
  switch (kind) {
    case "architecture":
      return "Architecture gate";
    case "implementation":
      return "Implementation gate";
    default:
      return "Deployment gate";
  }
}

function humanizeApprovalDecision(decision: RuntimeOperatorApprovalDecision) {
  switch (decision) {
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    default:
      return "Retry requested";
  }
}
