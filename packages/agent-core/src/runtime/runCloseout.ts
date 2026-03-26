import type {
  AgentRunRecord,
  ControlPlaneArtifact,
  ControlPlaneDeliverySummaryArtifactPayload,
  ControlPlaneFailureReportArtifactPayload,
  ExternalRecordLink,
  OperatorRunDeliveryLink,
  OperatorRunDeliverySummary,
  OperatorRunEvaluation,
  OperatorRunEvaluationBottleneck
} from "./types";

export function deriveRunCloseout(run: AgentRunRecord): {
  delivery: OperatorRunDeliverySummary | null;
  evaluation: OperatorRunEvaluation | null;
} {
  return {
    delivery: deriveDeliverySummary(run),
    evaluation: deriveEvaluation(run)
  };
}

function deriveDeliverySummary(run: AgentRunRecord): OperatorRunDeliverySummary | null {
  if (run.status !== "completed" && run.status !== "failed") {
    return null;
  }

  const deliveryArtifacts = getArtifactsByPayloadKind<ControlPlaneDeliverySummaryArtifactPayload>(
    run,
    "delivery_summary"
  );
  const failureArtifacts = getArtifactsByPayloadKind<ControlPlaneFailureReportArtifactPayload>(
    run,
    "failure_report"
  );
  const latestDeliveryArtifact = deliveryArtifacts[0] ?? null;
  const latestFailureArtifact = failureArtifacts[0] ?? null;
  const headline =
    run.status === "failed"
      ? latestFailureArtifact?.payload.headline ??
        run.error?.message?.trim() ??
        run.rollingSummary?.text?.trim() ??
        "Run failed before delivery completed."
      : latestDeliveryArtifact?.payload.headline ??
        run.result?.summary?.trim() ??
        run.factory?.deliverySummary?.trim() ??
        run.rollingSummary?.text?.trim() ??
        "Run completed and is ready for review.";
  const outputs = uniqueStrings(
    [
      ...(run.status === "completed"
        ? deliveryArtifacts.flatMap((artifact) => artifact.payload.outputs)
        : []),
      run.result?.summary ?? null,
      run.factory?.deliverySummary ?? null,
      latestDeliveryArtifact?.summary ?? null
    ].filter(isNonEmptyString)
  );
  const risks = uniqueStrings(
    [
      ...(run.status === "completed"
        ? deliveryArtifacts.flatMap((artifact) => artifact.payload.risks)
        : failureArtifacts.flatMap((artifact) => artifact.payload.risks)),
      ...getOpenBlockerSummaries(run),
      ...getOpenConflictSummaries(run),
      run.status === "failed" ? run.error?.message ?? null : null
    ].filter(isNonEmptyString)
  ).slice(0, 6);
  const followUps = uniqueStrings(
    [
      ...(run.status === "completed"
        ? deliveryArtifacts.flatMap((artifact) => artifact.payload.followUps)
        : failureArtifacts.flatMap((artifact) => artifact.payload.followUps)),
      ...deriveFollowUpsFromRun(run)
    ].filter(isNonEmptyString)
  ).slice(0, 6);
  const links = collectDeliveryLinks(run, deliveryArtifacts);
  const sourceArtifactIds = [
    ...deliveryArtifacts.map((artifact) => artifact.id),
    ...failureArtifacts.map((artifact) => artifact.id)
  ];
  const updatedAt =
    latestDeliveryArtifact?.createdAt ??
    latestFailureArtifact?.createdAt ??
    run.completedAt ??
    run.rollingSummary?.updatedAt ??
    null;

  return {
    status: run.status === "failed" ? "failed" : "completed",
    headline,
    outputs: outputs.length > 0 ? outputs.slice(0, 6) : [headline],
    links,
    risks,
    followUps,
    sourceArtifactIds,
    updatedAt
  };
}

