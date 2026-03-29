import type {
  FactoryAppSpec,
  FactoryBacklogItem,
  FactoryBacklogItemSource,
  FactoryBacklogItemStatus,
  FactoryCompletionContract,
  FactoryCompletionCriterion,
  FactoryPhaseContract,
  FactoryStageId,
  FactoryStagePlan,
  FactoryStagePlanStatus,
  FactoryVerificationCriterion,
  PhaseExecutionState,
  SpecialistAgentTypeId,
  Task,
  UserStory,
  ValidationGate
} from "./types";

const FACTORY_PHASE_IDS = {
  intake: "factory-intake",
  bootstrap: "factory-bootstrap",
  implementation: "factory-implementation",
  delivery: "factory-delivery"
} as const satisfies Record<FactoryStageId, string>;

type FactoryScopeSignal = {
  id: string;
  matches: string[];
  title: string;
  description: string;
  completionDescription: string;
  rationale: string;
  specialistAgentTypeId: SpecialistAgentTypeId;
  instruction: (appSpec: FactoryAppSpec) => string;
};

const FACTORY_SCOPE_SIGNALS: FactoryScopeSignal[] = [
  {
    id: "onboarding-workflow",
    matches: ["onboarding", "signup", "sign-up", "registration"],
    title: "Implement onboarding workflow",
    description: "Expand the product beyond the base flow with the onboarding workflow requested in scope.",
    completionDescription: "Onboarding workflow implemented.",
    rationale: "The product brief references onboarding-specific behavior that extends the fixed first slice.",
    specialistAgentTypeId: "backend_dev",
    instruction: (appSpec) =>
      `Extend ${appSpec.appName} with the onboarding workflow called for in the product brief. Add the application states, server behavior, and user journey steps needed so onboarding is part of the shipped slice instead of deferred scope. When complete, explicitly say "Onboarding workflow implemented."`
  },
  {
    id: "operations-workspace",
    matches: ["operations", "ops", "portal", "workspace"],
    title: "Implement operations workspace",
    description: "Add the operator-facing workspace implied by the product brief.",
    completionDescription: "Operations workspace implemented.",
    rationale: "The product brief calls for an operations-facing portal or workspace that goes beyond the shell.",
    specialistAgentTypeId: "frontend_dev",
    instruction: (appSpec) =>
      `Extend ${appSpec.appName} beyond the base shell by implementing the operations workspace described in the product brief. Add the operator-facing routes, screens, and state transitions needed so the workspace is usable as part of the delivered slice. When complete, explicitly say "Operations workspace implemented."`
  },
  {
    id: "reporting-surface",
    matches: ["report", "reporting", "analytics", "dashboard", "insights"],
    title: "Implement reporting surface",
    description: "Add the reporting or analytics surface requested in scope.",
    completionDescription: "Reporting surface implemented.",
    rationale: "The product brief names reporting-oriented functionality that is not covered by the fixed seed backlog.",
    specialistAgentTypeId: "frontend_dev",
    instruction: (appSpec) =>
      `Implement the reporting surface requested for ${appSpec.appName}. Add the views, summaries, and supporting interactions needed so reporting is part of the shipped application scope. When complete, explicitly say "Reporting surface implemented."`
  },
  {
    id: "approval-workflow",
    matches: ["approval", "review", "approve"],
    title: "Implement approval workflow",
    description: "Add the approval or review workflow described in the product brief.",
    completionDescription: "Approval workflow implemented.",
    rationale: "The product brief includes approval or review behavior that needs additional implementation work.",
    specialistAgentTypeId: "backend_dev",
    instruction: (appSpec) =>
      `Implement the approval workflow requested for ${appSpec.appName}. Add the state transitions, persistence, and UI coordination needed so approvals are part of the shipped product flow. When complete, explicitly say "Approval workflow implemented."`
  },
  {
    id: "search-and-filter",
    matches: ["search", "filter", "find"],
    title: "Implement search and filter flow",
    description: "Add the search and filtering behavior referenced in scope.",
    completionDescription: "Search and filter flow implemented.",
    rationale: "The product brief references search or filtering capability that needs explicit implementation coverage.",
    specialistAgentTypeId: "frontend_dev",
    instruction: (appSpec) =>
      `Implement the search and filtering flow requested for ${appSpec.appName}. Add the UI controls, query behavior, and result states needed so users can search and filter as part of the shipped slice. When complete, explicitly say "Search and filter flow implemented."`
  },
  {
    id: "import-flow",
    matches: ["import", "upload", "ingest", "csv"],
    title: "Implement import flow",
    description: "Add the import or upload workflow requested in scope.",
    completionDescription: "Import flow implemented.",
    rationale: "The product brief includes import or upload behavior that extends beyond the fixed first slice.",
    specialistAgentTypeId: "backend_dev",
    instruction: (appSpec) =>
      `Implement the import flow requested for ${appSpec.appName}. Add the upload or ingestion behavior, validation, and resulting application state needed so import is part of the shipped slice. When complete, explicitly say "Import flow implemented."`
  }
];

