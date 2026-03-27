import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFactoryStageExpansion,
  compileFactoryTaskSubmission,
  createFactoryRunState,
  normalizeFactoryRunInput,
  normalizeFactoryRunState,
  normalizePhaseExecutionInput,
  syncFactoryRunState
} from "../index";

test("compileFactoryTaskSubmission builds a typed factory run contract", () => {
  const compiled = compileFactoryTaskSubmission({
    input: {
      instruction: "Build a customer onboarding portal for operations teams.",
      project: {
        id: "shipyard-runtime",
        kind: "live"
      },
      factory: {
        appName: "Ops Portal",
        stackTemplateId: "nextjs_supabase_vercel",
        repository: {
          provider: "github",
          owner: "acme",
          name: "ops-portal",
          visibility: "private",
          baseBranch: "main"
        },
        deployment: {
          provider: "vercel",
          projectName: "ops-portal",
          environment: "production"
        }
      }
    },
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260326"
  });

  assert.equal(compiled.project?.folder?.provider, "runtime");
  assert.equal(
    compiled.project?.folder?.displayPath,
    "/tmp/factory-workspaces/ops-portal-20260326"
  );
  assert.equal(compiled.factory?.appName, "Ops Portal");
  assert.equal(compiled.phaseExecution?.phases.length, 4);
  assert.equal(compiled.phaseExecution?.phases[1]?.approvalGate?.kind, "architecture");
  assert.equal(compiled.phaseExecution?.phases[2]?.approvalGate?.kind, "implementation");
  assert.equal(compiled.phaseExecution?.phases[3]?.approvalGate?.kind, "deployment");
  assert.ok((compiled.phaseExecution?.phases[2]?.completionCriteria?.length ?? 0) > 2);
  assert.deepEqual(compiled.phaseExecution?.phases[0]?.completionCriteria, [
    "Product brief captured.",
    "Factory scope aligned around the first deliverable slice."
  ]);
  assert.ok(
    compiled.phaseExecution?.phases[2]?.verificationCriteria?.some((criterion) =>
      criterion.includes("Core product flow implemented.")
    ) ?? false
  );
  assert.ok(
    compiled.context?.constraints.some((constraint) =>
      constraint.includes("connected runtime folder")
    )
  );
  assert.ok(compiled.context?.relevantFiles.some((file) => file.path === "README.md"));
  assert.ok(
    compiled.context?.externalContext?.some(
      (item) =>
        item.id === "factory-completion-contract" &&
        item.content.includes("Definition of done:")
    )
  );
});

test("createFactoryRunState stores a typed completion contract", () => {
  const factoryInput = normalizeFactoryRunInput({
    appName: "Ops Portal",
    stackTemplateId: "nextjs_supabase_vercel",
    repository: {
      provider: "github",
      owner: "acme",
      name: "ops-portal",
      visibility: "private",
      baseBranch: "main"
    },
    deployment: {
      provider: "vercel",
      projectName: "ops-portal",
      environment: "production"
    }
  });

  assert.ok(factoryInput);

  const state = createFactoryRunState({
    input: factoryInput,
    productBrief: "Build a customer onboarding portal for operations teams.",
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260326"
  });

  assert.equal(state.completionContract.appSpec.appName, "Ops Portal");
  assert.equal(state.completionContract.appSpec.stack.templateId, "nextjs_supabase_vercel");
  assert.equal(state.completionContract.definitionOfDone.completionCriteria.length, 4);
  assert.equal(state.completionContract.phases.length, 4);
  assert.equal(state.stagePlans.length, 4);
  assert.equal(state.ownershipPlans.length, 4);
  assert.equal(state.dependencyGraphs.length, 4);
  assert.ok(state.delegationBriefs.length > 0);
  assert.equal(
    state.stagePlans.find((plan) => plan.stageId === "implementation")?.backlog.length,
    2
  );
  assert.equal(
    state.ownershipPlans.find((plan) => plan.stageId === "implementation")?.storyAssignments[0]
      ?.ownerRole,
    "specialist_dev"
  );
  assert.equal(
    state.ownershipPlans.find((plan) => plan.stageId === "implementation")?.taskAssignments[0]
      ?.ownerRole,
    "execution_subagent"
  );
  assert.deepEqual(
    state.delegationBriefs.find((brief) => brief.entityKind === "task" && brief.entityId === "task-nextjs-shell")
      ?.acceptanceTargetIds,
    ["factory-implementation:app-shell"]
  );
  assert.deepEqual(state.expansionDecisions, []);
  assert.deepEqual(
    state.completionContract.phases.map((phase) => phase.phaseId),
    [
      "factory-intake",
      "factory-bootstrap",
      "factory-implementation",
      "factory-delivery"
    ]
  );
  assert.ok(
    state.completionContract.phases.every(
      (phase) =>
        phase.completionCriteria.length > 0 && phase.verificationCriteria.length > 0
    )
  );
});

