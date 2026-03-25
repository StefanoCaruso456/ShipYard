import type {
  LocalFileExecutionEffect,
  WorkspaceProject
} from "./types";
import type {
  BrowserDirectoryHandle,
  BrowserFileHandle
} from "./projects";

export type LocalFilePlanOperation =
  | {
      kind: "mkdir";
      path: string;
    }
  | {
      kind: "write_file";
      path: string;
      content: string;
    }
  | {
      kind: "delete_file";
      path: string;
    };

export type LocalFilePlan = {
  operations: LocalFilePlanOperation[];
};

const LOCAL_FILE_PLAN_PATTERN = /<local-file-plan>\s*([\s\S]*?)\s*<\/local-file-plan>/i;

export function extractLocalFilePlan(text: string | null | undefined) {
  const source = text ?? "";
  const match = LOCAL_FILE_PLAN_PATTERN.exec(source);
  const strippedText = source.replace(LOCAL_FILE_PLAN_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();

  if (!match) {
    return {
      strippedText,
      plan: null,
      error: null
    };
  }

  try {
    const candidate = JSON.parse(match[1]) as unknown;

    return {
      strippedText,
      plan: validateLocalFilePlan(candidate),
      error: null
    };
  } catch (error) {
    return {
      strippedText,
      plan: null,
      error:
        error instanceof Error
          ? `Invalid local file plan JSON: ${error.message}`
          : "Invalid local file plan JSON."
    };
  }
}

export function stripLocalFilePlan(text: string | null | undefined) {
  return extractLocalFilePlan(text).strippedText;
}

export async function applyLocalFilePlan(input: {
  taskId: string;
  project: WorkspaceProject;
  handle: BrowserDirectoryHandle;
  responseText: string | null | undefined;
}): Promise<LocalFileExecutionEffect> {
  const parsed = extractLocalFilePlan(input.responseText);

  if (parsed.error) {
    return createFailedEffect(input.taskId, input.project.id, parsed.error);
  }

  if (!parsed.plan) {
    return createFailedEffect(
      input.taskId,
      input.project.id,
      "No local file plan was found in the runtime response."
    );
  }

  try {
    await ensureDirectoryPermission(input.handle);
  } catch (error) {
    return createFailedEffect(
      input.taskId,
      input.project.id,
      error instanceof Error ? error.message : "Local folder access is unavailable."
    );
  }

  const details: string[] = [];
  const files = new Set<string>();
  let createdDirectoryCount = 0;
  let writtenFileCount = 0;
  let deletedFileCount = 0;

  try {
    for (const operation of parsed.plan.operations) {
      switch (operation.kind) {
        case "mkdir": {
          const segments = normalizeRelativePath(operation.path);
          await ensureDirectory(input.handle, segments);
          createdDirectoryCount += 1;
          details.push(`Created directory ${segments.join("/")}`);
          break;
        }
        case "write_file": {
          const segments = normalizeRelativePath(operation.path);
          const { parent, leafName } = await resolveParentDirectory(input.handle, segments, true);
          const fileHandle = await parent.getFileHandle(leafName, { create: true });
          await writeBrowserFile(fileHandle, operation.content);
          writtenFileCount += 1;
          files.add(segments.join("/"));
          details.push(`Wrote file ${segments.join("/")}`);
          break;
        }
        case "delete_file": {
          const segments = normalizeRelativePath(operation.path);
          const { parent, leafName } = await resolveParentDirectory(input.handle, segments, false);
          await parent.removeEntry(leafName);
          deletedFileCount += 1;
          details.push(`Deleted file ${segments.join("/")}`);
          break;
        }
      }
    }

    return {
      taskId: input.taskId,
      projectId: input.project.id,
      status: "applied",
      summary: buildAppliedSummary(createdDirectoryCount, writtenFileCount, deletedFileCount),
      timestamp: new Date().toISOString(),
      files: [...files],
      details,
      error: null
    };
  } catch (error) {
    return createFailedEffect(
      input.taskId,
      input.project.id,
      error instanceof Error ? error.message : "Applying the local file plan failed."
    );
  }
}

function validateLocalFilePlan(value: unknown): LocalFilePlan {
  if (!value || typeof value !== "object") {
    throw new Error("Expected an object payload.");
  }

  const candidate = value as { operations?: unknown };

  if (!Array.isArray(candidate.operations)) {
    throw new Error("Expected an operations array.");
  }

  return {
    operations: candidate.operations.map((operation, index) =>
      validateOperation(operation, index)
    )
  };
}

function validateOperation(value: unknown, index: number): LocalFilePlanOperation {
  if (!value || typeof value !== "object") {
    throw new Error(`Operation ${index + 1} must be an object.`);
  }

  const candidate = value as {
    kind?: unknown;
    path?: unknown;
    content?: unknown;
  };

  if (typeof candidate.path !== "string" || !candidate.path.trim()) {
    throw new Error(`Operation ${index + 1} requires a non-empty string path.`);
  }

  if (candidate.kind === "mkdir") {
    return {
      kind: "mkdir",
      path: candidate.path
    };
  }

  if (candidate.kind === "write_file") {
    if (typeof candidate.content !== "string") {
      throw new Error(`Operation ${index + 1} requires string content for write_file.`);
    }

    return {
      kind: "write_file",
      path: candidate.path,
      content: candidate.content
    };
  }

  if (candidate.kind === "delete_file") {
    return {
      kind: "delete_file",
      path: candidate.path
    };
  }

  throw new Error(`Operation ${index + 1} uses an unsupported kind.`);
}

function normalizeRelativePath(input: string) {
  const normalized = input.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");

  if (!normalized) {
    throw new Error("Local file plan paths must not be empty.");
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Path "${input}" must stay relative to the connected project root.`);
  }

  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Path "${input}" must contain at least one segment.`);
  }

  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new Error(`Path "${input}" cannot use dot segments.`);
    }
  }

  return parts;
}