export function buildFactoryImplementationScopeCriteria(
  appSpec: FactoryAppSpec
): Pick<FactoryPhaseContract, "completionCriteria" | "verificationCriteria"> {
  const scopeText = `${appSpec.appName}\n${appSpec.productBrief}`.toLowerCase();
  const matchedSignals = FACTORY_SCOPE_SIGNALS.filter((signal) =>
    signal.matches.some((match) => scopeText.includes(match))
  );

  return {
    completionCriteria: matchedSignals.map((signal) => ({
      id: `factory-implementation:scope:${signal.id}`,
      description: signal.completionDescription
    })),
    verificationCriteria: matchedSignals.map((signal) => ({
      id: `factory-implementation:scope:${signal.id}:backlog`,
      description: `Factory backlog evidence confirms ${signal.completionDescription.toLowerCase()}`,
      evidenceKind: "backlog_item_status",
      target: `factory-implementation:scope:${signal.id}`,
      expectedValue: "completed"
    }))
  };
}

export function buildInitialFactoryStagePlans(options: {
  appSpec: FactoryAppSpec;
  completionContract: FactoryCompletionContract;
  createdAt: string;
}): FactoryStagePlan[] {
  return [
    {
      stageId: "intake",
      phaseId: FACTORY_PHASE_IDS.intake,
      title: "Intake stage plan",
      summary: `Capture the build brief and lock the scoped delivery target for ${options.appSpec.appName}.`,
      status: "planned",
      backlog: [
        createSeedBacklogItem({
          id: "factory-backlog:intake:product-brief",
          stageId: "intake",
          title: "Capture product brief",
          description: `Translate the request for ${options.appSpec.appName} into a scoped build brief.`,
          instruction: `Translate the request into a concise product brief for ${options.appSpec.appName}. Cover users, primary flows, core entities, and key constraints. When the brief is ready, explicitly say "Product brief captured."`,
          expectedOutcome: "Product brief captured.",
          storyId: "story-product-brief",
          taskId: "task-product-brief",
          acceptanceCriteria: ["Product brief captured."],
          completionCriterionIds: ["factory-intake:product-brief"],
          verificationCriterionIds: ["factory-intake:product-brief-evidence"],
          rationale: "Seed item from the fixed intake backlog.",
          createdAt: options.createdAt
        }),
        createSeedBacklogItem({
          id: "factory-backlog:intake:scope-alignment",
          stageId: "intake",
          title: "Align factory scope",
          description: `Lock the first deliverable slice for ${options.appSpec.appName}.`,
          instruction: `Define the initial factory scope for ${options.appSpec.appName} using ${options.appSpec.stack.label}. Call out assumptions, the first implementation slice, and what must be true before delivery. When done, explicitly say "Factory scope aligned."`,
          expectedOutcome: "Factory scope aligned.",
          storyId: "story-product-brief",
          taskId: "task-factory-scope",
          acceptanceCriteria: ["Factory scope aligned."],
          completionCriterionIds: ["factory-intake:scope-aligned"],
          verificationCriterionIds: ["factory-intake:scope-evidence"],
          rationale: "Seed item from the fixed intake backlog.",
          createdAt: options.createdAt
        })
      ],
      lastExpandedAt: null,
      updatedAt: options.createdAt
    },
    {
      stageId: "bootstrap",
      phaseId: FACTORY_PHASE_IDS.bootstrap,
      title: "Bootstrap stage plan",
      summary: `Scaffold the repository foundation for ${options.appSpec.appName}.`,
      status: "planned",
      backlog: [
        createSeedBacklogItem({
          id: "factory-backlog:bootstrap:repository-foundation",
          stageId: "bootstrap",
          title: "Scaffold repository foundation",
          description: `Create the initial repository structure for ${options.appSpec.appName}.`,
          instruction: `Inside the connected runtime folder, scaffold the initial repository foundation for ${options.appSpec.appName}. Create the top-level files, configuration, starter structure, and setup docs needed for ${options.appSpec.stack.label}. Reuse README.md and shipyard.factory.json when helpful. When complete, explicitly say "Repository foundation scaffolded."`,
          expectedOutcome: "Repository foundation scaffolded.",
          storyId: "story-repository-bootstrap",
          taskId: "task-repository-bootstrap",
          acceptanceCriteria: [
            "Repository foundation scaffolded.",
            "Bootstrap plan aligned to the selected stack and factory workspace."
          ],
          completionCriterionIds: [
            "factory-bootstrap:repository-foundation",
            "factory-bootstrap:stack-alignment"
          ],
          verificationCriterionIds: [
            "factory-bootstrap:repository-evidence",
            "factory-bootstrap:repository-artifact",
            "factory-bootstrap:plan-artifact"
          ],
          preferredSpecialistAgentTypeId: "repo_tools_dev",
          requiredSpecialistAgentTypeId: "repo_tools_dev",
          rationale: "Seed item from the fixed bootstrap backlog.",
          createdAt: options.createdAt
        })
      ],
      lastExpandedAt: null,
      updatedAt: options.createdAt
    },
    {
      stageId: "implementation",
      phaseId: FACTORY_PHASE_IDS.implementation,
      title: "Implementation stage plan",
      summary: `Start with the seeded product slice for ${options.appSpec.appName} and expand if the completion contract still has uncovered implementation scope.`,
      status: "planned",
      backlog: buildSeedImplementationBacklog(options.appSpec, options.createdAt),
      lastExpandedAt: null,
      updatedAt: options.createdAt
    },
    {
      stageId: "delivery",
      phaseId: FACTORY_PHASE_IDS.delivery,
      title: "Delivery stage plan",
      summary: `Verify the application build and prepare the delivery summary for ${options.appSpec.appName}.`,
      status: "planned",
      backlog: [
        createSeedBacklogItem({
          id: "factory-backlog:delivery:production-readiness",
          stageId: "delivery",
          title: "Run the production readiness gate",
          description: `Verify ${options.appSpec.appName} is strong enough for local delivery review.`,
          instruction: `Run the production readiness gate for ${options.appSpec.appName}. Require a build script plus at least one of typecheck, lint, or test. If any required checks are missing or failing, fail clearly. When complete, explicitly say "Production readiness gate passed."`,
          expectedOutcome: "Production readiness gate passed.",
          storyId: "story-delivery-handoff",
          taskId: "task-production-readiness",
          acceptanceCriteria: ["Production readiness gate passed."],
          completionCriterionIds: ["factory-delivery:production-readiness"],
          verificationCriterionIds: ["factory-delivery:production-readiness-evidence"],
          preferredSpecialistAgentTypeId: "repo_tools_dev",
          requiredSpecialistAgentTypeId: "repo_tools_dev",
          rationale: "Seed item from the fixed delivery backlog.",
          createdAt: options.createdAt
        }),
        createSeedBacklogItem({
          id: "factory-backlog:delivery:delivery-summary",
          stageId: "delivery",
          title: "Prepare delivery summary",
          description: `Summarize what shipped for ${options.appSpec.appName}.`,
          instruction: `Create the final delivery summary for ${options.appSpec.appName}. Include what shipped, the repository target ${formatRepositoryLabel(options.appSpec.repository.owner, options.appSpec.repository.name)}, what remains for manual deployment or hosted integration, and the next operator action. When complete, explicitly say "Delivery summary prepared."`,
          expectedOutcome: "Delivery summary prepared.",
          storyId: "story-delivery-handoff",
          taskId: "task-delivery-summary",
          acceptanceCriteria: ["Delivery summary prepared."],
          completionCriterionIds: ["factory-delivery:delivery-summary"],
          verificationCriterionIds: [
            "factory-delivery:summary-evidence",
            "factory-delivery:summary-artifact"
          ],
          preferredSpecialistAgentTypeId: "repo_tools_dev",
          requiredSpecialistAgentTypeId: "repo_tools_dev",
          rationale: "Seed item from the fixed delivery backlog.",
          createdAt: options.createdAt
        })
      ],
      lastExpandedAt: null,
      updatedAt: options.createdAt
    }
  ];
}

