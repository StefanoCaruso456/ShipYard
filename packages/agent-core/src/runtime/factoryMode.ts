import type {
  AgentRunStatus,
  FactoryAppSpec,
  FactoryArtifact,
  FactoryArtifactStatus,
  FactoryCompletionContract,
  ControlPlaneState,
  FactoryDeploymentProviderId,
  FactoryDeploymentState,
  FactoryExpansionDecision,
  FactoryRepositoryProviderId,
  FactoryRepositoryState,
  FactoryRepositoryVisibility,
  FactoryDefinitionOfDone,
  FactoryRunInput,
  FactoryRunState,
  FactoryStagePlan,
  FactoryStackSummary,
  FactoryStageId,
  FactoryStackTemplateId,
  PhaseExecutionInput,
  PhaseExecutionState,
  RollingSummary,
  RunProjectInput,
  RunProjectLinkInput,
  RunContextInput,
  RepoToolRequest,
  SubmitTaskInput,
  ValidationGate
} from "./types";
import {
  buildFactoryImplementationScopeCriteria,
  buildInitialFactoryStagePlans,
  normalizeFactoryStagePlans,
  syncFactoryStagePlans
} from "./factoryBacklog";
import {
  buildFactoryAutonomyApprovalGate,
  buildFactoryAutonomyPolicy,
  summarizeFactoryAutonomyPolicy
} from "./factoryAutonomy";
import { syncFactoryDelegationState } from "./factoryDelegation";
import { syncFactoryMergeGovernanceState } from "./factoryMergeGovernance";
import { syncFactoryParallelismState } from "./factoryParallelism";
import { syncFactoryQualityGateState } from "./factoryQualityGates";

const DEFAULT_REPOSITORY_PROVIDER: FactoryRepositoryProviderId = "github";
const DEFAULT_REPOSITORY_VISIBILITY: FactoryRepositoryVisibility = "private";
const DEFAULT_REPOSITORY_BASE_BRANCH = "main";
const DEFAULT_FACTORY_STAGE: FactoryStageId = "intake";

const FACTORY_STACK_SUMMARIES: Record<FactoryStackTemplateId, FactoryStackSummary> = {
  nextjs_supabase_vercel: {
    templateId: "nextjs_supabase_vercel",
    label: "Next.js + Supabase + Vercel",
    frontend: "Next.js App Router",
    backend: "Server Actions and Route Handlers",
    data: "Supabase",
    deployment: "Vercel"
  },
  nextjs_railway_postgres: {
    templateId: "nextjs_railway_postgres",
    label: "Next.js + Railway Postgres",
    frontend: "Next.js App Router",
    backend: "Route Handlers and server utilities",
    data: "Railway Postgres",
    deployment: "Railway"
  },
  react_express_railway: {
    templateId: "react_express_railway",
    label: "React + Express + Railway",
    frontend: "React SPA",
    backend: "Express API",
    data: "Postgres-compatible backend",
    deployment: "Railway"
  }
};

const FACTORY_PHASE_STAGE_IDS = {
  "factory-intake": "intake",
  "factory-bootstrap": "bootstrap",
  "factory-implementation": "implementation",
  "factory-delivery": "delivery"
} as const satisfies Record<string, FactoryStageId>;

const FACTORY_IMPLEMENTATION_TASK_IDS = {
  nextjs_supabase_vercel: {
    shellTaskId: "task-nextjs-shell",
    flowTaskId: "task-supabase-flow"
  },
  nextjs_railway_postgres: {
    shellTaskId: "task-nextjs-shell",
    flowTaskId: "task-railway-data-flow"
  },
  react_express_railway: {
    shellTaskId: "task-frontend-shell",
    flowTaskId: "task-api-flow"
  }
} as const satisfies Record<
  FactoryStackTemplateId,
  {
    shellTaskId: string;
    flowTaskId: string;
  }
>;

type FactoryCompletionContractSeed = {
  appName: string;
  productBrief: string;
  stack: FactoryStackSummary;
  repository: Pick<
    FactoryRepositoryState,
    "provider" | "owner" | "name" | "visibility" | "baseBranch"
  >;
  deployment: Pick<FactoryDeploymentState, "provider" | "projectName" | "environment">;
};

export const factoryStackTemplateIds = Object.keys(
  FACTORY_STACK_SUMMARIES
) as FactoryStackTemplateId[];

export const factoryDeploymentProviderIds = [
  "vercel",
  "railway",
  "manual"
] as const satisfies readonly FactoryDeploymentProviderId[];

export const factoryRepositoryVisibilityOptions = [
  "private",
  "public"
] as const satisfies readonly FactoryRepositoryVisibility[];

export function isFactoryStackTemplateId(value: unknown): value is FactoryStackTemplateId {
  return typeof value === "string" && value in FACTORY_STACK_SUMMARIES;
}

export function isFactoryDeploymentProviderId(
  value: unknown
): value is FactoryDeploymentProviderId {
  return (
    value === "vercel" || value === "railway" || value === "manual"
  );
}

export function isFactoryRepositoryVisibility(
  value: unknown
): value is FactoryRepositoryVisibility {
  return value === "private" || value === "public";
}

export function getFactoryStackSummary(
  templateId: FactoryStackTemplateId
): FactoryStackSummary {
  return FACTORY_STACK_SUMMARIES[templateId];
}

export function normalizeFactoryRunInput(
  value: FactoryRunInput | null | undefined
): FactoryRunInput | null {
  if (!value) {
    return null;
  }

  const appName = value.appName?.trim();
  const repositoryName = value.repository?.name?.trim();
  const stackTemplateId = isFactoryStackTemplateId(value.stackTemplateId)
    ? value.stackTemplateId
    : null;
  const deploymentProvider = isFactoryDeploymentProviderId(value.deployment?.provider)
    ? value.deployment.provider
    : "manual";
  const normalizedDeployment = {
    provider: deploymentProvider,
    projectName: value.deployment?.projectName?.trim()
      ? value.deployment.projectName.trim()
      : null,
    environment: value.deployment?.environment?.trim()
      ? value.deployment.environment.trim()
      : null,
    url: value.deployment?.url?.trim() ? value.deployment.url.trim() : null
  } satisfies FactoryRunInput["deployment"];

  if (!appName || !repositoryName || !stackTemplateId) {
    return null;
  }

  return {
    appName,
    stackTemplateId,
    repository: {
      provider: DEFAULT_REPOSITORY_PROVIDER,
      owner: value.repository.owner?.trim() ? value.repository.owner.trim() : null,
      name: repositoryName,
      visibility: isFactoryRepositoryVisibility(value.repository.visibility)
        ? value.repository.visibility
        : DEFAULT_REPOSITORY_VISIBILITY,
      baseBranch: value.repository.baseBranch?.trim()
        ? value.repository.baseBranch.trim()
        : DEFAULT_REPOSITORY_BASE_BRANCH
    },
    deployment: normalizedDeployment
  };
}

