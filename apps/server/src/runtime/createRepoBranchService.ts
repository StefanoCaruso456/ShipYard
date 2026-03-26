import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RuntimeRepoBranch = {
  name: string;
  current: boolean;
};

export type RuntimeRepoBranchSnapshot = {
  repoRoot: string;
  currentBranch: string | null;
  dirty: boolean;
  branches: RuntimeRepoBranch[];
};

export class RepoBranchServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "RepoBranchServiceError";
    this.statusCode = statusCode;
  }
}

type RepoBranchServiceOptions = {
  rootDir: string;
};

export function createRepoBranchService(options: RepoBranchServiceOptions) {
  const rootDir = options.rootDir;

  return {
    async getSnapshot(): Promise<RuntimeRepoBranchSnapshot> {
      const repoRoot = await resolveRepoRoot(rootDir);
      const [currentBranch, branches, dirty] = await Promise.all([
        readCurrentBranch(repoRoot),
        listBranches(repoRoot),
        hasDirtyWorktree(repoRoot)
      ]);

      return {
        repoRoot,
        currentBranch,
        dirty,
        branches
      };
    },

    async switchBranch(branchName: string) {
      validateBranchName(branchName);

      const snapshot = await this.getSnapshot();

      if (snapshot.dirty) {
        throw new RepoBranchServiceError(
          "Commit or stash local changes before switching branches.",
          409
        );
      }

      const target = snapshot.branches.find((branch) => branch.name === branchName);

      if (!target) {
        throw new RepoBranchServiceError(
          `Branch ${branchName} does not exist in the runtime workspace.`,
          404
        );
      }

      if (target.current) {
        return snapshot;
      }

      await runGit(snapshot.repoRoot, ["switch", branchName]);

      return this.getSnapshot();
    }
  };
}

async function resolveRepoRoot(rootDir: string) {
  const { stdout } = await runGit(rootDir, ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

async function readCurrentBranch(rootDir: string) {
  const { stdout } = await runGit(rootDir, ["branch", "--show-current"]);
  const value = stdout.trim();
  return value.length > 0 ? value : null;
}

async function listBranches(rootDir: string) {
  const { stdout } = await runGit(rootDir, [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname:short)%09%(HEAD)",
    "refs/heads"
  ]);

  const branches = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, headMarker] = line.split("\t");

      return {
        name,
        current: headMarker === "*"
      };
    });

  return branches.sort((left, right) => {
    if (left.current && !right.current) {
      return -1;
    }

    if (!left.current && right.current) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

async function hasDirtyWorktree(rootDir: string) {
  const { stdout } = await runGit(rootDir, [
    "status",
    "--porcelain",
    "--untracked-files=normal"
  ]);

  return stdout.trim().length > 0;
}

async function runGit(rootDir: string, args: string[]) {
  try {
    return await execFileAsync("git", args, {
      cwd: rootDir,
      env: process.env
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Git command failed while handling runtime branches.";

    throw new RepoBranchServiceError(message, 503);
  }
}

function validateBranchName(value: string) {
  const branchName = value.trim();

  if (!branchName) {
    throw new RepoBranchServiceError("branchName is required.", 400);
  }

  if (
    branchName.startsWith("-") ||
    branchName.includes("\\") ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    branchName.endsWith("/") ||
    !/^[A-Za-z0-9._/-]+$/.test(branchName)
  ) {
    throw new RepoBranchServiceError("branchName contains unsupported characters.", 400);
  }
}