function deriveEvaluation(run: AgentRunRecord): OperatorRunEvaluation | null {
  const controlPlane = run.controlPlane;
  const blockerCount = controlPlane?.blockers.length ?? 0;
  const openBlockerCount = controlPlane?.blockers.filter((blocker) => blocker.status === "open").length ?? 0;
  const conflictCount = controlPlane?.conflicts.length ?? 0;
  const openConflictCount = controlPlane?.conflicts.filter((conflict) => conflict.status === "open").length ?? 0;
  const mergeDecisionCount = controlPlane?.mergeDecisions.length ?? 0;
  const interventionCount = controlPlane?.interventions.length ?? 0;
  const approvalGateCount = controlPlane?.approvalGates.length ?? 0;
  const approvalDecisionCount =
    controlPlane?.approvalGates.reduce((total, gate) => total + gate.decisions.length, 0) ?? 0;
  const failureReportCount =
    controlPlane?.artifacts.filter((artifact) => artifact.kind === "failure_report").length ?? 0;
  const retryCount = countRetries(run);
  const scorecard = {
    blockerCount,
    openBlockerCount,
    retryCount,
    approvalGateCount,
    approvalDecisionCount,
    interventionCount,
    conflictCount,
    openConflictCount,
    mergeDecisionCount,
    failureReportCount
  };
  const failurePatterns = uniqueStrings(
    [
      ...getArtifactsByPayloadKind<ControlPlaneFailureReportArtifactPayload>(run, "failure_report").map(
        (artifact) => artifact.payload.headline
      ),
      ...(run.controlPlane?.conflicts.map((conflict) => `${humanizeKey(conflict.kind)}: ${conflict.summary}`) ??
        []),
      ...run.events
        .filter((event) => isFailureEvent(event.type))
        .map((event) => event.message)
    ].filter(isNonEmptyString)
  ).slice(0, 6);
  const bottlenecks = buildBottlenecks(run, scorecard).slice(0, 5);

  if (
    run.status !== "completed" &&
    run.status !== "failed" &&
    blockerCount === 0 &&
    conflictCount === 0 &&
    retryCount === 0 &&
    interventionCount === 0 &&
    approvalDecisionCount === 0 &&
    failurePatterns.length === 0
  ) {
    return null;
  }

  return {
    scorecard,
    bottlenecks,
    failurePatterns
  };
}

function buildBottlenecks(
  run: AgentRunRecord,
  scorecard: OperatorRunEvaluation["scorecard"]
): OperatorRunEvaluationBottleneck[] {
  const bottlenecks: OperatorRunEvaluationBottleneck[] = [];

  if (scorecard.openBlockerCount > 0) {
    bottlenecks.push({
      id: "open-blockers",
      label: "Open blockers",
      detail: `${scorecard.openBlockerCount} blocker${
        scorecard.openBlockerCount === 1 ? "" : "s"
      } still need operator follow-through.`,
      severity: "danger",
      metric: scorecard.openBlockerCount
    });
  }

  if (scorecard.openConflictCount > 0) {
    bottlenecks.push({
      id: "open-conflicts",
      label: "Conflict review",
      detail: `${scorecard.openConflictCount} merge conflict${
        scorecard.openConflictCount === 1 ? "" : "s"
      } required governance review.`,
      severity: "warning",
      metric: scorecard.openConflictCount
    });
  }

  if (scorecard.retryCount > 0) {
    bottlenecks.push({
      id: "retry-pressure",
      label: "Retry pressure",
      detail: `${scorecard.retryCount} retr${
        scorecard.retryCount === 1 ? "y was" : "ies were"
      } needed before closeout.`,
      severity: scorecard.retryCount > 2 ? "danger" : "warning",
      metric: scorecard.retryCount
    });
  }

  if (scorecard.approvalDecisionCount > 0 || scorecard.approvalGateCount > 0) {
    bottlenecks.push({
      id: "approval-gates",
      label: "Approval overhead",
      detail: `${scorecard.approvalGateCount} gate${
        scorecard.approvalGateCount === 1 ? "" : "s"
      } generated ${scorecard.approvalDecisionCount} decision${
        scorecard.approvalDecisionCount === 1 ? "" : "s"
      }.`,
      severity: scorecard.approvalDecisionCount > 1 ? "warning" : "info",
      metric: scorecard.approvalDecisionCount
    });
  }

  const manualReviewCount =
    run.controlPlane?.interventions.filter((intervention) => intervention.kind === "manual_review")
      .length ?? 0;

  if (manualReviewCount > 0) {
    bottlenecks.push({
      id: "manual-review",
      label: "Manual review",
      detail: `${manualReviewCount} manual review intervention${
        manualReviewCount === 1 ? "" : "s"
      } were needed to close the run.`,
      severity: "warning",
      metric: manualReviewCount
    });
  }

  if (bottlenecks.length === 0 && run.status === "completed") {
    bottlenecks.push({
      id: "clean-closeout",
      label: "Clean closeout",
      detail: "The run completed without blocker, conflict, or retry pressure.",
      severity: "info",
      metric: 0
    });
  }

  return bottlenecks;
}