export function createFactoryRunState(options: {
  input: FactoryRunInput;
  productBrief: string;
  workspacePath: string;
  repositoryUrl?: string | null;
  deploymentUrl?: string | null;
  phaseExecution?: PhaseExecutionState | null;
  createdAt?: string;
}): FactoryRunState {
  const normalized = normalizeFactoryRunInput(options.input);

  if (!normalized) {
    throw new Error("Factory input is missing required fields.");
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const repositoryUrl = options.repositoryUrl?.trim() ? options.repositoryUrl.trim() : null;
  const normalizedDeployment = normalized.deployment ?? {
    provider: "manual",
    projectName: null,
    environment: null,
    url: null
  };
  const deploymentUrl =
    options.deploymentUrl?.trim() ||
    normalizedDeployment.url?.trim() ||
    null;
  const stack = getFactoryStackSummary(normalized.stackTemplateId);
  const productBrief = options.productBrief.trim();
  const repository: FactoryRepositoryState = {
    provider: normalized.repository.provider ?? DEFAULT_REPOSITORY_PROVIDER,
    owner: normalized.repository.owner ?? null,
    name: normalized.repository.name,
    visibility: normalized.repository.visibility ?? DEFAULT_REPOSITORY_VISIBILITY,
    baseBranch: normalized.repository.baseBranch ?? DEFAULT_REPOSITORY_BASE_BRANCH,
    url: repositoryUrl,
    localPath: options.workspacePath.trim()
  };
  const deployment: FactoryDeploymentState = {
    provider: normalizedDeployment.provider,
    projectName: normalizedDeployment.projectName ?? null,
    environment: normalizedDeployment.environment ?? null,
    url: deploymentUrl
  };
  const repositoryLabel = formatRepositoryLabel(repository.owner, repository.name);
  const completionContract = buildFactoryCompletionContract({
    appName: normalized.appName,
    productBrief,
    stack,
    repository,
    deployment
  });
  const autonomyPolicy = buildFactoryAutonomyPolicy({
    appSpec: completionContract.appSpec
  });
  const stagePlans = buildInitialFactoryStagePlans({
    appSpec: completionContract.appSpec,
    completionContract,
    createdAt
  });

  const factory: FactoryRunState = {
    version: 1,
    mode: "factory",
    appName: normalized.appName,
    productBrief,
    stack,
    repository,
    deployment,
    completionContract,
    autonomyPolicy,
    stagePlans,
    expansionDecisions: [],
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
    phaseVerificationResults: [],
    phaseUnlockDecisions: [],
    workPackets: [],
    scopeLocks: [],
    parallelExecutionWindows: [],
    mergeDecisions: [],
    integrationBlockers: [],
    reassignmentDecisions: [],
    currentStage: DEFAULT_FACTORY_STAGE,
    artifacts: [
      {
        id: "factory-artifact:repository",
        kind: "repository",
        title: "Repository target",
        summary: `Bootstrap ${repositoryLabel} in the isolated factory workspace.`,
        status: "active",
        url: repositoryUrl,
        path: options.workspacePath.trim(),
        provider: normalized.repository.provider ?? DEFAULT_REPOSITORY_PROVIDER,
        updatedAt: createdAt
      },
      {
        id: "factory-artifact:bootstrap-plan",
        kind: "bootstrap_plan",
        title: "Bootstrap plan",
        summary: `Scaffold ${stack.label} in ${options.workspacePath.trim()}.`,
        status: "planned",
        url: null,
        path: options.workspacePath.trim(),
        provider: null,
        updatedAt: createdAt
      },
      {
        id: "factory-artifact:delivery-summary",
        kind: "delivery_summary",
        title: "Delivery summary",
        summary: `Summarize what shipped for ${normalized.appName}.`,
        status: "planned",
        url: null,
        path: null,
        provider: null,
        updatedAt: createdAt
      }
    ],
    deliverySummary: null,
    createdAt,
    updatedAt: createdAt
  };

  const delegatedFactory = {
    ...factory,
    ...syncFactoryDelegationState({
      factory,
      phaseExecution: options.phaseExecution ?? null,
      updatedAt: createdAt
    })
  };

  const qualityGateFactory = {
    ...delegatedFactory,
    ...syncFactoryQualityGateState({
      factory: delegatedFactory,
      phaseExecution: options.phaseExecution ?? null,
      updatedAt: createdAt
    })
  };

  const parallelFactory = {
    ...qualityGateFactory,
    ...syncFactoryParallelismState({
      factory: qualityGateFactory,
      phaseExecution: options.phaseExecution ?? null,
      controlPlane: null,
      updatedAt: createdAt
    })
  };

  return {
    ...parallelFactory,
    ...syncFactoryMergeGovernanceState({
      factory: parallelFactory,
      controlPlane: null,
      updatedAt: createdAt
    })
  };
}

export function normalizeFactoryRunState(
  value: FactoryRunState | null | undefined
): FactoryRunState | null {
  if (!value || value.mode !== "factory") {
    return null;
  }

  const stack = isFactoryStackTemplateId(value.stack?.templateId)
    ? getFactoryStackSummary(value.stack.templateId)
    : null;
  const appName = value.appName?.trim();

  if (!stack || !appName) {
    return null;
  }

  const productBrief = value.productBrief?.trim() ? value.productBrief.trim() : "";
  const repository: FactoryRepositoryState = {
    provider: value.repository?.provider === "github" ? "github" : DEFAULT_REPOSITORY_PROVIDER,
    owner: value.repository?.owner?.trim() ? value.repository.owner.trim() : null,
    name: value.repository?.name?.trim() ? value.repository.name.trim() : slugify(appName),
    visibility: isFactoryRepositoryVisibility(value.repository?.visibility)
      ? value.repository.visibility
      : DEFAULT_REPOSITORY_VISIBILITY,
    baseBranch: value.repository?.baseBranch?.trim()
      ? value.repository.baseBranch.trim()
      : DEFAULT_REPOSITORY_BASE_BRANCH,
    url: value.repository?.url?.trim() ? value.repository.url.trim() : null,
    localPath: value.repository?.localPath?.trim() ? value.repository.localPath.trim() : null
  };
  const deployment: FactoryDeploymentState = {
    provider: isFactoryDeploymentProviderId(value.deployment?.provider)
      ? value.deployment.provider
      : "manual",
    projectName: value.deployment?.projectName?.trim()
      ? value.deployment.projectName.trim()
      : null,
    environment: value.deployment?.environment?.trim()
      ? value.deployment.environment.trim()
      : null,
    url: value.deployment?.url?.trim() ? value.deployment.url.trim() : null
  };
  const completionContract = buildFactoryCompletionContract({
    appName,
    productBrief,
    stack,
    repository,
    deployment
  });
  const autonomyPolicy = buildFactoryAutonomyPolicy({
    appSpec: completionContract.appSpec
  });
  const createdAt = value.createdAt?.trim() || new Date().toISOString();
  const updatedAt = value.updatedAt?.trim() || value.createdAt?.trim() || new Date().toISOString();
  const stagePlans = normalizeFactoryStagePlans({
    value: value.stagePlans,
    completionContract,
    createdAt
  });
  const expansionDecisions = normalizeFactoryExpansionDecisions(value.expansionDecisions);

  const factory: FactoryRunState = {
    version: 1,
    mode: "factory",
    appName,
    productBrief,
    stack,
    repository,
    deployment,
    completionContract,
    autonomyPolicy,
    stagePlans,
    expansionDecisions,
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
    phaseVerificationResults: [],
    phaseUnlockDecisions: [],
    workPackets: Array.isArray(value.workPackets)
      ? value.workPackets.map((packet) => ({ ...packet }))
      : [],
    scopeLocks: Array.isArray(value.scopeLocks)
      ? value.scopeLocks.map((lock) => ({ ...lock }))
      : [],
    parallelExecutionWindows: Array.isArray(value.parallelExecutionWindows)
      ? value.parallelExecutionWindows.map((window) => ({ ...window }))
      : [],
    mergeDecisions: Array.isArray(value.mergeDecisions)
      ? value.mergeDecisions.map((decision) => ({ ...decision }))
      : [],
    integrationBlockers: Array.isArray(value.integrationBlockers)
      ? value.integrationBlockers.map((blocker) => ({ ...blocker }))
      : [],
    reassignmentDecisions: Array.isArray(value.reassignmentDecisions)
      ? value.reassignmentDecisions.map((decision) => ({ ...decision }))
      : [],
    currentStage: normalizeFactoryStageId(value.currentStage),
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts
          .filter((artifact) => artifact && typeof artifact.kind === "string")
          .map((artifact) => ({
            id: artifact.id?.trim() || `factory-artifact:${artifact.kind}`,
            kind: normalizeFactoryArtifactKind(artifact.kind),
            title: artifact.title?.trim() || humanizeFactoryArtifactKind(artifact.kind),
            summary: artifact.summary?.trim() || humanizeFactoryArtifactKind(artifact.kind),
            status: normalizeFactoryArtifactStatus(artifact.status),
            url: artifact.url?.trim() ? artifact.url.trim() : null,
            path: artifact.path?.trim() ? artifact.path.trim() : null,
            provider: artifact.provider?.trim() ? artifact.provider.trim() : null,
            updatedAt: artifact.updatedAt?.trim() || value.updatedAt || value.createdAt
          }))
      : [],
    deliverySummary: value.deliverySummary?.trim() ? value.deliverySummary.trim() : null,
    createdAt,
    updatedAt
  };

  const delegatedFactory = {
    ...factory,
    ...syncFactoryDelegationState({
      factory,
      updatedAt
    })
  };

  const qualityGateFactory = {
    ...delegatedFactory,
    ...syncFactoryQualityGateState({
      factory: delegatedFactory,
      updatedAt
    })
  };

  const parallelFactory = {
    ...qualityGateFactory,
    ...syncFactoryParallelismState({
      factory: qualityGateFactory,
      phaseExecution: null,
      controlPlane: null,
      updatedAt
    })
  };

  return {
    ...parallelFactory,
    ...syncFactoryMergeGovernanceState({
      factory: parallelFactory,
      controlPlane: null,
      updatedAt
    })
  };
}

export function syncFactoryRunState(options: {
  factory: FactoryRunState | null | undefined;
  phaseExecution?: PhaseExecutionState | null;
  controlPlane?: ControlPlaneState | null;
  project?: RunProjectInput | null;
  status?: AgentRunStatus;
  rollingSummary?: RollingSummary | null;
  resultSummary?: string | null;
  updatedAt?: string | null;
}): FactoryRunState | null {
  const normalized = normalizeFactoryRunState(options.factory);

  if (!normalized) {
    return null;
  }

  const repositoryLink = findProjectLink(options.project?.links, "repository");
  const deploymentLink = findProjectLink(options.project?.links, "deployment");
  const currentStage = deriveFactoryStage(options.phaseExecution, normalized.currentStage);
  const updatedAt =
    options.updatedAt?.trim() ||
    options.rollingSummary?.updatedAt ||
    normalized.updatedAt;
  const deliverySummary = resolveFactoryDeliverySummary({
    phaseExecution: options.phaseExecution ?? null,
    status: options.status ?? null,
    resultSummary: options.resultSummary ?? null,
    rollingSummary: options.rollingSummary ?? null,
    fallback: normalized.deliverySummary
  });
  const repository: FactoryRepositoryState = {
    ...normalized.repository,
    url: repositoryLink?.url ?? normalized.repository.url,
    localPath:
      options.project?.folder?.provider === "runtime" &&
      options.project.folder.displayPath?.trim()
        ? options.project.folder.displayPath.trim()
        : normalized.repository.localPath
  };
  const deployment: FactoryDeploymentState = {
    ...normalized.deployment,
    url: deploymentLink?.url ?? normalized.deployment.url
  };
  const completionContract = buildFactoryCompletionContract({
    appName: normalized.appName,
    productBrief: normalized.productBrief,
    stack: normalized.stack,
    repository,
    deployment
  });
  const autonomyPolicy = buildFactoryAutonomyPolicy({
    appSpec: completionContract.appSpec
  });
  const stagePlans = syncFactoryStagePlans({
    stagePlans: normalized.stagePlans,
    phaseExecution: options.phaseExecution ?? null,
    completionContract,
    updatedAt
  });

  const nextFactory: FactoryRunState = {
    ...normalized,
    repository,
    deployment,
    completionContract,
    autonomyPolicy,
    stagePlans,
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
    phaseVerificationResults: [],
    phaseUnlockDecisions: [],
    workPackets: normalized.workPackets,
    scopeLocks: normalized.scopeLocks,
    parallelExecutionWindows: normalized.parallelExecutionWindows,
    mergeDecisions: normalized.mergeDecisions,
    integrationBlockers: normalized.integrationBlockers,
    reassignmentDecisions: normalized.reassignmentDecisions,
    currentStage,
    deliverySummary,
    updatedAt
  };

  nextFactory.artifacts = buildFactoryArtifacts(nextFactory, {
    phaseExecution: options.phaseExecution ?? null,
    status: options.status ?? null,
    updatedAt,
    deliverySummary
  });

  const delegatedFactory = {
    ...nextFactory,
    ...syncFactoryDelegationState({
      factory: nextFactory,
      phaseExecution: options.phaseExecution ?? null,
      controlPlane: options.controlPlane ?? null,
      updatedAt
    })
  };

  const qualityGateFactory = {
    ...delegatedFactory,
    ...syncFactoryQualityGateState({
      factory: delegatedFactory,
      phaseExecution: options.phaseExecution ?? null,
      updatedAt
    })
  };

  const parallelFactory = {
    ...qualityGateFactory,
    ...syncFactoryParallelismState({
      factory: qualityGateFactory,
      phaseExecution: options.phaseExecution ?? null,
      controlPlane: options.controlPlane ?? null,
      updatedAt
    })
  };

  return {
    ...parallelFactory,
    ...syncFactoryMergeGovernanceState({
      factory: parallelFactory,
      controlPlane: options.controlPlane ?? null,
      updatedAt
    })
  };
}

export function compileFactoryTaskSubmission(options: {
  input: SubmitTaskInput;
  workspacePath: string;
  projectId?: string | null;
}): SubmitTaskInput {
  const normalizedFactory = normalizeFactoryRunInput(options.input.factory);

  if (!normalizedFactory) {
    throw new Error("Factory input is required.");
  }

  const stack = getFactoryStackSummary(normalizedFactory.stackTemplateId);
  const normalizedDeployment = normalizedFactory.deployment ?? {
    provider: "manual",
    projectName: null,
    environment: null,
    url: null
  };
  const completionContract = buildFactoryCompletionContract({
    appName: normalizedFactory.appName,
    productBrief: options.input.instruction,
    stack,
    repository: {
      provider: normalizedFactory.repository.provider ?? DEFAULT_REPOSITORY_PROVIDER,
      owner: normalizedFactory.repository.owner ?? null,
      name: normalizedFactory.repository.name,
      visibility: normalizedFactory.repository.visibility ?? DEFAULT_REPOSITORY_VISIBILITY,
      baseBranch: normalizedFactory.repository.baseBranch ?? DEFAULT_REPOSITORY_BASE_BRANCH
    },
    deployment: {
      provider: normalizedDeployment.provider,
      projectName: normalizedDeployment.projectName ?? null,
      environment: normalizedDeployment.environment ?? null
    }
  });
  const autonomyPolicy = buildFactoryAutonomyPolicy({
    appSpec: completionContract.appSpec
  });
  const projectLinks = mergeProjectLinks(
    options.input.project?.links,
    normalizedDeployment.url?.trim()
      ? [
          {
            kind: "deployment",
            url: normalizedDeployment.url.trim(),
            title: `${normalizedFactory.appName} deployment`,
            provider: normalizedDeployment.provider,
            entityKind: "run"
          }
        ]
      : []
  );

  return {
    ...options.input,
    title:
      options.input.title?.trim() || `Factory · ${normalizedFactory.appName}`,
    toolRequest: null,
    rebuild: null,
    project: {
      id: options.projectId?.trim() || options.input.project?.id?.trim() || "shipyard-runtime",
      name: options.input.project?.name?.trim() || normalizedFactory.appName,
      kind: "live",
      environment: "Factory Mode",
      description: `${stack.label} factory workspace for ${normalizedFactory.appName}.`,
      links: projectLinks,
      folder: {
        name: normalizedFactory.repository.name,
        displayPath: options.workspacePath,
        status: "connected",
        provider: "runtime"
      }
    },
    context: buildFactoryRunContext(
      options.input.context,
      normalizedFactory,
      completionContract,
      autonomyPolicy
    ),
    phaseExecution: buildFactoryPhaseExecution(
      normalizedFactory,
      completionContract,
      autonomyPolicy
    ),
    factory: normalizedFactory
  };
}

function buildFactoryRunContext(
  base: SubmitTaskInput["context"],
  factory: FactoryRunInput,
  completionContract: FactoryCompletionContract,
  autonomyPolicy: ReturnType<typeof buildFactoryAutonomyPolicy>
): RunContextInput {
  const stack = getFactoryStackSummary(factory.stackTemplateId);
  const existing = base ?? {
    objective: null,
    constraints: [],
    relevantFiles: [],
    externalContext: [],
    validationTargets: []
  };

  return {
    objective:
      existing.objective?.trim() ||
      `Launch a new ${stack.label} application named ${factory.appName}.`,
    constraints: uniqueStrings([
      ...existing.constraints,
      "Operate only inside the connected runtime folder for this factory run.",
      "Treat this as a greenfield application bootstrap, not an edit to the Shipyard control repository.",
      "Continue automatically by default in Factory Mode unless a defined risk escalation rule or failed quality gate requires a stop.",
      "Do not create, connect, or publish a remote repository unless a later explicit task asks for it.",
      `Use the selected stack template: ${stack.label}.`,
      "Build the application locally first. Defer hosted deployment setup, cloud infrastructure wiring, and live database provisioning to a later operator-directed follow-up.",
      "For the first Factory slice, prefer local fixtures, seeded demo content, and adapter seams over provisioning real hosted data services."
    ]),
    relevantFiles: mergeRelevantFiles(existing.relevantFiles, [
      {
        path: "README.md",
        reason: "Seeded factory brief for the new application.",
        source: "factory-mode"
      },
      {
        path: "shipyard.factory.json",
        reason: "Typed factory metadata for the greenfield build.",
        source: "factory-mode"
      }
    ]),
    externalContext: [
      ...(existing.externalContext ?? []),
      {
        id: "factory-completion-contract",
        kind: "spec",
        title: "Factory completion contract",
        content: summarizeFactoryCompletionContract(completionContract),
        source: "factory-mode",
        format: "markdown"
      },
      {
        id: "factory-autonomy-policy",
        kind: "spec",
        title: "Factory autonomy policy",
        content: summarizeFactoryAutonomyPolicy(autonomyPolicy),
        source: "factory-mode",
        format: "markdown"
      },
      {
        id: "factory-stack-summary",
        kind: "spec",
        title: "Factory stack summary",
        content: [
          `Template: ${stack.label}`,
          `Frontend: ${stack.frontend}`,
          `Backend: ${stack.backend}`,
          `Suggested integration target: ${stack.data}`,
          "Delivery path: operator-managed manual deployment after the application is working locally."
        ].join("\n"),
        source: "factory-mode",
        format: "markdown"
      },
      {
        id: "factory-targets",
        kind: "spec",
        title: "Factory targets",
        content: [
          `App: ${factory.appName}`,
          `Planned repository name: ${formatRepositoryLabel(factory.repository.owner ?? null, factory.repository.name)}`,
          "Remote repository setup: defer until an explicit later step.",
          "Deployment: manual follow-up after the application build is complete.",
          "Data setup: defer hosted database provisioning until the local product flow is working."
        ]
          .filter(Boolean)
          .join("\n"),
        source: "factory-mode",
        format: "markdown"
      }
    ],
    validationTargets: uniqueStrings([
      ...existing.validationTargets,
      ...completionContract.definitionOfDone.completionCriteria.map(
        (criterion) => criterion.description
      )
    ]),
    specialistAgentTypeId: existing.specialistAgentTypeId ?? null
  };
}

function buildFactoryPhaseExecution(
  factory: FactoryRunInput,
  completionContract: FactoryCompletionContract,
  autonomyPolicy: ReturnType<typeof buildFactoryAutonomyPolicy>
): PhaseExecutionInput {
  const stack = getFactoryStackSummary(factory.stackTemplateId);
  const intakeCriteria = getFactoryPhaseCriteria(completionContract, "factory-intake");
  const bootstrapCriteria = getFactoryPhaseCriteria(completionContract, "factory-bootstrap");
  const implementationCriteria = getFactoryPhaseCriteria(
    completionContract,
    "factory-implementation"
  );
  const deliveryCriteria = getFactoryPhaseCriteria(completionContract, "factory-delivery");

  return {
    phases: [
      {
        id: "factory-intake",
        name: "Intake",
        description: `Clarify the product brief and working scope for ${factory.appName}.`,
        completionCriteria: intakeCriteria.completionCriteria,
        verificationCriteria: intakeCriteria.verificationCriteria,
        userStories: [
          {
            id: "story-product-brief",
            title: "Capture the product brief",
            description: `Translate the request for ${factory.appName} into a scoped build brief.`,
            acceptanceCriteria: ["Product brief captured.", "Factory scope aligned."],
            tasks: [
              createFactoryTask({
                id: "task-product-brief",
                instruction: `Translate the request into a concise product brief for ${factory.appName}. Cover users, primary flows, core entities, and key constraints. When the brief is ready, explicitly say "Product brief captured."`,
                expectedOutcome: "Product brief captured."
              }),
              createFactoryTask({
                id: "task-factory-scope",
                instruction: `Define the initial factory scope for ${factory.appName} using ${stack.label}. Call out assumptions, the first implementation slice, and what must be true before delivery. When done, explicitly say "Factory scope aligned."`,
                expectedOutcome: "Factory scope aligned."
              })
            ]
          }
        ]
      },
      {
        id: "factory-bootstrap",
        name: "Bootstrap",
        description: `Scaffold the repository foundation for ${factory.appName}.`,
        completionCriteria: bootstrapCriteria.completionCriteria,
        verificationCriteria: bootstrapCriteria.verificationCriteria,
        approvalGate:
          buildFactoryAutonomyApprovalGate({
            policy: autonomyPolicy,
            phaseId: "factory-bootstrap",
            phaseName: "Bootstrap"
          }) ?? undefined,
        userStories: [
          {
            id: "story-repository-bootstrap",
            title: "Scaffold repository foundation",
            description: `Create the initial repository structure for ${factory.appName}.`,
            acceptanceCriteria: ["Repository foundation scaffolded."],
            preferredSpecialistAgentTypeId: "repo_tools_dev",
            tasks: [
              createFactoryTask({
                id: "task-repository-bootstrap",
                instruction: `Inside the connected runtime folder, scaffold the initial repository foundation for ${factory.appName}. Create the top-level files, configuration, starter structure, and setup docs needed to run the application locally with ${stack.label}. Reuse README.md and shipyard.factory.json when helpful. Do not create, connect, or publish a GitHub repository or any remote during this task. Do not wire hosted deployment targets or live database infrastructure in this bootstrap step. When complete, explicitly say "Repository foundation scaffolded."`,
                expectedOutcome: "Repository foundation scaffolded.",
                requiredSpecialistAgentTypeId: "repo_tools_dev"
              })
            ]
          }
        ]
      },
      {
        id: "factory-implementation",
        name: "Implementation",
        description: `Build the initial product slice for ${factory.appName}.`,
        completionCriteria: implementationCriteria.completionCriteria,
        verificationCriteria: implementationCriteria.verificationCriteria,
        approvalGate:
          buildFactoryAutonomyApprovalGate({
            policy: autonomyPolicy,
            phaseId: "factory-implementation",
            phaseName: "Implementation"
          }) ?? undefined,
        userStories: buildImplementationStories(factory)
      },
      {
        id: "factory-delivery",
        name: "Delivery",
        description: `Verify the application build and summarize the delivery state for ${factory.appName}.`,
        completionCriteria: deliveryCriteria.completionCriteria,
        verificationCriteria: deliveryCriteria.verificationCriteria,
        approvalGate:
          buildFactoryAutonomyApprovalGate({
            policy: autonomyPolicy,
            phaseId: "factory-delivery",
            phaseName: "Delivery"
          }) ?? undefined,
        userStories: [
          {
            id: "story-delivery-handoff",
            title: "Prepare the handoff",
            description: `Summarize the delivery state for ${factory.appName}.`,
            acceptanceCriteria: [
              "Production readiness gate passed.",
              "Delivery summary prepared."
            ],
            preferredSpecialistAgentTypeId: "repo_tools_dev",
            tasks: [
              createFactoryTask({
                id: "task-production-readiness",
                instruction: `Run the production readiness gate for ${factory.appName}. Verify the connected runtime workspace by executing the declared verification scripts for ${stack.label}. Require a build script and at least one additional verification script among typecheck, lint, or test. If any check fails, stop and report the failing command instead of claiming success. When complete, explicitly say "Production readiness gate passed."`,
                expectedOutcome: "Production readiness gate passed.",
                requiredSpecialistAgentTypeId: "repo_tools_dev",
                toolRequest: buildFactoryProductionReadinessToolRequest()
              }),
              createFactoryTask({
                id: "task-delivery-summary",
                instruction: `Create the final delivery summary for ${factory.appName}. Include what shipped, the repository target ${formatRepositoryLabel(factory.repository.owner ?? null, factory.repository.name)}, what remains for manual deployment or hosted integration, and the next operator action. When complete, explicitly say "Delivery summary prepared."`,
                expectedOutcome: "Delivery summary prepared.",
                requiredSpecialistAgentTypeId: "repo_tools_dev"
              })
            ]
          }
        ]
      }
    ]
  };
}

function buildImplementationStories(factory: FactoryRunInput) {
  switch (factory.stackTemplateId) {
    case "react_express_railway":
      return [
        {
          id: "story-frontend-shell",
          title: "Build the frontend shell",
          description: `Create the React application shell for ${factory.appName}.`,
          acceptanceCriteria: ["Application shell implemented."],
          preferredSpecialistAgentTypeId: "frontend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-frontend-shell",
              instruction: `Build the primary React application shell for ${factory.appName}. Create the main screens, layout, navigation, and shared UI primitives for the first product slice. When complete, explicitly say "Application shell implemented."`,
              expectedOutcome: "Application shell implemented.",
              requiredSpecialistAgentTypeId: "frontend_dev"
            })
          ]
        },
        {
          id: "story-api-flow",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-api-flow",
              instruction: `Implement the first interactive product flow for ${factory.appName}. Connect the React shell to local fixtures, lightweight in-repo data adapters, or mock service boundaries so the application works locally without hosted deployment or external database setup. When complete, explicitly say "Core product flow implemented."`,
              expectedOutcome: "Core product flow implemented.",
              requiredSpecialistAgentTypeId: "backend_dev"
            })
          ]
        }
      ];
    case "nextjs_railway_postgres":
      return [
        {
          id: "story-nextjs-shell",
          title: "Build the Next.js app shell",
          description: `Create the Next.js shell for ${factory.appName}.`,
          acceptanceCriteria: ["Application shell implemented."],
          preferredSpecialistAgentTypeId: "frontend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-nextjs-shell",
              instruction: `Build the primary Next.js application shell for ${factory.appName}. Create the landing experience, the main product route, layout primitives, and shared UI needed for the first slice. When complete, explicitly say "Application shell implemented."`,
              expectedOutcome: "Application shell implemented.",
              requiredSpecialistAgentTypeId: "frontend_dev"
            })
          ]
        },
        {
          id: "story-railway-data-flow",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-railway-data-flow",
              instruction: `Implement the first interactive product flow for ${factory.appName}. Use local fixtures, lightweight in-repo data adapters, or mock server boundaries so the product works locally while leaving Railway and hosted database setup for a later follow-up. When complete, explicitly say "Core product flow implemented."`,
              expectedOutcome: "Core product flow implemented.",
              requiredSpecialistAgentTypeId: "backend_dev"
            })
          ]
        }
      ];
    case "nextjs_supabase_vercel":
    default:
      return [
        {
          id: "story-nextjs-shell",
          title: "Build the Next.js app shell",
          description: `Create the Next.js shell for ${factory.appName}.`,
          acceptanceCriteria: ["Application shell implemented."],
          preferredSpecialistAgentTypeId: "frontend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-nextjs-shell",
              instruction: `Build the primary Next.js application shell for ${factory.appName}. Create the initial routes, layout, shared UI, and the main product entry flow for the first slice. When complete, explicitly say "Application shell implemented."`,
              expectedOutcome: "Application shell implemented.",
              requiredSpecialistAgentTypeId: "frontend_dev"
            })
          ]
        },
        {
          id: "story-supabase-flow",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-supabase-flow",
              instruction: `Implement the first interactive product flow for ${factory.appName}. Use local fixtures, seeded demo content, or clear adapter seams so the application works locally while leaving Supabase wiring, auth provider setup, and hosted deployment for a later follow-up. When complete, explicitly say "Core product flow implemented."`,
              expectedOutcome: "Core product flow implemented.",
              requiredSpecialistAgentTypeId: "backend_dev"
            })
          ]
        }
      ];
  }
}