export function normalizeFactoryStagePlans(options: {
  value: FactoryStagePlan[] | null | undefined;
  completionContract: FactoryCompletionContract;
  createdAt: string;
}): FactoryStagePlan[] {
  const initialPlans = buildInitialFactoryStagePlans({
    appSpec: options.completionContract.appSpec,
    completionContract: options.completionContract,
    createdAt: options.createdAt
  });
  const existingPlans = Array.isArray(options.value) ? options.value : [];
  const existingByStageId = new Map(existingPlans.map((plan) => [plan.stageId, plan]));

  return initialPlans.map((initialPlan) => {
    const existingPlan = existingByStageId.get(initialPlan.stageId);
    const existingBacklog = Array.isArray(existingPlan?.backlog) ? existingPlan.backlog : [];
    const existingBacklogById = new Map(existingBacklog.map((item) => [item.id, item]));
    const mergedBacklog = initialPlan.backlog.map((initialItem) =>
      normalizeBacklogItem(existingBacklogById.get(initialItem.id), initialItem, options.createdAt)
    );
    const seenIds = new Set(mergedBacklog.map((item) => item.id));

    for (const item of existingBacklog) {
      if (seenIds.has(item.id)) {
        continue;
      }

      mergedBacklog.push(normalizeBacklogItem(item, null, options.createdAt));
    }

    return {
      stageId: initialPlan.stageId,
      phaseId: initialPlan.phaseId,
      title: existingPlan?.title?.trim() || initialPlan.title,
      summary: existingPlan?.summary?.trim() || initialPlan.summary,
      status: normalizeStagePlanStatus(existingPlan?.status ?? initialPlan.status),
      backlog: mergedBacklog,
      lastExpandedAt:
        typeof existingPlan?.lastExpandedAt === "string" && existingPlan.lastExpandedAt.trim()
          ? existingPlan.lastExpandedAt.trim()
          : null,
      updatedAt:
        typeof existingPlan?.updatedAt === "string" && existingPlan.updatedAt.trim()
          ? existingPlan.updatedAt.trim()
          : initialPlan.updatedAt
    };
  });
}