async function resolveParentDirectory(
  root: BrowserDirectoryHandle,
  segments: string[],
  create: boolean
) {
  if (segments.length === 0) {
    throw new Error("Cannot resolve a parent directory for an empty path.");
  }

  const leafName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parent = create
    ? await ensureDirectory(root, parentSegments)
    : await getExistingDirectory(root, parentSegments);

  return {
    parent,
    leafName
  };
}

async function ensureDirectory(root: BrowserDirectoryHandle, segments: string[]) {
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

async function getExistingDirectory(root: BrowserDirectoryHandle, segments: string[]) {
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }

  return current;
}

async function writeBrowserFile(handle: BrowserFileHandle, content: string) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function ensureDirectoryPermission(handle: BrowserDirectoryHandle) {
  if (typeof handle.queryPermission === "function") {
    const permission = await handle.queryPermission({ mode: "readwrite" });

    if (permission === "granted") {
      return;
    }
  }

  if (typeof handle.requestPermission === "function") {
    const permission = await handle.requestPermission({ mode: "readwrite" });

    if (permission === "granted") {
      return;
    }
  }

  throw new Error(
    "The browser does not currently have write access to this project folder. Reconnect the folder and try again."
  );
}

function buildAppliedSummary(
  createdDirectoryCount: number,
  writtenFileCount: number,
  deletedFileCount: number
) {
  const parts: string[] = [];

  if (createdDirectoryCount > 0) {
    parts.push(`created ${formatCount(createdDirectoryCount, "directory")}`);
  }

  if (writtenFileCount > 0) {
    parts.push(`wrote ${formatCount(writtenFileCount, "file")}`);
  }

  if (deletedFileCount > 0) {
    parts.push(`deleted ${formatCount(deletedFileCount, "file")}`);
  }

  if (parts.length === 0) {
    return "Local file plan applied with no filesystem changes.";
  }

  return `Applied the local file plan: ${parts.join(", ")}.`;
}

function createFailedEffect(
  taskId: string,
  projectId: string,
  error: string
): LocalFileExecutionEffect {
  return {
    taskId,
    projectId,
    status: "failed",
    summary: `Local workspace apply failed: ${error}`,
    timestamp: new Date().toISOString(),
    files: [],
    details: [],
    error
  };
}

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