function buildFactoryCompletionContract(
  seed: FactoryCompletionContractSeed
): FactoryCompletionContract {
  const appSpec: FactoryAppSpec = {
    appName: seed.appName,
    productBrief: seed.productBrief.trim(),
    stack: seed.stack,
    repository: {
      provider: seed.repository.provider,
      owner: seed.repository.owner ?? null,
      name: seed.repository.name,
      visibility: seed.repository.visibility,
      baseBranch: seed.repository.baseBranch
    },
    deployment: {
      provider: seed.deployment.provider,
      projectName: seed.deployment.projectName ?? null,
      environment: seed.deployment.environment ?? null
    }
  };

  return {
    version: 1,
    appSpec,
    definitionOfDone: buildFactoryDefinitionOfDone(appSpec),
    phases: buildFactoryPhaseContracts(appSpec)
  };
}

function buildFactoryDefinitionOfDone(appSpec: FactoryAppSpec): FactoryDefinitionOfDone {
  const repositoryLabel = formatRepositoryLabel(appSpec.repository.owner, appSpec.repository.name);

  return {
    summary: `${appSpec.appName} is complete when ${repositoryLabel} contains a verified first delivery slice on ${appSpec.stack.label}, the production readiness gate passes, and the delivery summary is ready for operator review.`,
    completionCriteria: [
      {
        id: "definition-of-done:intake",
        description: "Factory intake is locked with a scoped product brief and first deliverable slice."
      },
      {
        id: "definition-of-done:bootstrap",
        description: `Repository foundation is scaffolded for ${repositoryLabel}.`
      },
      {
        id: "definition-of-done:implementation",
        description: "Application shell and core product flow are implemented for the first slice."
      },
      {
        id: "definition-of-done:delivery",
        description: "Production readiness is verified, and the delivery summary is prepared for operator review."
      }
    ],
    verificationCriteria: [
      {
        id: "definition-of-done:phase-intake",
        description: "Phase execution marks Intake as completed.",
        evidenceKind: "phase_status",
        target: "factory-intake",
        expectedValue: "completed"
      },
      {
        id: "definition-of-done:phase-bootstrap",
        description: "Phase execution marks Bootstrap as completed.",
        evidenceKind: "phase_status",
        target: "factory-bootstrap",
        expectedValue: "completed"
      },
      {
        id: "definition-of-done:phase-implementation",
        description: "Phase execution marks Implementation as completed.",
        evidenceKind: "phase_status",
        target: "factory-implementation",
        expectedValue: "completed"
      },
      {
        id: "definition-of-done:phase-delivery",
        description: "Phase execution marks Delivery as completed.",
        evidenceKind: "phase_status",
        target: "factory-delivery",
        expectedValue: "completed"
      },
      {
        id: "definition-of-done:production-readiness",
        description: 'Execution evidence includes "Production readiness gate passed."',
        evidenceKind: "task_evidence",
        target: "task-production-readiness",
        expectedValue: "Production readiness gate passed."
      },
      {
        id: "definition-of-done:delivery-summary",
        description: "Delivery summary is persisted in runtime state.",
        evidenceKind: "delivery_summary",
        target: "factory.deliverySummary"
      }
    ]
  };
}