export function syncFactoryStagePlans(options: {
  stagePlans: FactoryStagePlan[] | null | undefined;
  phaseExecution: PhaseExecutionState | null | undefined;
  completionContract: FactoryCompletionContract;
  updatedAt: string;
}): FactoryStagePlan[] {
  const normalizedPlans = normalizeFactoryStagePlans({
    value: options.stagePlans,
    completionContract: options.completionContract,
    createdAt: options.updatedAt
  });

  return normalizedPlans.map((plan) => {
    const phase = options.phaseExecution?.phases.find((candidate) => candidate.id === plan.phaseId) ?? null;
    const backlog = plan.backlog.map((item) => syncBacklogItem(item, phase, options.updatedAt));

    return {
      ...plan,
      backlog,
      status: deriveStagePlanStatus(plan.status, backlog, phase?.status ?? null),
      updatedAt: options.updatedAt
    };
  });
}

export function createExpansionBacklogItems(options: {
  appSpec: FactoryAppSpec;
  completionCriteria: FactoryCompletionCriterion[];
  verificationCriteria: FactoryVerificationCriterion[];
  completionCriterionIds: string[];
  createdAt: string;
}): FactoryBacklogItem[] {
  const completionCriteriaById = new Map(
    options.completionCriteria.map((criterion) => [criterion.id, criterion])
  );
  const verificationByCriterionId = new Map<string, string[]>();

  for (const criterion of options.verificationCriteria) {
    if (criterion.evidenceKind !== "backlog_item_status") {
      continue;
    }

    const existing = verificationByCriterionId.get(criterion.target) ?? [];
    existing.push(criterion.id);
    verificationByCriterionId.set(criterion.target, existing);
  }

  return options.completionCriterionIds.map((criterionId) => {
    const criterion = completionCriteriaById.get(criterionId);
    const signal = resolveFactoryScopeSignal(criterionId);
    const slug = criterionId.split(":").at(-1) ?? slugify(criterion?.description ?? criterionId);
    const expectedOutcome = criterion?.description ?? humanizeIdentifier(slug);

    return {
      id: `factory-backlog:implementation:${slug}`,
      stageId: "implementation",
      title: signal?.title ?? `Implement ${trimImplementedSuffix(expectedOutcome)}`,
      description:
        signal?.description ??
        `Add the missing implementation scope required for ${options.appSpec.appName}.`,
      instruction:
        signal?.instruction(options.appSpec) ??
        `Extend ${options.appSpec.appName} to satisfy the remaining implementation contract criterion "${expectedOutcome}". Add the missing product behavior needed so this criterion is explicitly satisfied. When complete, explicitly say "${expectedOutcome}"`,
      expectedOutcome,
      storyId: `story-factory-expansion-${slug}`,
      taskId: `task-factory-expansion-${slug}`,
      acceptanceCriteria: [expectedOutcome],
      completionCriterionIds: [criterionId],
      verificationCriterionIds: verificationByCriterionId.get(criterionId) ?? [],
      preferredSpecialistAgentTypeId: signal?.specialistAgentTypeId ?? null,
      requiredSpecialistAgentTypeId: signal?.specialistAgentTypeId ?? null,
      source: "expansion",
      status: "planned",
      rationale:
        signal?.rationale ??
        `The Factory completion contract still lists "${expectedOutcome}" as missing implementation scope.`,
      createdAt: options.createdAt,
      insertedAt: options.createdAt,
      completedAt: null
    };
  });
}

