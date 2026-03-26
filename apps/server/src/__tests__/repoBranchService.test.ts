import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  RepoBranchServiceError,
  createRepoBranchService
} from "../runtime/createRepoBranchService";

const execFileAsync = promisify(execFile);

test("repo branch service lists local branches and marks the current branch", async () => {
  const repoDir = await createTestRepo();
  const service = createRepoBranchService({
    rootDir: repoDir
  });

  try {
    await runGit(repoDir, ["switch", "-c", "feature/branch-picker"]);

    const snapshot = await service.getSnapshot();

    assert.equal(snapshot.currentBranch, "feature/branch-picker");
    assert.equal(snapshot.dirty, false);
    assert.ok(snapshot.branches.some((branch) => branch.name === "main"));
    assert.ok(
      snapshot.branches.some(
        (branch) => branch.name === "feature/branch-picker" && branch.current
      )
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("repo branch service switches branches when the worktree is clean", async () => {
  const repoDir = await createTestRepo();
  const service = createRepoBranchService({
    rootDir: repoDir
  });

  try {
    await runGit(repoDir, ["switch", "-c", "feature/branch-picker"]);
    await runGit(repoDir, ["switch", "main"]);

    const snapshot = await service.switchBranch("feature/branch-picker");

    assert.equal(snapshot.currentBranch, "feature/branch-picker");
    assert.ok(snapshot.branches.find((branch) => branch.name === "feature/branch-picker")?.current);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("repo branch service refuses to switch branches with local changes", async () => {
  const repoDir = await createTestRepo();
  const service = createRepoBranchService({
    rootDir: repoDir
  });

  try {
    await runGit(repoDir, ["switch", "-c", "feature/branch-picker"]);
    await runGit(repoDir, ["switch", "main"]);
    await writeFile(path.join(repoDir, "README.md"), "# dirty\n", "utf8");

    await assert.rejects(
      () => service.switchBranch("feature/branch-picker"),
      (error: unknown) => {
        assert.ok(error instanceof RepoBranchServiceError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Commit or stash local changes/);
        return true;
      }
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

async function createTestRepo() {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-repo-branches-"));

  await runGit(repoDir, ["init", "-b", "main"]);
  await writeFile(path.join(repoDir, "README.md"), "# Shipyard\n", "utf8");
  await runGit(repoDir, ["add", "README.md"]);
  await runGit(repoDir, [
    "-c",
    "user.name=Shipyard Tests",
    "-c",
    "user.email=shipyard-tests@example.com",
    "commit",
    "-m",
    "Initial commit"
  ]);

  return repoDir;
}

async function runGit(cwd: string, args: string[]) {
  await execFileAsync("git", args, {
    cwd,
    env: process.env
  });
}