function buildFactoryPhaseContracts(
  appSpec: FactoryAppSpec
): FactoryCompletionContract["phases"] {
  const implementationTaskIds = FACTORY_IMPLEMENTATION_TASK_IDS[appSpec.stack.templateId];
  const implementationScopeCriteria = buildFactoryImplementationScopeCriteria(appSpec);

  return [
    {
      phaseId: "factory-intake",
      stageId: "intake",
      name: "Intake",
      completionCriteria: [
        {
          id: "factory-intake:product-brief",
          description: "Product brief captured."
        },
        {
          id: "factory-intake:scope-aligned",
          description: "Factory scope aligned around the first deliverable slice."
        }
      ],
      verificationCriteria: [
        {
          id: "factory-intake:phase-status",
          description: "Phase execution marks Intake as completed.",
          evidenceKind: "phase_status",
          target: "factory-intake",
          expectedValue: "completed"
        },
        {
          id: "factory-intake:product-brief-evidence",
          description: 'Execution evidence includes "Product brief captured."',
          evidenceKind: "task_evidence",
          target: "task-product-brief",
          expectedValue: "Product brief captured."
        },
        {
          id: "factory-intake:scope-evidence",
          description: 'Execution evidence includes "Factory scope aligned."',
          evidenceKind: "task_evidence",
          target: "task-factory-scope",
          expectedValue: "Factory scope aligned."
        }
      ]
    },
    {
      phaseId: "factory-bootstrap",
      stageId: "bootstrap",
      name: "Bootstrap",
      completionCriteria: [
        {
          id: "factory-bootstrap:repository-foundation",
          description: "Repository foundation scaffolded."
        },
        {
          id: "factory-bootstrap:stack-alignment",
          description: "Bootstrap plan aligned to the selected stack and factory workspace."
        }
      ],
      verificationCriteria: [
        {
          id: "factory-bootstrap:phase-status",
          description: "Phase execution marks Bootstrap as completed.",
          evidenceKind: "phase_status",
          target: "factory-bootstrap",
          expectedValue: "completed"
        },
        {
          id: "factory-bootstrap:repository-evidence",
          description: 'Execution evidence includes "Repository foundation scaffolded."',
          evidenceKind: "task_evidence",
          target: "task-repository-bootstrap",
          expectedValue: "Repository foundation scaffolded."
        },
        {
          id: "factory-bootstrap:repository-artifact",
          description: "Repository target artifact is marked completed.",
          evidenceKind: "artifact_status",
          target: "factory-artifact:repository",
          expectedValue: "completed"
        },
        {
          id: "factory-bootstrap:plan-artifact",
          description: "Bootstrap plan artifact is marked completed.",
          evidenceKind: "artifact_status",
          target: "factory-artifact:bootstrap-plan",
          expectedValue: "completed"
        }
      ]
    },
    {
      phaseId: "factory-implementation",
      stageId: "implementation",
      name: "Implementation",
      completionCriteria: [
        {
          id: "factory-implementation:app-shell",
          description: "Application shell implemented."
        },
        {
          id: "factory-implementation:core-flow",
          description: "Core product flow implemented."
        },
        ...implementationScopeCriteria.completionCriteria
      ],
      verificationCriteria: [
        {
          id: "factory-implementation:phase-status",
          description: "Phase execution marks Implementation as completed.",
          evidenceKind: "phase_status",
          target: "factory-implementation",
          expectedValue: "completed"
        },
        {
          id: "factory-implementation:app-shell-evidence",
          description: 'Execution evidence includes "Application shell implemented."',
          evidenceKind: "task_evidence",
          target: implementationTaskIds.shellTaskId,
          expectedValue: "Application shell implemented."
        },
        {
          id: "factory-implementation:core-flow-evidence",
          description: 'Execution evidence includes "Core product flow implemented."',
          evidenceKind: "task_evidence",
          target: implementationTaskIds.flowTaskId,
          expectedValue: "Core product flow implemented."
        },
        ...implementationScopeCriteria.verificationCriteria
      ]
    },
    {
      phaseId: "factory-delivery",
      stageId: "delivery",
      name: "Delivery",
      completionCriteria: [
        {
          id: "factory-delivery:production-readiness",
          description: "Production readiness gate passed."
        },
        {
          id: "factory-delivery:delivery-summary",
          description: "Delivery summary prepared."
        }
      ],
      verificationCriteria: [
        {
          id: "factory-delivery:phase-status",
          description: "Phase execution marks Delivery as completed.",
          evidenceKind: "phase_status",
          target: "factory-delivery",
          expectedValue: "completed"
        },
        {
          id: "factory-delivery:production-readiness-evidence",
          description: 'Execution evidence includes "Production readiness gate passed."',
          evidenceKind: "task_evidence",
          target: "task-production-readiness",
          expectedValue: "Production readiness gate passed."
        },
        {
          id: "factory-delivery:summary-evidence",
          description: 'Execution evidence includes "Delivery summary prepared."',
          evidenceKind: "task_evidence",
          target: "task-delivery-summary",
          expectedValue: "Delivery summary prepared."
        },
        {
          id: "factory-delivery:summary-artifact",
          description: "Delivery summary artifact is marked completed.",
          evidenceKind: "artifact_status",
          target: "factory-artifact:delivery-summary",
          expectedValue: "completed"
        }
      ]
    }
  ];
}

