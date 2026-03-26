import type {
  RuntimeOperatorJournalEntry,
  RuntimeOperatorStageStatus,
  RuntimeOperatorView
} from "../types";

type OperatorRunOverviewProps = {
  operatorView: RuntimeOperatorView;
};

export function OperatorRunOverview({ operatorView }: OperatorRunOverviewProps) {
  const visibleJournal = operatorView.journal.slice(0, 8);

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
