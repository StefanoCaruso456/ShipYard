import assert from "node:assert/strict";
import test from "node:test";

import {
  controlPlaneArtifactSchema,
  controlPlaneConflictSchema,
  controlPlaneHandoffSchema,
  controlPlaneMergeDecisionSchema,
  normalizeRunContextInputValue,
  safeParseRunContextInput
} from "../runtime/schemas";

test("safeParseRunContextInput trims and normalizes valid runtime context", () => {
  const parsed = safeParseRunContextInput({
    objective: "  Build the next step.  ",
    constraints: [" keep scope tight ", " "],
    relevantFiles: [
      {
        path: " src/index.ts ",
        excerpt: " export const value = 1; ",
        startLine: 10,
        endLine: 14,
        source: " operator ",
        reason: " directly referenced "
      }
    ],
    externalContext: [
      {
        id: " spec-1 ",
        kind: "spec",
        title: " Feature spec ",
        content: " # Spec ",
        source: " docs/spec.md ",
        format: "markdown"
      }
    ],
    validationTargets: [" pnpm test "],
    specialistAgentTypeId: "backend_dev"
  });

  assert.equal(parsed.success, true);

  if (!parsed.success) {
    return;
  }

  assert.deepEqual(parsed.data, {
    objective: "Build the next step.",
    constraints: ["keep scope tight"],
    relevantFiles: [
      {
        path: "src/index.ts",
        excerpt: "export const value = 1;",
        startLine: 10,
        endLine: 14,
        source: "operator",
        reason: "directly referenced"
      }
    ],
    externalContext: [
      {
        id: "spec-1",
        kind: "spec",
        title: "Feature spec",
        content: "# Spec",
        source: "docs/spec.md",
        format: "markdown"
      }
    ],
    validationTargets: ["pnpm test"],
    specialistAgentTypeId: "backend_dev"
  });
});

test("normalizeRunContextInputValue salvages valid entries from partially invalid context", () => {
  const normalized = normalizeRunContextInputValue({
    objective: "  ",
    constraints: [" keep scope tight ", 42],
    relevantFiles: [
      {
        path: " src/ok.ts ",
        excerpt: " export const ok = true; "
      },
      {
        path: ""
      }
    ],
    externalContext: [
      {
        id: "test-1",
        kind: "test_result",
        title: "Failing test",
        content: "FAIL src/ok.test.ts"
      },
      {
        id: "bad-kind",
        kind: "not_real",
        title: "Bad",
        content: "ignore"
      }
    ],
    validationTargets: [" pnpm test ", false],
    specialistAgentTypeId: "repo_tools_dev"
  });

  assert.deepEqual(normalized, {
    objective: null,
    constraints: ["keep scope tight"],
    relevantFiles: [
      {
        path: "src/ok.ts",
        excerpt: "export const ok = true;",
        startLine: null,
        endLine: null,
        source: null,
        reason: null
      }
    ],
    externalContext: [
      {
        id: "test-1",
        kind: "test_result",
        title: "Failing test",
        content: "FAIL src/ok.test.ts",
        source: null,
        format: "text"
      }
    ],
    validationTargets: ["pnpm test"],
    specialistAgentTypeId: "repo_tools_dev"
  });
});

