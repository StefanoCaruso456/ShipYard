import type {
  RuntimeFactoryDeliveryArtifact,
  RuntimeFactoryDeliveryCheckStatus,
  RuntimeFactoryRunView,
  RuntimeFactoryRunViewStage
} from "../types";

type FactoryRunViewProps = {
  factoryView: RuntimeFactoryRunView;
};

export function FactoryRunView({ factoryView }: FactoryRunViewProps) {
  const artifact = factoryView.deliveryArtifact;
  const failureReport = factoryView.failureReport;

  return (
    <section className="factory-run-view">
      <div className="operator-overview__section-head">
        <strong>Factory delivery</strong>
        <span>{humanizeFactoryStatus(factoryView.status)}</span>
      </div>

      <div className="factory-run-view__hero">
        <div className="factory-run-view__hero-copy">
          <span className="operator-overview__badge">One prompt in, app out</span>
          <strong>{factoryView.headline}</strong>
          <p>
            {factoryView.appName} · {factoryView.stackLabel} · {humanizeStage(factoryView.currentStage)}
          </p>
        </div>
        <div className="operator-overview__meta">
          <span>{factoryView.scorecard.completedStages}/{factoryView.scorecard.totalStages} stages</span>
          <span>{factoryView.scorecard.completedWorkPackets}/{factoryView.scorecard.totalWorkPackets} packets</span>
          <span>{factoryView.scorecard.completedBacklogItems}/{factoryView.scorecard.totalBacklogItems} backlog</span>
        </div>
      </div>

      {artifact ? (
        <>
          <div className="operator-overview__grid">
            <article className="operator-overview__card factory-run-view__status-card">
              <span className="operator-overview__eyebrow">Repository</span>
              <strong>{humanizeRepositoryStatus(artifact.repository.status)}</strong>
              <p>{artifact.repository.summary}</p>
              <div className="operator-overview__meta">
                <span>{artifact.repository.label}</span>
                <span>{artifact.repository.branch}</span>
                {artifact.repository.path ? <span>{artifact.repository.path}</span> : null}
              </div>
            </article>

            <article className="operator-overview__card factory-run-view__status-card">
              <span className="operator-overview__eyebrow">Build</span>
              <strong>{humanizeCheckStatus(artifact.build.status)}</strong>
              <p>{artifact.build.summary}</p>
            </article>

            <article className="operator-overview__card factory-run-view__status-card">
              <span className="operator-overview__eyebrow">Test</span>
              <strong>{humanizeCheckStatus(artifact.test.status)}</strong>
              <p>{artifact.test.summary}</p>
            </article>

            <article className="operator-overview__card factory-run-view__status-card">
              <span className="operator-overview__eyebrow">Deploy</span>
              <strong>{humanizeDeploymentStatus(artifact.deployment.status)}</strong>
              <p>{artifact.deployment.summary}</p>
              <div className="operator-overview__meta">
                <span>{artifact.deployment.provider}</span>
                {artifact.deployment.environment ? <span>{artifact.deployment.environment}</span> : null}
              </div>
            </article>
          </div>

          <div className="operator-overview__detail-list">
            <article className="operator-overview__detail-card">
              <span className="operator-overview__eyebrow">Shipped</span>
              <div className="operator-overview__meta">
                {artifact.shipped.map((item) => (
                  <span key={`shipped:${item}`}>{item}</span>
                ))}
              </div>
            </article>

            {artifact.passedChecks.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--info">
                <span className="operator-overview__eyebrow">Passed checks</span>
                <div className="operator-overview__meta">
                  {artifact.passedChecks.map((item) => (
                    <span key={`passed:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {artifact.failedChecks.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--danger">
                <span className="operator-overview__eyebrow">Failed checks</span>
                <div className="operator-overview__meta">
                  {artifact.failedChecks.map((item) => (
                    <span key={`failed:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {artifact.pendingActions.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--warning">
                <span className="operator-overview__eyebrow">Needs action</span>
                <div className="operator-overview__meta">
                  {artifact.pendingActions.map((item) => (
                    <span key={`action:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="operator-overview__section-head">
        <strong>Factory scorecard</strong>
        <span>{factoryView.scorecard.verifiedStages} verified stages</span>
      </div>

      <div className="operator-overview__grid">
        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Status</span>
          <strong>{humanizeFactoryStatus(factoryView.scorecard.overallStatus)}</strong>
          <p>
            {factoryView.scorecard.openIntegrationBlockerCount} integration blockers ·{" "}
            {factoryView.scorecard.openConflictCount} open conflicts
          </p>
        </article>

        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Governance</span>
          <strong>{factoryView.scorecard.mergeDecisionCount} merge decisions</strong>
          <p>{factoryView.scorecard.reassignmentCount} reassignments · {factoryView.scorecard.retryCount} retries</p>
        </article>

        <article className="operator-overview__card">
          <span className="operator-overview__eyebrow">Evidence</span>
          <strong>{humanizeRepositoryStatus(factoryView.scorecard.repositoryStatus)}</strong>
          <p>
            Build {humanizeCheckStatus(factoryView.scorecard.buildStatus).toLowerCase()} · Test{" "}
            {humanizeCheckStatus(factoryView.scorecard.testStatus).toLowerCase()} · Deploy{" "}
            {humanizeDeploymentStatus(factoryView.scorecard.deploymentStatus).toLowerCase()}
          </p>
        </article>
      </div>

      <div className="operator-overview__detail-list">
        {factoryView.stages.map((stage) => (
          <article
            key={stage.stageId}
            className={`operator-overview__detail-card factory-run-view__stage factory-run-view__stage--${stage.status}`}
          >
            <div className="operator-overview__journal-head">
              <strong>{stage.label}</strong>
              <span>{humanizeStageStatus(stage.status)}</span>
            </div>
            <p>{stage.summary}</p>
            <div className="operator-overview__meta">
              <span>{stage.completedBacklogItems}/{stage.totalBacklogItems} backlog</span>
              <span>{stage.verified ? "Verified" : "Awaiting verification"}</span>
            </div>
          </article>
        ))}
      </div>

      {failureReport ? (
        <section className="factory-run-view__failure">
          <div className="operator-overview__section-head">
            <strong>Factory failure report</strong>
            <span>{failureReport.status === "failed" ? "Failed" : "Blocked"}</span>
          </div>

          <div className="operator-overview__detail-list">
            <article className="operator-overview__detail-card operator-overview__detail-card--danger">
              <div className="operator-overview__journal-head">
                <strong>{failureReport.headline}</strong>
                <span>
                  {failureReport.updatedAt ? formatDateTime(failureReport.updatedAt) : "Pending"}
                </span>
              </div>
              <p>{failureReport.summary}</p>
            </article>

            {failureReport.failedChecks.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--danger">
                <span className="operator-overview__eyebrow">Failed checks</span>
                <div className="operator-overview__meta">
                  {failureReport.failedChecks.map((item) => (
                    <span key={`failure-check:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {failureReport.blockers.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--warning">
                <span className="operator-overview__eyebrow">Blockers</span>
                <div className="operator-overview__meta">
                  {failureReport.blockers.map((item) => (
                    <span key={`failure-blocker:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {failureReport.conflicts.length > 0 ? (
              <article className="operator-overview__detail-card operator-overview__detail-card--warning">
                <span className="operator-overview__eyebrow">Conflicts</span>
                <div className="operator-overview__meta">
                  {failureReport.conflicts.map((item) => (
                    <span key={`failure-conflict:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {failureReport.recommendedActions.length > 0 ? (
              <article className="operator-overview__detail-card">
                <span className="operator-overview__eyebrow">Recommended actions</span>
                <div className="operator-overview__meta">
                  {failureReport.recommendedActions.map((item) => (
                    <span key={`failure-action:${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function humanizeFactoryStatus(status: RuntimeFactoryRunView["status"] | RuntimeFactoryRunView["scorecard"]["overallStatus"]) {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "In progress";
  }
}

function humanizeStage(stageId: RuntimeFactoryRunView["currentStage"]) {
  switch (stageId) {
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

function humanizeRepositoryStatus(status: RuntimeFactoryDeliveryArtifact["repository"]["status"]) {
  switch (status) {
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

function humanizeDeploymentStatus(status: RuntimeFactoryDeliveryArtifact["deployment"]["status"]) {
  switch (status) {
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "manual":
      return "Manual";
    default:
      return "Pending";
  }
}

function humanizeCheckStatus(status: RuntimeFactoryDeliveryCheckStatus) {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "manual":
      return "Manual";
    default:
      return "Pending";
  }
}

function humanizeStageStatus(status: RuntimeFactoryRunViewStage["status"]) {
  switch (status) {
    case "active":
      return "Active";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}
