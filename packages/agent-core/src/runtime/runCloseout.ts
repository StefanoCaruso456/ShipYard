import type {
  AgentRunRecord,
  ControlPlaneArtifact,
  ControlPlaneDeliverySummaryArtifactPayload,
  ControlPlaneFailureReportArtifactPayload,
  ExternalRecordLink,
  OperatorRunComparativeAnalysis,
  OperatorRunDeliveryLink,
  OperatorRunDeliverySummary,
  OperatorRunEvaluation,
  OperatorRunEvaluationBottleneck
} from "./types";

export function deriveRunCloseout(run: AgentRunRecord): {
  delivery: OperatorRunDeliverySummary | null;
  evaluation: OperatorRunEvaluation | null;
  comparativeAnalysis: OperatorRunComparativeAnalysis | null;
} {
  const delivery = deriveDeliverySummary(run);
  const evaluation = deriveEvaluation(run);

  return {
    delivery,
    evaluation,
    comparativeAnalysis: deriveComparativeAnalysis(run, delivery, evaluation)
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

function deriveComparativeAnalysis(
  run: AgentRunRecord,
  delivery: OperatorRunDeliverySummary | null,
  evaluation: OperatorRunEvaluation | null
): OperatorRunComparativeAnalysis | null {
  if ((run.status !== "completed" && run.status !== "failed") || (!delivery && !evaluation)) {
    return null;
  }

  const failureArtifacts = getArtifactsByPayloadKind<ControlPlaneFailureReportArtifactPayload>(
    run,
    "failure_report"
  );
  const validationArtifactCount =
    run.controlPlane?.artifacts.filter((artifact) => artifact.kind === "validation_report").length ?? 0;
  const retryCount = evaluation?.scorecard.retryCount ?? countRetries(run);
  const interventionCount = evaluation?.scorecard.interventionCount ?? run.controlPlane?.interventions.length ?? 0;
  const blockerCount = evaluation?.scorecard.blockerCount ?? run.controlPlane?.blockers.length ?? 0;
  const conflictCount = evaluation?.scorecard.conflictCount ?? run.controlPlane?.conflicts.length ?? 0;
  const mergeDecisionCount =
    evaluation?.scorecard.mergeDecisionCount ?? run.controlPlane?.mergeDecisions.length ?? 0;
  const sourceArtifactIds = uniqueStrings([
    ...(delivery?.sourceArtifactIds ?? []),
    ...(run.rebuild?.artifactLog.map((artifact) => artifact.sourceArtifactId) ?? [])
  ]);
  const updatedAt =
    delivery?.updatedAt ??
    run.completedAt ??
    run.rebuild?.lastArtifactAt ??
    run.rollingSummary?.updatedAt ??
    null;
  const validationFailures = uniqueStrings(
    failureArtifacts.flatMap((artifact) => artifact.payload.validationFailures)
  ).slice(0, 4);
  const validationSignals = uniqueStrings([
    ...validationFailures,
    ...(run.lastValidationResult?.errors ?? []),
    ...(run.lastValidationResult?.warnings ?? [])
  ]).slice(0, 4);
  const openBlockerSummaries = getOpenBlockerSummaries(run).slice(0, 4);
  const openConflictSummaries = getOpenConflictSummaries(run).slice(0, 4);
  const mergeDecisionSummaries = uniqueStrings(
    run.controlPlane?.mergeDecisions.map((decision) => decision.summary) ?? []
  ).slice(0, 4);
  const interventionSummaries = uniqueStrings(
    [
      ...(run.controlPlane?.interventions.map((intervention) => intervention.summary) ?? []),
      ...(run.rebuild?.interventionLog.map((intervention) => intervention.summary) ?? [])
    ].filter(isNonEmptyString)
  ).slice(0, 4);
  const deliveryHighlights = uniqueStrings(
    [
      ...(delivery?.outputs ?? []),
      ...(delivery?.links.map((link) => `${link.label}: ${link.url}`) ?? [])
    ].filter(isNonEmptyString)
  ).slice(0, 4);
  const recommendationHighlights = uniqueStrings(
    [
      ...(evaluation?.bottlenecks.map((item) => `${item.label}: ${item.detail}`) ?? []),
      ...(evaluation?.failurePatterns ?? []),
      ...(delivery?.followUps ?? [])
    ].filter(isNonEmptyString)
  ).slice(0, 4);

  return {
    status: run.status === "failed" ? "failed" : "completed",
    headline:
      delivery?.headline ??
      run.result?.summary?.trim() ??
      run.error?.message?.trim() ??
      "Comparative analysis prepared from runtime evidence.",
    sections: [
      {
        id: "executive_summary",
        title: "Executive summary",
        summary:
          delivery?.headline ??
          (run.status === "failed"
            ? "The run closed with unresolved failure evidence."
            : "The run closed with a complete delivery summary."),
        highlights: compactHighlights([
          `Run status: ${humanizeKey(run.status)}.`,
          run.rebuild ? `Rebuild target: ${describeRebuildTarget(run)}.` : null,
          sourceArtifactIds.length > 0
            ? `Referenced evidence artifacts: ${sourceArtifactIds.length}.`
            : "No closeout artifact ids were attached to this report."
        ])
      },
      {
        id: "delivery_and_outputs",
        title: "Delivery and outputs",
        summary: delivery
          ? `Closeout recorded ${delivery.outputs.length} output(s) and ${delivery.links.length} delivery link(s).`
          : "Delivery output has not been assembled yet.",
        highlights: compactHighlights(
          deliveryHighlights.length > 0 ? deliveryHighlights : ["No delivery outputs were captured for this run."]
        )
      },
      {
        id: "validation_and_quality",
        title: "Validation and quality",
        summary: `Validation finished with status ${humanizeKey(
          run.rebuild?.validationStatus ?? run.validationStatus
        )} and ${validationArtifactCount} validation artifact(s).`,
        highlights: compactHighlights(
          validationSignals.length > 0
            ? validationSignals
            : ["No explicit validation failure details were recorded."]
        )
      },
      {
        id: "interventions_and_retries",
        title: "Interventions and retries",
        summary: `${retryCount} retr${retryCount === 1 ? "y" : "ies"} and ${interventionCount} intervention${
          interventionCount === 1 ? "" : "s"
        } were recorded before closeout.`,
        highlights: compactHighlights(
          interventionSummaries.length > 0
            ? interventionSummaries
            : ["The run completed without recorded interventions."]
        )
      },
      {
        id: "blockers_and_conflicts",
        title: "Blockers and conflicts",
        summary: `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}, ${conflictCount} conflict${
          conflictCount === 1 ? "" : "s"
        }, and ${mergeDecisionCount} merge decision${mergeDecisionCount === 1 ? "" : "s"} shaped the final state.`,
        highlights: compactHighlights(
          [
            ...openBlockerSummaries,
            ...openConflictSummaries,
            ...mergeDecisionSummaries
          ].length > 0
            ? [...openBlockerSummaries, ...openConflictSummaries, ...mergeDecisionSummaries]
            : ["No blockers or conflicts remained open at closeout."]
        )
      },
      {
        id: "risks_and_follow_ups",
        title: "Risks and follow-ups",
        summary: `${delivery?.risks.length ?? 0} risk${delivery?.risks.length === 1 ? "" : "s"} and ${
          delivery?.followUps.length ?? 0
        } follow-up${delivery?.followUps.length === 1 ? "" : "s"} were surfaced for the operator.`,
        highlights: compactHighlights(
          [
            ...(delivery?.risks ?? []),
            ...(delivery?.followUps ?? [])
          ].length > 0
            ? [...(delivery?.risks ?? []), ...(delivery?.followUps ?? [])]
            : ["No additional risks or follow-ups were attached to closeout."]
        )
      },
      {
        id: "recommended_improvements",
        title: "Recommended improvements",
        summary:
          recommendationHighlights.length > 0
            ? "The runtime surfaced concrete improvements from retries, bottlenecks, and closeout evidence."
            : "No additional improvement themes were inferred from the current evidence.",
        highlights: compactHighlights(
          recommendationHighlights.length > 0
            ? recommendationHighlights
            : ["Closeout did not surface additional improvement work beyond the recorded delivery summary."]
        )
      }
    ],
    sourceArtifactIds,
    updatedAt
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

function compactHighlights(values: Array<string | null | undefined>) {
  return uniqueStrings(values.filter(isNonEmptyString)).slice(0, 4);
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

function describeRebuildTarget(run: AgentRunRecord) {
  if (!run.rebuild) {
    return null;
  }

  return run.rebuild.target.label?.trim() || run.rebuild.target.objective?.trim() || run.rebuild.target.shipId;
}
