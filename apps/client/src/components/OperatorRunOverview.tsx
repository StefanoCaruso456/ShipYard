import { useState } from "react";

import type {
  RuntimeOperatorApprovalDecision,
  RuntimeOperatorApprovalGate,
  RuntimeOperatorEvaluationBottleneck,
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

type OperatorRunComparativeAnalysis = {
  status: "completed" | "failed";
  headline: string;
  sections: Array<{
    id: string;
    title: string;
    summary: string;
    highlights: string[];
  }>;
  sourceArtifactIds: string[];
  updatedAt: string | null;
};

type OperatorRunViewWithComparativeAnalysis = RuntimeOperatorView & {
  comparativeAnalysis?: OperatorRunComparativeAnalysis | null;
};

export function OperatorRunOverview({
  runId,
  operatorView,
  onApprovalDecision
}: OperatorRunOverviewProps) {
  const comparativeAnalysis =
    (operatorView as OperatorRunViewWithComparativeAnalysis).comparativeAnalysis ?? null;
  const visibleJournal = operatorView.journal.slice(0, 8);
  const visiblePlanningArtifacts = operatorView.planningArtifacts.slice(0, 6);
  const visibleDelegationPackets = operatorView.delegationPackets.slice(0, 6);
  const visibleConflicts = operatorView.conflicts.slice(0, 6);
  const visibleMergeDecisions = operatorView.mergeDecisions.slice(0, 6);
  const visibleComparativeSections = comparativeAnalysis?.sections.slice(0, 7) ?? [];
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

      {operatorView.delivery ? (
        <section className="operator-overview__delivery">
          <div className="operator-overview__section-head">
            <strong>Delivery summary</strong>
            <span>{humanizeDeliveryStatus(operatorView.delivery.status)}</span>
          </div>

          <div className="operator-overview__detail-list">
            <article className="operator-overview__detail-card">
              <div className="operator-overview__journal-head">
                <strong>{operatorView.delivery.headline}</strong>
                <span>
                  {operatorView.delivery.updatedAt
                    ? formatDateTime(operatorView.delivery.updatedAt)
                    : "Pending"}
                </span>
              </div>
              <div className="operator-overview__meta">
                <span>{operatorView.delivery.outputs.length} outputs</span>
                <span>{operatorView.delivery.links.length} links</span>
                <span>{operatorView.delivery.sourceArtifactIds.length} summary artifacts</span>
              </div>
            </article>

            {operatorView.delivery.outputs.length > 0 ? (
              <article className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">Outputs</span>
                <div className="operator-overview__meta">
                  {operatorView.delivery.outputs.map((output) => (
                    <span key={output}>{output}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {operatorView.delivery.links.length > 0 ? (
              <article className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">Links</span>
                <div className="operator-overview__link-list">
                  {operatorView.delivery.links.map((link) => (
                    <a
                      key={`${link.kind}:${link.url}`}
                      className="operator-overview__link"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </article>
            ) : null}

            {operatorView.delivery.risks.length > 0 ? (
              <article className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">Risks</span>
                <div className="operator-overview__meta">
                  {operatorView.delivery.risks.map((risk) => (
                    <span key={risk}>{risk}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {operatorView.delivery.followUps.length > 0 ? (
              <article className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">Follow-ups</span>
                <div className="operator-overview__meta">
                  {operatorView.delivery.followUps.map((followUp) => (
                    <span key={followUp}>{followUp}</span>
                  ))}
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      {operatorView.evaluation ? (
        <section className="operator-overview__evaluation">
          <div className="operator-overview__section-head">
            <strong>Operator evaluation</strong>
            <span>{operatorView.evaluation.failurePatterns.length} failure patterns</span>
          </div>

          <div className="operator-overview__grid">
            <article className="operator-overview__card">
              <span className="operator-overview__eyebrow">Scorecard</span>
              <strong>{operatorView.evaluation.scorecard.retryCount} retries</strong>
              <p>
                {operatorView.evaluation.scorecard.openBlockerCount} open blockers ·{" "}
                {operatorView.evaluation.scorecard.openConflictCount} open conflicts
              </p>
            </article>

            <article className="operator-overview__card">
              <span className="operator-overview__eyebrow">Approvals</span>
              <strong>{operatorView.evaluation.scorecard.approvalDecisionCount} decisions</strong>
              <p>
                {operatorView.evaluation.scorecard.approvalGateCount} gates ·{" "}
                {operatorView.evaluation.scorecard.interventionCount} interventions
              </p>
            </article>

            <article className="operator-overview__card">
              <span className="operator-overview__eyebrow">Governance</span>
              <strong>{operatorView.evaluation.scorecard.mergeDecisionCount} merge decisions</strong>
              <p>
                {operatorView.evaluation.scorecard.conflictCount} conflicts ·{" "}
                {operatorView.evaluation.scorecard.failureReportCount} failure reports
              </p>
            </article>
          </div>

          {operatorView.evaluation.bottlenecks.length > 0 ? (
            <div className="operator-overview__detail-list">
              {operatorView.evaluation.bottlenecks.map((bottleneck) => (
                <article
                  key={bottleneck.id}
                  className={`operator-overview__detail-card operator-overview__detail-card--${bottleneck.severity}`}
                >
                  <div className="operator-overview__journal-head">
                    <strong>{bottleneck.label}</strong>
                    <span>{renderBottleneckMetric(bottleneck)}</span>
                  </div>
                  <p>{bottleneck.detail}</p>
                </article>
              ))}
            </div>
          ) : null}

          {operatorView.evaluation.failurePatterns.length > 0 ? (
            <article className="operator-overview__detail-card">
              <span className="operator-overview__eyebrow">Failure patterns</span>
              <div className="operator-overview__meta">
                {operatorView.evaluation.failurePatterns.map((pattern) => (
                  <span key={pattern}>{pattern}</span>
                ))}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}

      {comparativeAnalysis ? (
        <section className="operator-overview__comparison">
          <div className="operator-overview__section-head">
            <strong>Comparative analysis</strong>
            <span>{humanizeDeliveryStatus(comparativeAnalysis.status)}</span>
          </div>

          <div className="operator-overview__detail-list">
            <article className="operator-overview__detail-card">
              <div className="operator-overview__journal-head">
                <strong>{comparativeAnalysis.headline}</strong>
                <span>
                  {comparativeAnalysis.updatedAt
                    ? formatDateTime(comparativeAnalysis.updatedAt)
                    : "Pending"}
                </span>
              </div>
              <div className="operator-overview__meta">
                <span>{visibleComparativeSections.length} sections</span>
                <span>{comparativeAnalysis.sourceArtifactIds.length} evidence artifacts</span>
              </div>
            </article>

            {visibleComparativeSections.map((section) => (
              <article key={section.id} className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">{section.title}</span>
                <strong>{section.summary}</strong>
                {section.highlights.length > 0 ? (
                  <div className="operator-overview__meta">
                    {section.highlights.map((highlight) => (
                      <span key={`${section.id}:${highlight}`}>{highlight}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operatorView.planningArtifacts.length > 0 ? (
        <section className="operator-overview__planning">
          <div className="operator-overview__section-head">
            <strong>Planned artifacts</strong>
            <span>{operatorView.planningArtifacts.length}</span>
          </div>

          <div className="operator-overview__detail-list">
            {visiblePlanningArtifacts.map((artifact) => (
              <article key={artifact.id} className="operator-overview__detail-card">
                <div className="operator-overview__journal-head">
                  <strong>{humanizeArtifactKind(artifact.kind)}</strong>
                  <span>{formatDateTime(artifact.createdAt)}</span>
                </div>
                <p>{artifact.summary}</p>
                <div className="operator-overview__meta">
                  <span>{artifact.producerLabel}</span>
                  <span>
                    {artifact.entityKind} {artifact.entityId}
                  </span>
                  {artifact.path ? <span>{artifact.path}</span> : null}
                </div>
                {artifact.highlights.length > 0 ? (
                  <div className="operator-overview__meta">
                    {artifact.highlights.map((highlight) => (
                      <span key={`${artifact.id}-${highlight}`}>{highlight}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operatorView.delegationPackets.length > 0 ? (
        <section className="operator-overview__delegation">
          <div className="operator-overview__section-head">
            <strong>Delegation packets</strong>
            <span>{operatorView.delegationPackets.length}</span>
          </div>

          <div className="operator-overview__detail-list">
            {visibleDelegationPackets.map((packet) => (
              <article key={packet.id} className="operator-overview__detail-card">
                <div className="operator-overview__journal-head">
                  <strong>{packet.routeLabel}</strong>
                  <span>{humanizePacketStatus(packet.status)}</span>
                </div>
                <span className="operator-overview__eyebrow">
                  {packet.entityKind} {packet.entityId} · {packet.ownerLabel}
                </span>
                <p>{packet.workPacket?.scopeSummary || packet.purpose}</p>
                <div className="operator-overview__meta">
                  <span>{packet.artifactIds.length} artifacts</span>
                  <span>{packet.validationTargets.length} validation targets</span>
                  <span>{packet.dependencyIds.length} dependencies</span>
                  {packet.workPacket?.ownerLabel ? <span>{packet.workPacket.ownerLabel}</span> : null}
                </div>
                {packet.workPacket ? (
                  <div className="operator-overview__packet-groups">
                    {packet.workPacket.acceptanceCriteria.length > 0 ? (
                      <div className="operator-overview__packet-group">
                        <span className="operator-overview__eyebrow">Acceptance</span>
                        <p>{packet.workPacket.acceptanceCriteria.slice(0, 3).join(" | ")}</p>
                      </div>
                    ) : null}
                    {packet.workPacket.validationTargets.length > 0 ? (
                      <div className="operator-overview__packet-group">
                        <span className="operator-overview__eyebrow">Validation</span>
                        <p>{packet.workPacket.validationTargets.slice(0, 3).join(" | ")}</p>
                      </div>
                    ) : null}
                    {packet.workPacket.fileTargets.length > 0 || packet.workPacket.domainTargets.length > 0 ? (
                      <div className="operator-overview__packet-group">
                        <span className="operator-overview__eyebrow">Scope</span>
                        <p>
                          {packet.workPacket.fileTargets.slice(0, 2).join(" | ") ||
                            packet.workPacket.domainTargets.slice(0, 2).join(" | ")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operatorView.conflicts.length > 0 ? (
        <section className="operator-overview__conflicts">
          <div className="operator-overview__section-head">
            <strong>Merge conflicts</strong>
            <span>{operatorView.conflicts.length}</span>
          </div>

          <div className="operator-overview__detail-list">
            {visibleConflicts.map((conflict) => (
              <article key={conflict.id} className="operator-overview__detail-card">
                <div className="operator-overview__journal-head">
                  <strong>{humanizeArtifactKind(conflict.kind)}</strong>
                  <span>{formatDateTime(conflict.detectedAt)}</span>
                </div>
                <span className="operator-overview__eyebrow">
                  {conflict.entityKind} {conflict.entityId} · {conflict.ownerLabel}
                </span>
                <p>{conflict.summary}</p>
                <div className="operator-overview__meta">
                  <span>{humanizeConflictStatus(conflict.status)}</span>
                  {conflict.routeLabel ? <span>{conflict.routeLabel}</span> : null}
                </div>
                {conflict.conflictingPaths.length > 0 ? (
                  <div className="operator-overview__packet-group">
                    <span className="operator-overview__eyebrow">Overlapping files</span>
                    <p>{conflict.conflictingPaths.slice(0, 3).join(" | ")}</p>
                  </div>
                ) : null}
                {conflict.conflictingAgentLabels.length > 0 ? (
                  <div className="operator-overview__meta">
                    {conflict.conflictingAgentLabels.map((label) => (
                      <span key={`${conflict.id}-${label}`}>{label}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {operatorView.mergeDecisions.length > 0 ? (
        <section className="operator-overview__decisions">
          <div className="operator-overview__section-head">
            <strong>Merge decisions</strong>
            <span>{operatorView.mergeDecisions.length}</span>
          </div>

          <div className="operator-overview__detail-list">
            {visibleMergeDecisions.map((decision) => (
              <article key={decision.id} className="operator-overview__detail-card">
                <div className="operator-overview__journal-head">
                  <strong>{humanizeMergeOutcome(decision.outcome)}</strong>
                  <span>{formatDateTime(decision.decidedAt)}</span>
                </div>
                <span className="operator-overview__eyebrow">
                  {decision.entityKind} {decision.entityId} · {decision.ownerLabel}
                </span>
                <p>{decision.summary}</p>
                <div className="operator-overview__meta">
                  <span>{decision.conflictIds.length} conflict{decision.conflictIds.length === 1 ? "" : "s"}</span>
                  {decision.targetHandoffLabel ? <span>{decision.targetHandoffLabel}</span> : null}
                  {decision.reassignedToLabel ? <span>{decision.reassignedToLabel}</span> : null}
                </div>
                {decision.notes ? (
                  <div className="operator-overview__packet-group">
                    <span className="operator-overview__eyebrow">Notes</span>
                    <p>{decision.notes}</p>
                  </div>
                ) : null}
              </article>
            ))}
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

function humanizeArtifactKind(kind: string) {
  return kind
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function humanizePacketStatus(status: string) {
  switch (status) {
    case "created":
      return "Created";
    case "accepted":
      return "Accepted";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}

function humanizeDeliveryStatus(status: "completed" | "failed" | "in_progress") {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "In progress";
  }
}

function renderBottleneckMetric(bottleneck: RuntimeOperatorEvaluationBottleneck) {
  if (bottleneck.metric === 0) {
    return "Clear";
  }

  return `${bottleneck.metric}`;
}

function humanizeConflictStatus(status: "open" | "resolved") {
  return status === "resolved" ? "Resolved" : "Open";
}

function humanizeMergeOutcome(outcome: "accept" | "retry" | "reassign" | "reject") {
  switch (outcome) {
    case "accept":
      return "Accepted";
    case "retry":
      return "Retry requested";
    case "reassign":
      return "Reassign scope";
    default:
      return "Rejected";
  }
}
