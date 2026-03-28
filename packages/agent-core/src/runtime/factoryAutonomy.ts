import type {
  ApprovalGateInput,
  FactoryAppSpec,
  FactoryAutonomyPolicy,
  PauseReason,
  RiskEscalationRule
} from "./types";

const FACTORY_PHASES = [
  {
    phaseId: "factory-intake",
    stageId: "intake",
    name: "Intake"
  },
  {
    phaseId: "factory-bootstrap",
    stageId: "bootstrap",
    name: "Bootstrap"
  },
  {
    phaseId: "factory-implementation",
    stageId: "implementation",
    name: "Implementation"
  },
  {
    phaseId: "factory-delivery",
    stageId: "delivery",
    name: "Delivery"
  }
] as const;

export function buildFactoryAutonomyPolicy(options: {
  appSpec: FactoryAppSpec;
}): FactoryAutonomyPolicy {
  const riskEscalationRules: RiskEscalationRule[] = [];
  const repositoryLabel = formatRepositoryLabel(
    options.appSpec.repository.owner,
    options.appSpec.repository.name
  );

  if (!options.appSpec.repository.owner) {
    riskEscalationRules.push(
      createRiskEscalationRule({
        phaseId: "factory-bootstrap",
        stageId: "bootstrap",
        title: "Resolve repository destination",
        summary: "Pause before bootstrap because the repository owner is not defined.",
        rationale:
          "Factory cannot safely publish or scaffold against an ambiguous repository destination.",
        trigger: "repository_owner_missing",
        pauseReason: "ambiguous_repository_target",
        approvalGateKind: "architecture",
        gateTitle: "Repository destination review",
        gateInstructions:
          "Confirm the repository owner or destination before bootstrap writes begin."
      })
    );
  }

  if (options.appSpec.repository.visibility === "public") {
    riskEscalationRules.push(
      createRiskEscalationRule({
        phaseId: "factory-bootstrap",
        stageId: "bootstrap",
        title: "Approve public repository target",
        summary: `Pause before bootstrap because ${repositoryLabel} is configured as a public repository.`,
        rationale:
          "Factory should not continue automatically when the target repository will be publicly visible.",
        trigger: "repository_visibility_public",
        pauseReason: "high_risk_repository_target",
        approvalGateKind: "architecture",
        gateTitle: "Public repository review",
        gateInstructions:
          "Confirm that the factory should continue with a public repository target before bootstrap writes begin."
      })
    );
  }

  if (
    options.appSpec.deployment.provider !== "manual" &&
    !options.appSpec.deployment.projectName?.trim()
  ) {
    riskEscalationRules.push(
      createRiskEscalationRule({
        phaseId: "factory-delivery",
        stageId: "delivery",
        title: "Resolve deployment destination",
        summary: `Pause before delivery because the ${options.appSpec.deployment.provider} project target is not defined.`,
        rationale:
          "Factory cannot safely finalize the delivery handoff when the hosted deployment destination is ambiguous.",
        trigger: "deployment_project_missing",
        pauseReason: "ambiguous_deployment_target",
        approvalGateKind: "deployment",
        gateTitle: "Deployment target review",
        gateInstructions:
          `Confirm the ${options.appSpec.deployment.provider} project destination before the delivery handoff is finalized.`
      })
    );
  }

  if (options.appSpec.deployment.provider === "manual") {
    riskEscalationRules.push(
      createRiskEscalationRule({
        phaseId: "factory-delivery",
        stageId: "delivery",
        title: "Approve manual deployment handoff",
        summary: "Pause before delivery because deployment is manual and cannot be verified end-to-end automatically.",
        rationale:
          "Factory should pause before final delivery when release verification depends on manual deployment execution.",
        trigger: "deployment_provider_manual",
        pauseReason: "high_risk_deployment_target",
        approvalGateKind: "deployment",
        gateTitle: "Manual deployment review",
        gateInstructions:
          "Review the manual deployment plan and release risk before Factory finalizes the delivery handoff."
      })
    );
  }

  return {
    version: 1,
    mode: "factory",
    defaultBehavior: "auto_continue",
    summary:
      "Continue automatically through Factory Mode by default. Pause only when a defined risk escalation rule or failed quality gate requires operator review.",
    autoContinuePhaseIds: FACTORY_PHASES
      .filter(
        (phase) =>
          !riskEscalationRules.some((rule) => rule.phaseId === phase.phaseId)
      )
      .map((phase) => phase.phaseId),
    autoContinueRules: [
      "Continue automatically when no risk escalation rule applies to the current Factory phase.",
      "Do not stop for routine bootstrap, implementation, or delivery reviews in Factory Mode.",
      "Pause only for defined risk, ambiguity, or failed quality gate conditions."
    ],
    riskEscalationRules,
    qualityGatePauseReason: "failed_quality_gate"
  };
}