function getFactoryPhaseCriteria(
  completionContract: FactoryCompletionContract,
  phaseId: string
) {
  const phase = completionContract.phases.find((candidate) => candidate.phaseId === phaseId);

  return {
    completionCriteria:
      phase?.completionCriteria.map((criterion) => criterion.description) ?? [],
    verificationCriteria:
      phase?.verificationCriteria.map((criterion) => criterion.description) ?? []
  };
}

function summarizeFactoryCompletionContract(
  completionContract: FactoryCompletionContract
) {
  const lines = [
    `Definition of done: ${completionContract.definitionOfDone.summary}`,
    "",
    "Completion criteria:",
    ...completionContract.definitionOfDone.completionCriteria.map(
      (criterion) => `- ${criterion.description}`
    ),
    "",
    "Verification criteria:",
    ...completionContract.definitionOfDone.verificationCriteria.map(
      (criterion) => `- ${criterion.description}`
    ),
    "",
    ...completionContract.phases.flatMap((phase) => [
      `${phase.name} completion criteria:`,
      ...phase.completionCriteria.map((criterion) => `- ${criterion.description}`),
      `${phase.name} verification criteria:`,
      ...phase.verificationCriteria.map((criterion) => `- ${criterion.description}`),
      ""
    ])
  ];

  return lines.join("\n").trim();
}

