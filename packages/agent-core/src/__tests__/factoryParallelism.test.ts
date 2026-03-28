import assert from "node:assert/strict";
import test from "node:test";

import {
  compileFactoryTaskSubmission,
  createControlPlaneState,
  createFactoryRunState,
  normalizeFactoryRunInput,
  normalizePhaseExecutionInput,
  openFactoryParallelExecutionWindow,
  recordPhaseStarted
} from "../index";

function buildFactoryExecutionFixture() {
  const submission = compileFactoryTaskSubmission({
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
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260327"
  });
  const phaseExecution = normalizePhaseExecutionInput(submission.phaseExecution);
  const factoryInput = normalizeFactoryRunInput(submission.factory);

  assert.ok(phaseExecution);
  assert.ok(factoryInput);

  const factory = createFactoryRunState({
    input: factoryInput,
    productBrief: submission.instruction,
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260327",
    phaseExecution
  });
  const controlPlane = createControlPlaneState(phaseExecution);
  const implementationPhase = phaseExecution.phases.find(
    (phase) => phase.id === "factory-implementation"
  );

  assert.ok(implementationPhase);
  recordPhaseStarted(controlPlane, implementationPhase, factory);

  return {
    factory,
    controlPlane,
    phaseExecution,
    implementationPhase
  };
}

test("openFactoryParallelExecutionWindow selects independent Factory packets for parallel execution", () => {
  const fixture = buildFactoryExecutionFixture();

  const selection = openFactoryParallelExecutionWindow({
    factory: fixture.factory,
    phase: fixture.implementationPhase,
    phaseExecution: fixture.phaseExecution,
    controlPlane: fixture.controlPlane,
    updatedAt: "2026-03-28T12:00:00.000Z"
  });

  assert.ok(selection.window);
  assert.equal(selection.window?.phaseId, "factory-implementation");
  assert.equal(selection.window?.executionMode, "parallel");
  assert.equal(selection.window?.packetIds.length, 2);
  assert.deepEqual(selection.window?.blockedPacketIds, []);
  assert.ok(selection.factory.scopeLocks.length >= 2);
  assert.ok(
    selection.factory.workPackets
      .filter((packet) => selection.window?.packetIds.includes(packet.id))
      .every((packet) => packet.status === "running")
  );
});

test("openFactoryParallelExecutionWindow serializes overlapping Factory packets and preserves explicit conflict data", () => {
  const fixture = buildFactoryExecutionFixture();

  fixture.implementationPhase.userStories.forEach((story) => {
    story.tasks[0]!.context = {
      objective: null,
      constraints: [],
      relevantFiles: [
        {
          path: "apps/client/src/App.tsx"
        }
      ],
      validationTargets: []
    };
  });

  const overlapFactory = createFactoryRunState({
    input: normalizeFactoryRunInput({
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
    })!,
    productBrief: "Build a customer onboarding portal for operations teams.",
    workspacePath: "/tmp/factory-workspaces/ops-portal-20260327",
    phaseExecution: fixture.phaseExecution
  });
  const overlapControlPlane = createControlPlaneState(fixture.phaseExecution);

  recordPhaseStarted(overlapControlPlane, fixture.implementationPhase, overlapFactory);

  const selection = openFactoryParallelExecutionWindow({
    factory: overlapFactory,
    phase: fixture.implementationPhase,
    phaseExecution: fixture.phaseExecution,
    controlPlane: overlapControlPlane,
    updatedAt: "2026-03-28T12:05:00.000Z"
  });

  assert.ok(selection.window);
  assert.equal(selection.window?.executionMode, "sequential");
  assert.equal(selection.window?.packetIds.length, 1);
  assert.equal(selection.window?.blockedPacketIds.length, 1);
  assert.ok((selection.window?.conflictIds.length ?? 0) >= 1);
  assert.ok(
    selection.factory.workPackets.some(
      (packet) =>
        selection.window?.blockedPacketIds.includes(packet.id) &&
        packet.status === "blocked" &&
        packet.blockedByPacketIds.length > 0
    )
  );
  assert.ok(
    overlapControlPlane.conflicts.some((conflict) => conflict.kind === "scope_overlap")
  );
});
