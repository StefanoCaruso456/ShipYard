import type { BrowserDirectoryHandle } from "./projects";
import type { WorkspaceProjectRepository } from "./types";

type ParsedRemote = {
  provider: WorkspaceProjectRepository["provider"];
  remoteName: string;
  url: string | null;
  label: string;
  owner: string | null;
  repo: string | null;
};

export async function inspectLocalRepository(
  rootHandle: BrowserDirectoryHandle
): Promise<WorkspaceProjectRepository | null> {
  const gitDirectory = await resolveGitDirectoryHandle(rootHandle);

  if (!gitDirectory) {
    return null;
  }

  const headText = await readTextFile(gitDirectory, "HEAD");

  if (!headText) {
    return null;
  }

  const currentBranch = parseHeadBranch(headText);
  const configText = await readTextFile(gitDirectory, "config");
  const remote = parseRemote(configText);

  return {
    provider: remote?.provider ?? "git",
    remoteName: remote?.remoteName ?? null,
    url: remote?.url ?? null,
    label: remote?.label ?? rootHandle.name,
    owner: remote?.owner ?? null,
    repo: remote?.repo ?? null,
    currentBranch,
    source: remote ? "git-config" : "git-head"
  };
}

async function resolveGitDirectoryHandle(rootHandle: BrowserDirectoryHandle) {
  try {
    return await rootHandle.getDirectoryHandle(".git");
  } catch {
    // Fall back to file-based gitdirs used by worktrees or submodules.
  }

  const gitReference = await readTextFile(rootHandle, ".git");

  if (!gitReference) {
    return null;
  }

  const match = gitReference.match(/gitdir:\s*(.+)\s*$/i);

  if (!match?.[1]) {
    return null;
  }

  return resolveRelativeDirectoryHandle(rootHandle, match[1].trim());
}

async function resolveRelativeDirectoryHandle(
  rootHandle: BrowserDirectoryHandle,
  relativePath: string
) {
  if (!relativePath || relativePath.startsWith("/") || /^[A-Za-z]:\\/.test(relativePath)) {
    return null;
  }

  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current = rootHandle;

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      return null;
    }

    try {
      current = await current.getDirectoryHandle(segment);
    } catch {
      return null;
    }
  }

  return current;
}

async function readTextFile(directoryHandle: BrowserDirectoryHandle, name: string) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return (await file.text()).trim();
  } catch {
    return null;
  }
}

function parseHeadBranch(headText: string) {
  const refMatch = headText.match(/^ref:\s+refs\/heads\/(.+)$/i);

  if (refMatch?.[1]) {
    return refMatch[1].trim();
  }

  return headText ? "detached" : null;
}

function parseRemote(configText: string | null): ParsedRemote | null {
  if (!configText) {
    return null;
  }

  const remoteMatches = Array.from(
    configText.matchAll(/\[remote\s+"([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g)
  );

  if (remoteMatches.length === 0) {
    return null;
  }

  const originMatch =
    remoteMatches.find((match) => match[1]?.trim() === "origin") ?? remoteMatches[0];

  if (!originMatch) {
    return null;
  }

  const remoteName = originMatch[1]?.trim() || "origin";
  const block = originMatch[2] ?? "";
  const urlMatch = block.match(/^\s*url\s*=\s*(.+)$/m);
  const rawUrl = urlMatch?.[1]?.trim() ?? null;

  return normalizeRemote(remoteName, rawUrl);
}

function normalizeRemote(remoteName: string, rawUrl: string | null): ParsedRemote {
  if (!rawUrl) {
    return {
      provider: "git",
      remoteName,
      url: null,
      label: remoteName,
      owner: null,
      repo: null
    };
  }

  const githubScpMatch = rawUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);

  if (githubScpMatch?.[1] && githubScpMatch[2]) {
    const owner = githubScpMatch[1];
    const repo = stripGitSuffix(githubScpMatch[2]);

    return {
      provider: "github",
      remoteName,
      url: `https://github.com/${owner}/${repo}`,
      label: `${owner}/${repo}`,
      owner,
      repo
    };
  }

  try {
    const parsed = new URL(rawUrl);
    const pathSegments = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const owner = pathSegments[0] ?? null;
    const repo = pathSegments[1] ? stripGitSuffix(pathSegments[1]) : null;
    const isGitHub = parsed.hostname.toLowerCase() === "github.com";
    const cleanUrl =
      owner && repo
        ? `${parsed.protocol}//${parsed.host}/${owner}/${repo}`
        : rawUrl;

    return {
      provider: isGitHub ? "github" : "git",
      remoteName,
      url: cleanUrl,
      label: owner && repo ? `${owner}/${repo}` : parsed.host,
      owner: isGitHub ? owner : null,
      repo: isGitHub ? repo : null
    };
  } catch {
    return {
      provider: "git",
      remoteName,
      url: rawUrl,
      label: rawUrl.replace(/\.git$/i, ""),
      owner: null,
      repo: null
    };
  }
}

function stripGitSuffix(value: string) {
  return value.replace(/\.git$/i, "");
}