function createFactoryTask(options: {
  id: string;
  instruction: string;
  expectedOutcome: string;
  requiredSpecialistAgentTypeId?: "frontend_dev" | "backend_dev" | "repo_tools_dev" | null;
  toolRequest?: RepoToolRequest | null;
}) {
  const validationGates: ValidationGate[] = [
    {
      id: `${options.id}-expected-outcome`,
      description: `Execution evidence includes "${options.expectedOutcome}"`,
      kind: "evidence_includes",
      expectedValue: options.expectedOutcome
    }
  ];

  return {
    id: options.id,
    instruction: options.instruction,
    expectedOutcome: options.expectedOutcome,
    toolRequest: options.toolRequest ?? null,
    requiredSpecialistAgentTypeId: options.requiredSpecialistAgentTypeId ?? null,
    validationGates
  };
}

function buildFactoryProductionReadinessToolRequest(): RepoToolRequest {
  const script = [
    "const fs=require('node:fs');",
    "const cp=require('node:child_process');",
    "const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));",
    "const scripts=pkg.scripts??{};",
    "const pm=fs.existsSync('pnpm-lock.yaml')?'pnpm':fs.existsSync('yarn.lock')?'yarn':'npm';",
    "const run=(name)=>{const args=pm==='npm'?['run',name]:[name];const result=cp.spawnSync(pm,args,{stdio:'inherit'});if((result.status??1)!==0)process.exit(result.status??1);};",
    "if(!scripts.build){console.error('Missing required build script for production readiness gate.');process.exit(1);}",
    "const checks=['typecheck','lint','test','build'].filter((name)=>Boolean(scripts[name]));",
    "const extraChecks=checks.filter((name)=>name!=='build');",
    "if(extraChecks.length===0){console.error('Production readiness gate requires at least one verification script among typecheck, lint, or test.');process.exit(1);}",
    "for(const name of checks)run(name);",
    "console.log('Production readiness gate passed.');"
  ].join("");

  return {
    toolName: "run_terminal_command",
    input: {
      commandLine: `node -e ${JSON.stringify(script)}`,
      category: "ci",
      timeoutMs: 300000
    }
  };
}