test("syncFactoryRunState advances stage and artifact status from phase execution", () => {
  const factoryInput = normalizeFactoryRunInput({
    appName: "Ops Portal",
    stackTemplateId: "nextjs_supabase_vercel",
    repository: {
      provider: "github",
      owner: "acme",
      name: "ops-portal",
      visibility: "private",
      baseBranch: "main"
    },
    deployment: {
      provider: "vercel",
      projectName: "ops-portal",
      environment: "production"
    }
  });

  assert.ok(factoryInput);

  const state = createFactoryRunState({
    input: factoryInput,
    productBrief: "Build a customer onboarding portal for operations teams.",
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260326"
  });
  const phaseExecution = normalizePhaseExecutionInput({
    phases: [
      {
        id: "factory-intake",
        name: "Intake",
        description: "Intake",
        userStories: [
          {
            id: "story-intake",
            title: "Intake",
            description: "Intake",
            acceptanceCriteria: ["done"],
            tasks: [
              {
                id: "task-intake",
                instruction: "Intake",
                expectedOutcome: "done"
              }
            ]
          }
        ]
      },
      {
        id: "factory-bootstrap",
        name: "Bootstrap",
        description: "Bootstrap",
        userStories: [
          {
            id: "story-bootstrap",
            title: "Bootstrap",
            description: "Bootstrap",
            acceptanceCriteria: ["done"],
            tasks: [
              {
                id: "task-bootstrap",
                instruction: "Bootstrap",
                expectedOutcome: "done"
              }
            ]
          }
        ]
      },
      {
        id: "factory-implementation",
        name: "Implementation",
        description: "Implementation",
        userStories: [
          {
            id: "story-implementation",
            title: "Implementation",
            description: "Implementation",
            acceptanceCriteria: ["done"],
            tasks: [
              {
                id: "task-implementation",
                instruction: "Implementation",
                expectedOutcome: "done"
              }
            ]
          }
        ]
      },
      {
        id: "factory-delivery",
        name: "Delivery",
        description: "Delivery",
        userStories: [
          {
            id: "story-delivery",
            title: "Delivery",
            description: "Delivery",
            acceptanceCriteria: ["done"],
            tasks: [
              {
                id: "task-delivery",
                instruction: "Delivery",
                expectedOutcome: "done"
              }
            ]
          }
        ]
      }
    ]
  });

  assert.ok(phaseExecution);

  phaseExecution.phases[0]!.status = "completed";
  phaseExecution.phases[1]!.status = "completed";
  phaseExecution.phases[2]!.status = "in_progress";
  phaseExecution.current = {
    phaseId: "factory-implementation",
    storyId: null,
    taskId: null
  };

  const synced = syncFactoryRunState({
    factory: state,
    phaseExecution,
    project: {
      id: "shipyard-runtime",
      kind: "live",
      links: [
        {
          kind: "repository",
          url: "https://github.com/acme/ops-portal"
        }
      ],
      folder: {
        provider: "runtime",
        displayPath: "/tmp/factory-workspaces/ops-portal-20260326",
        status: "connected"
      }
    },
    status: "running",
    rollingSummary: {
      text: "Implementation is underway.",
      updatedAt: "2026-03-26T18:00:00.000Z",
      source: "result"
    }
  });

  assert.equal(synced?.currentStage, "implementation");
  assert.equal(synced?.repository.url, "https://github.com/acme/ops-portal");
  assert.equal(synced?.completionContract.appSpec.repository.name, "ops-portal");
  assert.equal(synced?.completionContract.phases[2]?.stageId, "implementation");
  assert.equal(
    synced?.artifacts.find((artifact) => artifact.kind === "repository")?.status,
    "completed"
  );
  assert.equal(
    synced?.artifacts.find((artifact) => artifact.kind === "bootstrap_plan")?.status,
    "completed"
  );
  assert.equal(
    synced?.stagePlans.find((plan) => plan.stageId === "implementation")?.status,
    "active"
  );
});