function getArtifactsByPayloadKind<TPayload extends { kind: string }>(
  run: AgentRunRecord,
  kind: TPayload["kind"]
) {
  return [...(run.controlPlane?.artifacts ?? [])]
    .filter(
      (artifact): artifact is ControlPlaneArtifact & { payload: TPayload } =>
        artifact.payload?.kind === kind
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function collectDeliveryLinks(
  run: AgentRunRecord,
  deliveryArtifacts: Array<ControlPlaneArtifact & { payload: ControlPlaneDeliverySummaryArtifactPayload }>
): OperatorRunDeliveryLink[] {
  const links: OperatorRunDeliveryLink[] = [];

  for (const artifact of deliveryArtifacts) {
    for (const link of artifact.payload.links) {
      links.push({
        kind: link.kind,
        label: link.label,
        url: link.url,
        provider: link.provider
      });
    }
  }

  for (const link of run.project?.links ?? []) {
    if (!link?.url?.trim()) {
      continue;
    }

    links.push({
      kind: link.kind,
      label: link.title?.trim() || humanizeKey(link.kind),
      url: link.url.trim(),
      provider: link.provider?.trim() || null
    });
  }

  for (const record of run.externalSync?.records ?? []) {
    for (const link of record.links) {
      links.push(convertExternalLink(link));
    }
  }

  if (run.factory?.repository.url) {
    links.push({
      kind: "repository",
      label: "Factory repository",
      url: run.factory.repository.url,
      provider: run.factory.repository.provider
    });
  }

  if (run.factory?.deployment.url) {
    links.push({
      kind: "deployment",
      label: "Factory deployment",
      url: run.factory.deployment.url,
      provider: run.factory.deployment.provider
    });
  }

  return dedupeLinks(links).slice(0, 6);
}

function convertExternalLink(link: ExternalRecordLink): OperatorRunDeliveryLink {
  return {
    kind: link.kind,
    label: link.title?.trim() || humanizeKey(link.kind),
    url: link.url,
    provider: link.provider
  };
}

function dedupeLinks(links: OperatorRunDeliveryLink[]) {
  const seen = new Set<string>();

  return links.filter((link) => {
    const key = `${link.kind}:${link.url}`;

    if (!link.url.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function deriveFollowUpsFromRun(run: AgentRunRecord) {
  const followUps = [
    ...(run.controlPlane?.blockers
      .filter((blocker) => blocker.status === "open")
      .map((blocker) => `Resolve blocker on ${blocker.entityKind} ${blocker.entityId}.`) ?? []),
    ...(run.controlPlane?.conflicts
      .filter((conflict) => conflict.status === "open")
      .map((conflict) => `Resolve ${humanizeKey(conflict.kind)} for ${conflict.entityKind} ${conflict.entityId}.`) ??
      []),
    ...(run.controlPlane?.interventions
      .filter((intervention) => intervention.resolvedAt === null)
      .map((intervention) => intervention.summary) ?? [])
  ];

  if (run.status === "failed" && run.error?.message?.trim()) {
    followUps.push("Address the failed run cause before retrying this workflow.");
  }

  return uniqueStrings(followUps);
}

function getOpenBlockerSummaries(run: AgentRunRecord) {
  return (run.controlPlane?.blockers ?? [])
    .filter((blocker) => blocker.status === "open")
    .map((blocker) => blocker.summary);
}

function getOpenConflictSummaries(run: AgentRunRecord) {
  return (run.controlPlane?.conflicts ?? [])
    .filter((conflict) => conflict.status === "open")
    .map((conflict) => conflict.summary);
}

function countRetries(run: AgentRunRecord) {
  return (
    run.retryCount +
    (run.phaseExecution?.phases.reduce(
      (storyTotal, phase) =>
        storyTotal +
        phase.userStories.reduce(
          (taskTotal, story) =>
            taskTotal +
            story.retryCount +
            story.tasks.reduce((sum, task) => sum + task.retryCount, 0),
          0
        ),
      0
    ) ?? 0)
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isFailureEvent(type: string) {
  return (
    type.includes("failed") ||
    type.includes("rejected") ||
    type.includes("rollback_failed") ||
    type === "coordination_conflict_detected"
  );
}

function humanizeKey(value: string) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