function buildFactoryArtifacts(
  factory: FactoryRunState,
  input: {
    phaseExecution: PhaseExecutionState | null;
    status: AgentRunStatus | null;
    updatedAt: string;
    deliverySummary: string | null;
  }
): FactoryArtifact[] {
  const bootstrapCompleted =
    hasTaskCompleted(input.phaseExecution, "task-repository-bootstrap") ||
    hasPhaseCompleted(input.phaseExecution, "factory-bootstrap");
  const deliverySummaryCompleted =
    Boolean(factory.deliverySummary?.trim()) ||
    hasTaskCompleted(input.phaseExecution, "task-delivery-summary") ||
    (input.status === "completed" && Boolean(input.deliverySummary?.trim()));
  const repositorySummary = factory.repository.url
    ? `Repository target ${formatRepositoryLabel(factory.repository.owner, factory.repository.name)} is attached.`
    : `Repository target ${formatRepositoryLabel(factory.repository.owner, factory.repository.name)} is staged in the local factory workspace.`;

  return [
    {
      id: "factory-artifact:repository",
      kind: "repository",
      title: "Repository target",
      summary: repositorySummary,
      status: bootstrapCompleted ? "completed" : "active",
      url: factory.repository.url,
      path: factory.repository.localPath,
      provider: factory.repository.provider,
      updatedAt: input.updatedAt
    },
    {
      id: "factory-artifact:bootstrap-plan",
      kind: "bootstrap_plan",
      title: "Bootstrap plan",
      summary: `Bootstrap ${factory.stack.label} for ${factory.appName}.`,
      status: resolveBootstrapArtifactStatus(factory.currentStage, bootstrapCompleted),
      url: null,
      path: factory.repository.localPath,
      provider: null,
      updatedAt: input.updatedAt
    },
    {
      id: "factory-artifact:delivery-summary",
      kind: "delivery_summary",
      title: "Delivery summary",
      summary:
        input.deliverySummary?.trim() ||
        `Summarize the shipped factory workspace for ${factory.appName}.`,
      status:
        deliverySummaryCompleted
          ? "completed"
          : factory.currentStage === "delivery"
            ? "active"
            : "planned",
      url: null,
      path: null,
      provider: null,
      updatedAt: input.updatedAt
    }
  ];
}