export function createFactoryStoryFromBacklogItem(item: FactoryBacklogItem): UserStory {
  const taskId = item.taskId?.trim() || `${item.id}:task`;
  const storyId = item.storyId?.trim() || `${item.id}:story`;
  const validationGates: ValidationGate[] = [
    {
      id: `${taskId}-expected-outcome`,
      description: `Execution evidence includes "${item.expectedOutcome}"`,
      kind: "evidence_includes",
      expectedValue: item.expectedOutcome
    }
  ];

  const task: Task = {
    id: taskId,
    instruction: item.instruction,
    expectedOutcome: item.expectedOutcome,
    status: "pending",
    toolRequest: null,
    context: {
      objective: item.expectedOutcome,
      constraints: [`Factory backlog rationale: ${item.rationale}`],
      relevantFiles: [],
      externalContext: [
        {
          id: `${item.id}-criterion`,
          kind: "spec",
          title: "Factory backlog criterion",
          content: [
            `Backlog item: ${item.title}`,
            `Description: ${item.description}`,
            `Rationale: ${item.rationale}`
          ].join("\n"),
          source: "factory-backlog",
          format: "markdown"
        }
      ],
      validationTargets: [item.expectedOutcome],
      specialistAgentTypeId:
        item.requiredSpecialistAgentTypeId ??
        item.preferredSpecialistAgentTypeId ??
        null
    },
    validationGates,
    requiredSpecialistAgentTypeId: item.requiredSpecialistAgentTypeId,
    allowedToolNames: null,
    retryCount: 0,
    failureReason: null,
    lastValidationResults: null,
    result: null
  };

  return {
    id: storyId,
    title: item.title,
    description: item.description,
    tasks: [task],
    acceptanceCriteria: item.acceptanceCriteria.length > 0 ? item.acceptanceCriteria : [item.expectedOutcome],
    validationGates: [],
    preferredSpecialistAgentTypeId: item.preferredSpecialistAgentTypeId,
    status: "pending",
    retryCount: 0,
    failureReason: null,
    lastValidationResults: null
  };
}