test("applyFactoryStageExpansion adds implementation backlog items for uncovered contract scope", () => {
  const compiled = compileFactoryTaskSubmission({
    input: {
      instruction: "Build a customer onboarding portal for operations teams.",
      project: {
        id: "shipyard-runtime",
        kind: "live"
      },
      factory: {
        appName: "Ops Portal",
        stackTemplateId: "nextjs_supabase_vercel",
        repository: {
          provider: "github",
          owner: "acme",
          name: "ops-portal",
          visibility: "private",
          baseBranch: "main"
        },
        deployment: {
          provider: "vercel",
          projectName: "ops-portal",
          environment: "production"
        }
      }
    },
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260326"
  });

  const factoryInput = normalizeFactoryRunInput(compiled.factory);

  assert.ok(factoryInput);
  assert.ok(compiled.phaseExecution);

  const factoryState = createFactoryRunState({
    input: factoryInput,
    productBrief: compiled.instruction,
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260326"
  });
  const phaseExecution = normalizePhaseExecutionInput(compiled.phaseExecution);

  assert.ok(phaseExecution);

  const implementationPhase = phaseExecution.phases[2];

  assert.ok(implementationPhase);

  implementationPhase.status = "in_progress";
  phaseExecution.current = {
    phaseId: "factory-implementation",
    storyId: null,
    taskId: null
  };

  for (const story of implementationPhase.userStories) {
    story.status = "completed";

    for (const task of story.tasks) {
      task.status = "completed";
      task.result = {
        mode: "placeholder-execution",
        summary: task.expectedOutcome,
        instructionEcho: task.instruction,
        skillId: "test-skill",
        completedAt: "2026-03-27T00:00:00.000Z"
      };
    }
  }

  const expansion = applyFactoryStageExpansion({
    factory: factoryState,
    phaseExecution,
    stageId: "implementation",
    updatedAt: "2026-03-27T00:00:00.000Z"
  });

  assert.ok(expansion);
  assert.equal(expansion?.expanded, true);
  assert.equal(expansion?.decision?.outcome, "expanded");
  assert.ok((expansion?.decision?.addedBacklogItemIds.length ?? 0) >= 1);
  assert.ok(
    expansion?.factory.stagePlans
      .find((plan) => plan.stageId === "implementation")
      ?.backlog.some((item) => item.source === "expansion")
  );
  assert.ok((expansion?.phaseExecution.phases[2]?.userStories.length ?? 0) > 2);
});

test("normalizeFactoryRunState backfills the completion contract for legacy state", () => {
  const normalized = normalizeFactoryRunState({
    version: 1,
    mode: "factory",
    appName: "Legacy Portal",
    productBrief: "Build a legacy onboarding portal.",
    stack: {
      templateId: "nextjs_railway_postgres",
      label: "Next.js + Railway Postgres",
      frontend: "Next.js App Router",
      backend: "Route Handlers and server utilities",
      data: "Railway Postgres",
      deployment: "Railway"
    },
    repository: {
      provider: "github",
      owner: "acme",
      name: "legacy-portal",
      visibility: "private",
      baseBranch: "main",
      url: null,
      localPath: "/tmp/factory-workspaces/legacy-portal"
    },
    deployment: {
      provider: "railway",
      projectName: "legacy-portal",
      environment: "production",
      url: null
    },
    currentStage: "bootstrap",
    artifacts: [],
    deliverySummary: null,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z"
  } as unknown as Parameters<typeof normalizeFactoryRunState>[0]);

  assert.ok(normalized);
  assert.equal(normalized?.completionContract.appSpec.appName, "Legacy Portal");
  assert.equal(normalized?.completionContract.phases[1]?.phaseId, "factory-bootstrap");
  assert.equal(normalized?.stagePlans.length, 4);
  assert.deepEqual(normalized?.expansionDecisions, []);
  assert.ok(
    normalized?.completionContract.definitionOfDone.verificationCriteria.some(
      (criterion) => criterion.evidenceKind === "delivery_summary"
    )
  );
});