function resolveBootstrapArtifactStatus(
  currentStage: FactoryStageId,
  bootstrapCompleted: boolean
): FactoryArtifactStatus {
  if (bootstrapCompleted) {
    return "completed";
  }

  if (currentStage === "bootstrap") {
    return "active";
  }

  if (currentStage === "implementation" || currentStage === "delivery") {
    return "ready";
  }

  return "planned";
}

function deriveFactoryStage(
  phaseExecution: PhaseExecutionState | null | undefined,
  fallback: FactoryStageId
) {
  if (!phaseExecution) {
    return fallback;
  }

  const currentPhaseId = phaseExecution.current.phaseId;

  if (currentPhaseId && isFactoryPhaseStageKey(currentPhaseId)) {
    return FACTORY_PHASE_STAGE_IDS[currentPhaseId];
  }

  const nextPhase = phaseExecution.phases.find((phase) => phase.status !== "completed");

  if (nextPhase && isFactoryPhaseStageKey(nextPhase.id)) {
    return FACTORY_PHASE_STAGE_IDS[nextPhase.id];
  }

  return "delivery";
}

function hasPhaseCompleted(
  phaseExecution: PhaseExecutionState | null | undefined,
  phaseId: string
) {
  return Boolean(
    phaseExecution?.phases.find((phase) => phase.id === phaseId && phase.status === "completed")
  );
}

function hasTaskCompleted(
  phaseExecution: PhaseExecutionState | null | undefined,
  taskId: string
) {
  if (!phaseExecution) {
    return false;
  }

  return phaseExecution.phases.some((phase) =>
    phase.userStories.some((story) =>
      story.tasks.some((task) => task.id === taskId && task.status === "completed")
    )
  );
}

function resolveFactoryDeliverySummary(input: {
  phaseExecution: PhaseExecutionState | null;
  status: AgentRunStatus | null;
  resultSummary: string | null;
  rollingSummary: RollingSummary | null;
  fallback: string | null;
}) {
  const deliveryTaskSummary = findFactoryTaskSummary(input.phaseExecution, "task-delivery-summary");

  return (
    deliveryTaskSummary ||
    (input.status === "completed" ? input.resultSummary?.trim() || null : null) ||
    (input.status === "completed" ? input.rollingSummary?.text?.trim() || null : null) ||
    input.fallback
  );
}

function findFactoryTaskSummary(
  phaseExecution: PhaseExecutionState | null,
  taskId: string
) {
  if (!phaseExecution) {
    return null;
  }

  for (const phase of phaseExecution.phases) {
    for (const story of phase.userStories) {
      const task = story.tasks.find((candidate) => candidate.id === taskId);

      if (task?.result?.summary?.trim()) {
        return task.result.summary.trim();
      }

      if (task?.result?.responseText?.trim()) {
        return task.result.responseText.trim();
      }
    }
  }

  return null;
}

function mergeProjectLinks(
  existing: RunProjectLinkInput[] | null | undefined,
  additions: RunProjectLinkInput[]
) {
  const merged = [...(Array.isArray(existing) ? existing : []), ...additions];
  const seen = new Set<string>();

  return merged.filter((link) => {
    if (!link?.url?.trim()) {
      return false;
    }

    const key = `${link.kind}:${link.url.trim()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergeRelevantFiles(
  existing: RunContextInput["relevantFiles"],
  additions: RunContextInput["relevantFiles"]
) {
  const merged = [...(existing ?? []), ...additions];
  const seen = new Set<string>();

  return merged.filter((file) => {
    const key = file.path.trim();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function findProjectLink(
  links: RunProjectInput["links"],
  kind: RunProjectLinkInput["kind"]
) {
  return (Array.isArray(links) ? links : []).find((link) => link.kind === kind && link.url?.trim()) ?? null;
}

function normalizeFactoryStageId(value: string | null | undefined): FactoryStageId {
  return value === "bootstrap" ||
    value === "implementation" ||
    value === "delivery"
    ? value
    : "intake";
}

function normalizeFactoryExpansionDecisions(
  value: FactoryExpansionDecision[] | null | undefined
): FactoryExpansionDecision[] {
  return Array.isArray(value)
    ? value
        .filter(
          (decision) =>
            decision &&
            typeof decision.stageId === "string" &&
            typeof decision.phaseId === "string" &&
            typeof decision.decidedAt === "string"
        )
        .map((decision) => ({
          id:
            decision.id?.trim() ||
            `factory-expansion:${decision.stageId}:${decision.outcome}:${decision.decidedAt}`,
          stageId: normalizeFactoryStageId(decision.stageId),
          phaseId: decision.phaseId.trim(),
          outcome:
            decision.outcome === "expanded" || decision.outcome === "complete"
              ? decision.outcome
              : "no_change",
          summary: decision.summary?.trim() || "Factory expansion decision recorded.",
          rationale: decision.rationale?.trim() || "Factory expansion decision recorded.",
          missingCompletionCriterionIds: uniqueStrings(decision.missingCompletionCriterionIds ?? []),
          missingVerificationCriterionIds: uniqueStrings(decision.missingVerificationCriterionIds ?? []),
          addedBacklogItemIds: uniqueStrings(decision.addedBacklogItemIds ?? []),
          decidedAt: decision.decidedAt.trim()
        }))
    : [];
}

function normalizeFactoryArtifactKind(value: string): FactoryArtifact["kind"] {
  return value === "repository" ||
    value === "bootstrap_plan" ||
    value === "deployment_handoff" ||
    value === "delivery_summary"
    ? value
    : "delivery_summary";
}

function normalizeFactoryArtifactStatus(value: string): FactoryArtifactStatus {
  return value === "planned" ||
    value === "active" ||
    value === "ready" ||
    value === "completed"
    ? value
    : "planned";
}

function humanizeFactoryArtifactKind(value: string) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function formatRepositoryLabel(owner: string | null | undefined, name: string) {
  return owner?.trim() ? `${owner.trim()}/${name}` : name;
}

function isFactoryPhaseStageKey(value: string): value is keyof typeof FACTORY_PHASE_STAGE_IDS {
  return value in FACTORY_PHASE_STAGE_IDS;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "factory-app"
  );
}
