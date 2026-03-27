import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearRepoIntelligenceCache,
  resolveRelevantFilesForRun,
  suggestRelevantFilesFromRepo,
  type AgentRunRecord
} from "../index";

test("suggestRelevantFilesFromRepo ranks file paths and symbols from the full repo index", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-repo-intelligence-"));

  try {
    await mkdir(path.join(rootDir, "src/components"), {
      recursive: true
    });
    await mkdir(path.join(rootDir, "src/runtime"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, "src/components/Composer.tsx"),
      [
        "export function ComposerFeedback() {",
        "  return null;",
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(rootDir, "src/runtime/createRuntimeExecutor.ts"),
      [
        "export function createRuntimeExecutor() {",
        "  return null;",
        "}"
      ].join("\n")
    );

    clearRepoIntelligenceCache(rootDir);

    const suggestions = suggestRelevantFilesFromRepo({
      rootDir,
      instruction: "Fix composer feedback rendering in ComposerFeedback.",
      objective: "Update the composer feedback component."
    });

    assert.equal(suggestions[0]?.path, "src/components/Composer.tsx");
    assert.equal(suggestions[0]?.source, "repo-intelligence");
    assert.match(suggestions[0]?.reason ?? "", /ComposerFeedback/);
    assert.equal(suggestions[0]?.startLine, 1);
  } finally {
    clearRepoIntelligenceCache(rootDir);
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

test("resolveRelevantFilesForRun falls back to repo intelligence for runtime-backed runs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-run-intelligence-"));

  try {
    await mkdir(path.join(rootDir, "src/runtime"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, "src/runtime/createPersistentRuntimeService.ts"),
      [
        "export function createPersistentRuntimeService() {",
        "  return null;",
        "}"
      ].join("\n")
    );

    clearRepoIntelligenceCache(rootDir);

    const relevantFiles = resolveRelevantFilesForRun(
      createRunRecord("Adjust createPersistentRuntimeService queue handling.", rootDir),
      rootDir
    );

    assert.equal(
      relevantFiles[0]?.path,
      "src/runtime/createPersistentRuntimeService.ts"
    );
    assert.equal(relevantFiles[0]?.source, "repo-intelligence");
  } finally {
    clearRepoIntelligenceCache(rootDir);
    await rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

function createRunRecord(instruction: string, rootDir: string): AgentRunRecord {
  return {
    id: "run-repo-intelligence",
    threadId: "thread-repo-intelligence",
    parentRunId: null,
    title: "Repo intelligence test",
    instruction,
    simulateFailure: false,
    toolRequest: null,
    attachments: [],
    context: {
      objective: null,
      constraints: [],
      relevantFiles: [],
      externalContext: [],
      validationTargets: []
    },
    project: {
      id: "project-runtime",
      kind: "live",
      name: "Runtime",
      environment: "test",
      description: "runtime-backed project",
      links: [],
      folder: {
        name: path.basename(rootDir),
        displayPath: rootDir,
        status: "connected",
        provider: "runtime"
      }
    },
    status: "running",
    createdAt: "2026-03-27T01:00:00.000Z",
    startedAt: "2026-03-27T01:00:01.000Z",
    completedAt: null,
    retryCount: 0,
    validationStatus: "not_run",
    lastValidationResult: null,
    orchestration: null,
    phaseExecution: undefined,
    controlPlane: null,
    rebuild: null,
    factory: null,
    externalSync: null,
    rollingSummary: null,
    events: [],
    error: null,
    result: null
  };
}
