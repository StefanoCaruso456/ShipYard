import assert from "node:assert/strict";
import test from "node:test";

import {
  compileFactoryTaskSubmission,
  createFactoryRunState,
  normalizeFactoryRunInput,
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
  assert.ok(
    compiled.context?.constraints.some((constraint) =>
      constraint.includes("connected runtime folder")
    )
  );
  assert.ok(
    compiled.context?.constraints.some((constraint) =>
      constraint.includes("Do not create, connect, or publish a remote repository")
    )
  );
  assert.ok(compiled.context?.relevantFiles.some((file) => file.path === "README.md"));
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
  assert.equal(
    synced?.artifacts.find((artifact) => artifact.kind === "repository")?.status,
    "completed"
  );
  assert.equal(
    synced?.artifacts.find((artifact) => artifact.kind === "bootstrap_plan")?.status,
    "completed"
  );
});