export function getFactoryPhaseIdForStage(stageId: FactoryStageId) {
  return FACTORY_PHASE_IDS[stageId];
}

function buildSeedImplementationBacklog(appSpec: FactoryAppSpec, createdAt: string): FactoryBacklogItem[] {
  switch (appSpec.stack.templateId) {
    case "react_express_railway":
      return [
        createSeedBacklogItem({
          id: "factory-backlog:implementation:app-shell",
          stageId: "implementation",
          title: "Build the frontend shell",
          description: `Create the React application shell for ${appSpec.appName}.`,
          instruction: `Build the primary React application shell for ${appSpec.appName}. Create the main screens, layout, navigation, and shared UI primitives for the first product slice. When complete, explicitly say "Application shell implemented."`,
          expectedOutcome: "Application shell implemented.",
          storyId: "story-frontend-shell",
          taskId: "task-frontend-shell",
          acceptanceCriteria: ["Application shell implemented."],
          completionCriterionIds: ["factory-implementation:app-shell"],
          verificationCriterionIds: ["factory-implementation:app-shell-evidence"],
          preferredSpecialistAgentTypeId: "frontend_dev",
          requiredSpecialistAgentTypeId: "frontend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        }),
        createSeedBacklogItem({
          id: "factory-backlog:implementation:core-flow",
          stageId: "implementation",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${appSpec.appName}.`,
          instruction: `Implement the first interactive product flow for ${appSpec.appName}. Connect the React shell to local fixtures, lightweight in-repo data adapters, or mock service boundaries so the application works locally without hosted deployment or external database setup. When complete, explicitly say "Core product flow implemented."`,
          expectedOutcome: "Core product flow implemented.",
          storyId: "story-api-flow",
          taskId: "task-api-flow",
          acceptanceCriteria: ["Core product flow implemented."],
          completionCriterionIds: ["factory-implementation:core-flow"],
          verificationCriterionIds: ["factory-implementation:core-flow-evidence"],
          preferredSpecialistAgentTypeId: "backend_dev",
          requiredSpecialistAgentTypeId: "backend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        })
      ];
    case "nextjs_railway_postgres":
      return [
        createSeedBacklogItem({
          id: "factory-backlog:implementation:app-shell",
          stageId: "implementation",
          title: "Build the Next.js app shell",
          description: `Create the Next.js shell for ${appSpec.appName}.`,
          instruction: `Build the primary Next.js application shell for ${appSpec.appName}. Create the landing experience, the main product route, layout primitives, and shared UI needed for the first slice. When complete, explicitly say "Application shell implemented."`,
          expectedOutcome: "Application shell implemented.",
          storyId: "story-nextjs-shell",
          taskId: "task-nextjs-shell",
          acceptanceCriteria: ["Application shell implemented."],
          completionCriterionIds: ["factory-implementation:app-shell"],
          verificationCriterionIds: ["factory-implementation:app-shell-evidence"],
          preferredSpecialistAgentTypeId: "frontend_dev",
          requiredSpecialistAgentTypeId: "frontend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        }),
        createSeedBacklogItem({
          id: "factory-backlog:implementation:core-flow",
          stageId: "implementation",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${appSpec.appName}.`,
          instruction: `Implement the first interactive product flow for ${appSpec.appName}. Use local fixtures, lightweight in-repo data adapters, or mock server boundaries so the product works locally while leaving Railway and hosted database setup for a later follow-up. When complete, explicitly say "Core product flow implemented."`,
          expectedOutcome: "Core product flow implemented.",
          storyId: "story-railway-data-flow",
          taskId: "task-railway-data-flow",
          acceptanceCriteria: ["Core product flow implemented."],
          completionCriterionIds: ["factory-implementation:core-flow"],
          verificationCriterionIds: ["factory-implementation:core-flow-evidence"],
          preferredSpecialistAgentTypeId: "backend_dev",
          requiredSpecialistAgentTypeId: "backend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        })
      ];
    case "nextjs_supabase_vercel":
    default:
      return [
        createSeedBacklogItem({
          id: "factory-backlog:implementation:app-shell",
          stageId: "implementation",
          title: "Build the Next.js app shell",
          description: `Create the Next.js shell for ${appSpec.appName}.`,
          instruction: `Build the primary Next.js application shell for ${appSpec.appName}. Create the initial routes, layout, shared UI, and the main product entry flow for the first slice. When complete, explicitly say "Application shell implemented."`,
          expectedOutcome: "Application shell implemented.",
          storyId: "story-nextjs-shell",
          taskId: "task-nextjs-shell",
          acceptanceCriteria: ["Application shell implemented."],
          completionCriterionIds: ["factory-implementation:app-shell"],
          verificationCriterionIds: ["factory-implementation:app-shell-evidence"],
          preferredSpecialistAgentTypeId: "frontend_dev",
          requiredSpecialistAgentTypeId: "frontend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        }),
        createSeedBacklogItem({
          id: "factory-backlog:implementation:core-flow",
          stageId: "implementation",
          title: "Build the first interactive product flow",
          description: `Create the first usable product workflow for ${appSpec.appName}.`,
          instruction: `Implement the first interactive product flow for ${appSpec.appName}. Use local fixtures, seeded demo content, or clear adapter seams so the application works locally while leaving Supabase wiring, auth provider setup, and hosted deployment for a later follow-up. When complete, explicitly say "Core product flow implemented."`,
          expectedOutcome: "Core product flow implemented.",
          storyId: "story-supabase-flow",
          taskId: "task-supabase-flow",
          acceptanceCriteria: ["Core product flow implemented."],
          completionCriterionIds: ["factory-implementation:core-flow"],
          verificationCriterionIds: ["factory-implementation:core-flow-evidence"],
          preferredSpecialistAgentTypeId: "backend_dev",
          requiredSpecialistAgentTypeId: "backend_dev",
          rationale: "Seed implementation item from the fixed first slice.",
          createdAt
        })
      ];
  }
}

function createSeedBacklogItem(
  item: Omit<
    FactoryBacklogItem,
    | "source"
    | "status"
    | "insertedAt"
    | "completedAt"
    | "preferredSpecialistAgentTypeId"
    | "requiredSpecialistAgentTypeId"
  > & {
    preferredSpecialistAgentTypeId?: SpecialistAgentTypeId | null;
    requiredSpecialistAgentTypeId?: SpecialistAgentTypeId | null;
  }
): FactoryBacklogItem {
  return {
    ...item,
    preferredSpecialistAgentTypeId: item.preferredSpecialistAgentTypeId ?? null,
    requiredSpecialistAgentTypeId: item.requiredSpecialistAgentTypeId ?? null,
    source: "seed",
    status: "planned",
    insertedAt: item.createdAt,
    completedAt: null
  };
}

function normalizeBacklogItem(
  value: FactoryBacklogItem | null | undefined,
  fallback: FactoryBacklogItem | null,
  createdAt: string
): FactoryBacklogItem {
  const source = normalizeBacklogItemSource(value?.source ?? fallback?.source ?? "seed");
  const expectedOutcome =
    value?.expectedOutcome?.trim() ||
    fallback?.expectedOutcome ||
    "Factory backlog item completed.";

  return {
    id: value?.id?.trim() || fallback?.id || `factory-backlog:${slugify(expectedOutcome)}`,
    stageId: normalizeFactoryStageId(value?.stageId ?? fallback?.stageId ?? "implementation"),
    title: value?.title?.trim() || fallback?.title || humanizeIdentifier(expectedOutcome),
    description: value?.description?.trim() || fallback?.description || expectedOutcome,
    instruction: value?.instruction?.trim() || fallback?.instruction || expectedOutcome,
    expectedOutcome,
    storyId: value?.storyId?.trim() || fallback?.storyId || null,
    taskId: value?.taskId?.trim() || fallback?.taskId || null,
    acceptanceCriteria: normalizeStringArray(
      value?.acceptanceCriteria ?? fallback?.acceptanceCriteria ?? [expectedOutcome]
    ),
    completionCriterionIds: normalizeStringArray(
      value?.completionCriterionIds ?? fallback?.completionCriterionIds ?? []
    ),
    verificationCriterionIds: normalizeStringArray(
      value?.verificationCriterionIds ?? fallback?.verificationCriterionIds ?? []
    ),
    preferredSpecialistAgentTypeId:
      value?.preferredSpecialistAgentTypeId ??
      fallback?.preferredSpecialistAgentTypeId ??
      null,
    requiredSpecialistAgentTypeId:
      value?.requiredSpecialistAgentTypeId ??
      fallback?.requiredSpecialistAgentTypeId ??
      null,
    source,
    status: normalizeBacklogItemStatus(value?.status ?? fallback?.status ?? "planned"),
    rationale: value?.rationale?.trim() || fallback?.rationale || "Factory backlog item.",
    createdAt: value?.createdAt?.trim() || fallback?.createdAt || createdAt,
    insertedAt:
      value?.insertedAt?.trim() ||
      fallback?.insertedAt ||
      (source === "seed" ? value?.createdAt?.trim() || fallback?.createdAt || createdAt : null),
    completedAt: value?.completedAt?.trim() || fallback?.completedAt || null
  };
}

function syncBacklogItem(
  item: FactoryBacklogItem,
  phase: PhaseExecutionState["phases"][number] | null,
  updatedAt: string
): FactoryBacklogItem {
  if (!phase || !item.taskId) {
    return item;
  }

  const match = findTaskInPhase(phase, item.taskId);

  if (!match) {
    return item;
  }

  let status: FactoryBacklogItemStatus = item.status;

  if (match.task.status === "completed") {
    status = "completed";
  } else if (match.task.status === "failed" || match.story.status === "failed" || phase.status === "failed") {
    status = "failed";
  } else if (
    match.task.status === "running" ||
    match.story.status === "in_progress" ||
    phase.status === "in_progress"
  ) {
    status = "active";
  } else {
    status = "planned";
  }

  return {
    ...item,
    status,
    completedAt:
      status === "completed"
        ? item.completedAt ?? updatedAt
        : null
  };
}

function deriveStagePlanStatus(
  fallback: FactoryStagePlanStatus,
  backlog: FactoryBacklogItem[],
  phaseStatus: string | null
): FactoryStagePlanStatus {
  if (phaseStatus === "failed" || backlog.some((item) => item.status === "failed")) {
    return "failed";
  }

  if (backlog.length > 0 && backlog.every((item) => item.status === "completed")) {
    return "completed";
  }

  if (phaseStatus === "in_progress" || backlog.some((item) => item.status === "active")) {
    return "active";
  }

  return normalizeStagePlanStatus(fallback);
}

function findTaskInPhase(phase: PhaseExecutionState["phases"][number], taskId: string) {
  for (const story of phase.userStories) {
    const task = story.tasks.find((candidate) => candidate.id === taskId);

    if (task) {
      return { story, task };
    }
  }

  return null;
}

function resolveFactoryScopeSignal(criterionId: string) {
  const signalId = criterionId.split(":").at(-1) ?? criterionId;

  return FACTORY_SCOPE_SIGNALS.find((signal) => signal.id === signalId) ?? null;
}

function normalizeStringArray(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeBacklogItemStatus(value: FactoryBacklogItemStatus | string): FactoryBacklogItemStatus {
  return value === "active" || value === "completed" || value === "failed" ? value : "planned";
}

function normalizeBacklogItemSource(value: FactoryBacklogItemSource | string): FactoryBacklogItemSource {
  return value === "expansion" ? "expansion" : "seed";
}

function normalizeStagePlanStatus(value: FactoryStagePlanStatus | string): FactoryStagePlanStatus {
  return value === "active" || value === "completed" || value === "failed" ? value : "planned";
}

function normalizeFactoryStageId(value: FactoryStageId | string): FactoryStageId {
  return value === "intake" ||
    value === "bootstrap" ||
    value === "delivery"
    ? value
    : "implementation";
}

function formatRepositoryLabel(owner: string | null | undefined, name: string) {
  return owner?.trim() ? `${owner.trim()}/${name}` : name;
}

function trimImplementedSuffix(value: string) {
  return value.replace(/\.\s*$/, "").replace(/\s+implemented$/i, "");
}

function humanizeIdentifier(value: string) {
  return value
    .split(/[:_-]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
