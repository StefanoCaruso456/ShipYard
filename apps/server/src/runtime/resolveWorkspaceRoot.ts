import { access } from "node:fs/promises";
import path from "node:path";

const workspaceMarkers = ["pnpm-workspace.yaml", "skill.md"] as const;

export async function resolveWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
) {
  const configuredRoot = env.SHIPYARD_ROOT_DIR?.trim();

  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  let currentDir = path.resolve(cwd);

  while (true) {
    if (await hasWorkspaceMarkers(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return path.resolve(cwd);
    }

    currentDir = parentDir;
  }
}

async function hasWorkspaceMarkers(directory: string) {
  const checks = await Promise.all(workspaceMarkers.map((marker) => fileExists(path.join(directory, marker))));

  return checks.every(Boolean);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