test("control plane artifact and handoff schemas preserve typed runtime records", () => {
  const artifact = controlPlaneArtifactSchema.parse({
    id: "artifact-1",
    kind: "architecture_decision",
    entityKind: "story",
    entityId: "story-1",
    summary: "Route the story to the backend specialist.",
    createdAt: "2026-03-26T05:00:00.000Z",
    producerRole: "orchestrator",
    producerId: "orch-1",
    producerAgentTypeId: null,
    path: " docs/briefs/backend.md ",
    payload: {
      kind: "architecture_decision",
      version: 1,
      storyId: "story-1",
      selectedSpecialistAgentTypeId: "backend_dev",
      decisionSource: "registry_default",
      rationale: "Default the story to backend_dev.",
      domainTargets: ["api", "runtime"],
      fileTargets: ["packages/agent-core/src/runtime/controlPlane.ts"],
      allowedToolNames: ["read_file", "edit_file_region"],
      validationTargets: ["pnpm typecheck"],
      taskIds: ["task-1"]
    }
  });
  const handoff = controlPlaneHandoffSchema.parse({
    id: "handoff-1",
    fromRole: "production_lead",
    fromId: "prod-lead-1",
    fromAgentTypeId: "production_lead",
    toRole: "specialist_dev",
    toId: "backend-dev-1",
    toAgentTypeId: "backend_dev",
    entityKind: "story",
    entityId: "story-1",
    correlationId: "corr-1",
    artifactIds: [" artifact-1 "],
    dependencyIds: [" dep-1 "],
    acceptanceCriteria: [" patch compiles "],
    validationTargets: [" pnpm typecheck "],
    purpose: " Deliver the backend patch ",
    workPacket: {
      version: 1,
      sourceArtifactIds: [" artifact-1 "],
      scopeSummary: " Ship the backend patch ",
      constraints: [" keep scope tight "],
      fileTargets: [" packages/agent-core/src/runtime/controlPlane.ts "],
      domainTargets: [" api "],
      acceptanceCriteria: [" patch compiles "],
      validationTargets: [" pnpm typecheck "],
      dependencyIds: [" dep-1 "],
      taskIds: [" task-1 "],
      ownerAgentTypeId: "backend_dev"
    },
    status: "created",
    createdAt: "2026-03-26T05:00:00.000Z",
    acceptedAt: null,
    completedAt: null
  });

  assert.equal(artifact.path, "docs/briefs/backend.md");
  assert.equal(artifact.payload?.kind, "architecture_decision");
  assert.deepEqual(handoff.artifactIds, ["artifact-1"]);
  assert.deepEqual(handoff.validationTargets, ["pnpm typecheck"]);
  assert.equal(handoff.purpose, "Deliver the backend patch");
  assert.equal(handoff.workPacket?.ownerAgentTypeId, "backend_dev");
});

test("control plane conflict and merge decision schemas preserve governance records", () => {
  const conflict = controlPlaneConflictSchema.parse({
    id: " conflict-1 ",
    kind: "boundary_violation",
    entityKind: "task",
    entityId: " task-1 ",
    stepId: " step-1 ",
    summary: " Executor wrote outside the assigned file targets. ",
    status: "open",
    detectedAt: "2026-03-26T06:00:00.000Z",
    resolvedAt: null,
    ownerRole: "production_lead",
    ownerId: " prod-lead-1 ",
    ownerAgentTypeId: "production_lead",
    sourceHandoffId: " handoff:task:task-1 ",
    relatedHandoffIds: [" handoff:task:task-1 ", " handoff:task:task-2 "],
    conflictingPaths: [" packages/a.ts "],
    expectedPaths: [" packages/b.ts "],
    conflictingAgentTypeIds: ["backend_dev", "repo_tools_dev"],
    resolutionDecisionId: " decision-1 ",
    metadata: {
      changedFiles: ["packages/a.ts"]
    }
  });
  const decision = controlPlaneMergeDecisionSchema.parse({
    id: " decision-1 ",
    entityKind: "task",
    entityId: " task-1 ",
    conflictIds: [" conflict-1 "],
    outcome: "reassign",
    summary: " Reassign the task to repo tools. ",
    decidedAt: "2026-03-26T06:01:00.000Z",
    ownerRole: "production_lead",
    ownerId: " prod-lead-1 ",
    ownerAgentTypeId: "production_lead",
    targetHandoffId: " handoff:task:task-1 ",
    reassignedToAgentTypeId: "repo_tools_dev",
    notes: " Preserve the original specialist boundary. "
  });

  assert.equal(conflict.id, "conflict-1");
  assert.equal(conflict.stepId, "step-1");
  assert.deepEqual(conflict.relatedHandoffIds, ["handoff:task:task-1", "handoff:task:task-2"]);
  assert.deepEqual(conflict.conflictingPaths, ["packages/a.ts"]);
  assert.equal(conflict.resolutionDecisionId, "decision-1");
  assert.equal(decision.id, "decision-1");
  assert.deepEqual(decision.conflictIds, ["conflict-1"]);
  assert.equal(decision.reassignedToAgentTypeId, "repo_tools_dev");
  assert.equal(decision.notes, "Preserve the original specialist boundary.");
});