export function findFactoryRiskEscalationRules(
  policy: FactoryAutonomyPolicy | null | undefined,
  phaseId: string
) {
  return policy?.riskEscalationRules.filter((rule) => rule.phaseId === phaseId) ?? [];
}

export function findFactoryPauseReason(
  policy: FactoryAutonomyPolicy | null | undefined,
  phaseId: string
): Exclude<PauseReason, "failed_quality_gate"> | null {
  return findFactoryRiskEscalationRules(policy, phaseId)[0]?.pauseReason ?? null;
}

export function buildFactoryAutonomyApprovalGate(options: {
  policy: FactoryAutonomyPolicy | null | undefined;
  phaseId: string;
  phaseName: string;
}): ApprovalGateInput | null {
  const rules = findFactoryRiskEscalationRules(options.policy, options.phaseId);

  if (rules.length === 0) {
    return null;
  }

  const gateKind = rules[0]?.approvalGateKind ?? "architecture";
  const title =
    rules.length === 1
      ? rules[0]?.gateTitle ?? `${options.phaseName} review`
      : `${options.phaseName} risk review`;
  const instructions = [
    `Factory autonomy paused ${options.phaseName} because ${rules.length === 1 ? "a defined escalation rule was triggered" : `${rules.length} escalation rules were triggered`}.`,
    "",
    ...rules.flatMap((rule) => [
      `- ${rule.summary}`,
      `  Reason: ${rule.rationale}`,
      `  Action: ${rule.gateInstructions}`
    ])
  ].join("\n");

  return {
    id: `factory-autonomy-gate:${options.phaseId}`,
    kind: gateKind,
    title,
    instructions
  };
}

export function summarizeFactoryAutonomyPolicy(policy: FactoryAutonomyPolicy) {
  const lines = [
    `Autonomy default: ${policy.defaultBehavior}.`,
    policy.summary,
    "",
    "Auto-continue rules:",
    ...policy.autoContinueRules.map((rule) => `- ${rule}`),
    "",
    `Auto-continue phases: ${policy.autoContinuePhaseIds.join(", ") || "none"}.`,
    "",
    "Risk escalation rules:",
    ...(policy.riskEscalationRules.length > 0
      ? policy.riskEscalationRules.flatMap((rule) => [
          `- ${rule.phaseId}: ${rule.summary}`,
          `  Trigger: ${rule.trigger}`,
          `  Pause reason: ${rule.pauseReason}`,
          `  Approval gate: ${rule.approvalGateKind}`
        ])
      : ["- none"])
  ];

  return lines.join("\n");
}

function createRiskEscalationRule(
  rule: Omit<RiskEscalationRule, "id">
): RiskEscalationRule {
  return {
    id: `factory-risk:${rule.phaseId}:${rule.trigger}`,
    ...rule
  };
}

function formatRepositoryLabel(owner: string | null, name: string) {
  return owner?.trim() ? `${owner.trim()}/${name}` : name;
}
