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
  SubmitTaskInput,
  ValidationGate
} from "./types";
import {
  buildFactoryImplementationScopeCriteria,
  buildInitialFactoryStagePlans,
  normalizeFactoryStagePlans,
  syncFactoryStagePlans
} from "./factoryBacklog";
import { syncFactoryDelegationState } from "./factoryDelegation";

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
    : null;

  if (!appName || !repositoryName || !stackTemplateId || !deploymentProvider) {
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
    deployment: {
      provider: deploymentProvider,
      projectName: value.deployment.projectName?.trim()
        ? value.deployment.projectName.trim()
        : null,
      environment: value.deployment.environment?.trim()
        ? value.deployment.environment.trim()
        : null,
      url: value.deployment.url?.trim() ? value.deployment.url.trim() : null
    }
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
  const deploymentUrl =
    options.deploymentUrl?.trim() ||
    normalized.deployment.url?.trim() ||
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
    provider: normalized.deployment.provider,
    projectName: normalized.deployment.projectName ?? null,
    environment: normalized.deployment.environment ?? null,
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
    stagePlans,
    expansionDecisions: [],
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
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
        id: "factory-artifact:deployment-handoff",
        kind: "deployment_handoff",
        title: "Deployment handoff",
        summary: `Prepare the ${normalized.deployment.provider} handoff for ${normalized.appName}.`,
        status: "planned",
        url: deploymentUrl,
        path: null,
        provider: normalized.deployment.provider,
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

  return {
    ...factory,
    ...syncFactoryDelegationState({
      factory,
      phaseExecution: options.phaseExecution ?? null,
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
    stagePlans,
    expansionDecisions,
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
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

  return {
    ...factory,
    ...syncFactoryDelegationState({
      factory,
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
  const deliverySummary =
    options.resultSummary?.trim() ||
    (options.status === "completed" ? options.rollingSummary?.text?.trim() || null : null) ||
    normalized.deliverySummary;
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
    stagePlans,
    ownershipPlans: [],
    dependencyGraphs: [],
    delegationBriefs: [],
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

  return {
    ...nextFactory,
    ...syncFactoryDelegationState({
      factory: nextFactory,
      phaseExecution: options.phaseExecution ?? null,
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
      provider: normalizedFactory.deployment.provider,
      projectName: normalizedFactory.deployment.projectName ?? null,
      environment: normalizedFactory.deployment.environment ?? null
    }
  });
  const projectLinks = mergeProjectLinks(
    options.input.project?.links,
    normalizedFactory.deployment.url?.trim()
      ? [
          {
            kind: "deployment",
            url: normalizedFactory.deployment.url.trim(),
            title: `${normalizedFactory.appName} deployment`,
            provider: normalizedFactory.deployment.provider,
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
      completionContract
    ),
    phaseExecution: buildFactoryPhaseExecution(normalizedFactory, completionContract),
    factory: normalizedFactory
  };
}

function buildFactoryRunContext(
  base: SubmitTaskInput["context"],
  factory: FactoryRunInput,
  completionContract: FactoryCompletionContract
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
      `Use the selected stack template: ${stack.label}.`,
      `Repository target: ${formatRepositoryLabel(factory.repository.owner ?? null, factory.repository.name)}.`,
      `Deployment target: ${factory.deployment.provider}.`
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
        id: "factory-stack-summary",
        kind: "spec",
        title: "Factory stack summary",
        content: [
          `Template: ${stack.label}`,
          `Frontend: ${stack.frontend}`,
          `Backend: ${stack.backend}`,
          `Data: ${stack.data}`,
          `Deployment: ${stack.deployment}`
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
          `Repository: ${formatRepositoryLabel(factory.repository.owner ?? null, factory.repository.name)}`,
          `Visibility: ${factory.repository.visibility ?? DEFAULT_REPOSITORY_VISIBILITY}`,
          `Base branch: ${factory.repository.baseBranch ?? DEFAULT_REPOSITORY_BASE_BRANCH}`,
          `Deployment provider: ${factory.deployment.provider}`,
          factory.deployment.projectName?.trim()
            ? `Deployment project: ${factory.deployment.projectName.trim()}`
            : null,
          factory.deployment.environment?.trim()
            ? `Deployment environment: ${factory.deployment.environment.trim()}`
            : null
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
  completionContract: FactoryCompletionContract
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
        approvalGate: {
          kind: "architecture",
          title: "Architecture bootstrap review",
          instructions:
            "Review the bootstrap plan and repository foundation before implementation starts."
        },
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
                instruction: `Inside the connected runtime folder, scaffold the initial repository foundation for ${factory.appName}. Create the top-level files, configuration, starter structure, and setup docs needed for ${stack.label}. Reuse README.md and shipyard.factory.json when helpful. When complete, explicitly say "Repository foundation scaffolded."`,
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
        approvalGate: {
          kind: "implementation",
          title: "Implementation review",
          instructions:
            "Review the bootstrap output before the implementation stories begin."
        },
        userStories: buildImplementationStories(factory)
      },
      {
        id: "factory-delivery",
        name: "Delivery",
        description: `Prepare the delivery handoff for ${factory.appName}.`,
        completionCriteria: deliveryCriteria.completionCriteria,
        verificationCriteria: deliveryCriteria.verificationCriteria,
        approvalGate: {
          kind: "deployment",
          title: "Delivery review",
          instructions:
            "Review the implementation output before the delivery handoff is finalized."
        },
        userStories: [
          {
            id: "story-delivery-handoff",
            title: "Prepare the handoff",
            description: `Summarize the delivery state for ${factory.appName}.`,
            acceptanceCriteria: [
              "Deployment handoff prepared.",
              "Delivery summary prepared."
            ],
            preferredSpecialistAgentTypeId: "repo_tools_dev",
            tasks: [
              createFactoryTask({
                id: "task-deployment-handoff",
                instruction: `Prepare the deploy handoff for ${factory.appName} targeting ${factory.deployment.provider}. Summarize environment variables, manual setup steps, release risks, and the next operator review needed. When complete, explicitly say "Deployment handoff prepared."`,
                expectedOutcome: "Deployment handoff prepared.",
                requiredSpecialistAgentTypeId: "repo_tools_dev"
              }),
              createFactoryTask({
                id: "task-delivery-summary",
                instruction: `Create the final delivery summary for ${factory.appName}. Include what shipped, the repository target ${formatRepositoryLabel(factory.repository.owner ?? null, factory.repository.name)}, the deployment target ${factory.deployment.provider}, and the next operator action. When complete, explicitly say "Delivery summary prepared."`,
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
          title: "Build the API and data flow",
          description: `Create the Express and data foundation for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-api-flow",
              instruction: `Implement the Express API, shared contracts, and the first end-to-end data flow for ${factory.appName}. Connect the frontend shell to the API with clear developer setup notes. When complete, explicitly say "Core product flow implemented."`,
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
          title: "Build the server and data flow",
          description: `Create the Railway-backed data flow for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-railway-data-flow",
              instruction: `Implement the first server and database flow for ${factory.appName} using the Railway Postgres target. Add the data model, the first interactive flow, and setup notes for local and hosted environments. When complete, explicitly say "Core product flow implemented."`,
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
          title: "Build the Supabase-backed flow",
          description: `Create the first Supabase-backed product flow for ${factory.appName}.`,
          acceptanceCriteria: ["Core product flow implemented."],
          preferredSpecialistAgentTypeId: "backend_dev" as const,
          tasks: [
            createFactoryTask({
              id: "task-supabase-flow",
              instruction: `Implement the first end-to-end product flow for ${factory.appName} using Supabase. Add the initial data model, auth or session handling when appropriate, and the first interactive workflow. When complete, explicitly say "Core product flow implemented."`,
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
    summary: `${appSpec.appName} is complete when ${repositoryLabel} contains a verified first delivery slice on ${appSpec.stack.label} and the ${appSpec.deployment.provider} handoff is ready for operator review.`,
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
        description: "Deployment handoff and delivery summary are prepared for operator review."
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
          id: "factory-delivery:deployment-handoff",
          description: "Deployment handoff prepared."
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
          id: "factory-delivery:handoff-evidence",
          description: 'Execution evidence includes "Deployment handoff prepared."',
          evidenceKind: "task_evidence",
          target: "task-deployment-handoff",
          expectedValue: "Deployment handoff prepared."
        },
        {
          id: "factory-delivery:summary-evidence",
          description: 'Execution evidence includes "Delivery summary prepared."',
          evidenceKind: "task_evidence",
          target: "task-delivery-summary",
          expectedValue: "Delivery summary prepared."
        },
        {
          id: "factory-delivery:handoff-artifact",
          description: "Deployment handoff artifact is marked completed.",
          evidenceKind: "artifact_status",
          target: "factory-artifact:deployment-handoff",
          expectedValue: "completed"
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
    requiredSpecialistAgentTypeId: options.requiredSpecialistAgentTypeId ?? null,
    validationGates
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
  const bootstrapCompleted = hasPhaseCompleted(input.phaseExecution, "factory-bootstrap");
  const deliveryCompleted = hasPhaseCompleted(input.phaseExecution, "factory-delivery");
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
      id: "factory-artifact:deployment-handoff",
      kind: "deployment_handoff",
      title: "Deployment handoff",
      summary: `Prepare the ${factory.deployment.provider} handoff for ${factory.appName}.`,
      status:
        input.status === "completed" || deliveryCompleted
          ? "completed"
          : factory.currentStage === "delivery"
            ? "active"
            : "planned",
      url: factory.deployment.url,
      path: null,
      provider: factory.deployment.provider,
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
        input.status === "completed" && input.deliverySummary
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
