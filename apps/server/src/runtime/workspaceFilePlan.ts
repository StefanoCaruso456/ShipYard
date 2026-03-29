import type { WorkspaceFilePlanEffect } from "@shipyard/agent-core";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type WorkspaceFilePlanOperation =
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

type WorkspaceFilePlan = {
  operations: WorkspaceFilePlanOperation[];
};

const LOCAL_FILE_PLAN_PATTERN = /<local-file-plan>\s*([\s\S]*?)\s*<\/local-file-plan>/i;

export function extractWorkspaceFilePlan(text: string | null | undefined) {
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
    const candidate = parseWorkspaceFilePlanPayload(match[1]);

    return {
      strippedText,
      plan: validateWorkspaceFilePlan(candidate),
      error: null
    };
  } catch (error) {
    return {
      strippedText,
      plan: null,
      error:
        error instanceof Error
          ? `Invalid workspace file plan JSON: ${error.message}`
          : "Invalid workspace file plan JSON."
    };
  }
}

export async function applyWorkspaceFilePlan(input: {
  rootDir: string;
  responseText: string | null | undefined;
}): Promise<WorkspaceFilePlanEffect | null> {
  const parsed = extractWorkspaceFilePlan(input.responseText);

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  if (!parsed.plan) {
    return null;
  }

  const createdDirectories = new Set<string>();
  const writtenFiles = new Set<string>();
  const deletedFiles = new Set<string>();

  for (const operation of parsed.plan.operations) {
    const workspacePath = resolveWorkspacePath(input.rootDir, operation.path);

    try {
      switch (operation.kind) {
        case "mkdir":
          await mkdir(workspacePath.resolvedPath, { recursive: true });
          createdDirectories.add(workspacePath.relativePath);
          break;
        case "write_file":
          await mkdir(path.dirname(workspacePath.resolvedPath), { recursive: true });
          await writeFile(workspacePath.resolvedPath, operation.content, "utf8");
          writtenFiles.add(workspacePath.relativePath);
          break;
        case "delete_file":
          await unlink(workspacePath.resolvedPath);
          deletedFiles.add(workspacePath.relativePath);
          break;
      }
    } catch (error) {
      const actionLabel =
        operation.kind === "mkdir"
          ? "create directory"
          : operation.kind === "write_file"
            ? "write file"
            : "delete file";
      const reason = error instanceof Error ? error.message : "Unknown filesystem error.";

      throw new Error(`Failed to ${actionLabel} ${workspacePath.relativePath}: ${reason}`);
    }
  }

  return {
    tag: "local-file-plan",
    target: "runtime-folder",
    operationCount: parsed.plan.operations.length,
    createdDirectories: [...createdDirectories],
    writtenFiles: [...writtenFiles],
    deletedFiles: [...deletedFiles],
    summary: buildWorkspacePlanSummary({
      createdDirectoryCount: createdDirectories.size,
      writtenFileCount: writtenFiles.size,
      deletedFileCount: deletedFiles.size
    })
  };
}

function parseWorkspaceFilePlanPayload(rawPayload: string) {
  const candidates = buildPlanPayloadCandidates(rawPayload);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Invalid workspace file plan JSON.");
}

function buildPlanPayloadCandidates(rawPayload: string) {
  const trimmed = rawPayload.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const withoutLanguageTag = withoutFence.replace(/^json\s*/i, "").trim();
  const firstBraceIndex = withoutLanguageTag.indexOf("{");
  const lastBraceIndex = withoutLanguageTag.lastIndexOf("}");
  const extractedObject =
    firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex
      ? withoutLanguageTag.slice(firstBraceIndex, lastBraceIndex + 1).trim()
      : withoutLanguageTag;

  return [...new Set([trimmed, withoutFence, withoutLanguageTag, extractedObject].filter(Boolean))];
}

function validateWorkspaceFilePlan(value: unknown): WorkspaceFilePlan {
  if (!value || typeof value !== "object") {
    throw new Error("Expected an object payload.");
  }

  const candidate = value as { operations?: unknown };

  if (!Array.isArray(candidate.operations)) {
    throw new Error("Expected an operations array.");
  }

  return {
    operations: candidate.operations.map((operation, index) =>
      validateWorkspaceFilePlanOperation(operation, index)
    )
  };
}

function validateWorkspaceFilePlanOperation(
  value: unknown,
  index: number
): WorkspaceFilePlanOperation {
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

function resolveWorkspacePath(rootDir: string, inputPath: string) {
  const normalized = inputPath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");

  if (!normalized) {
    throw new Error("Workspace file plan paths must not be empty.");
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Path "${inputPath}" must stay relative to the connected workspace root.`);
  }

  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    throw new Error(`Path "${inputPath}" must contain at least one segment.`);
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`Path "${inputPath}" cannot use dot segments.`);
    }
  }

  const relativePath = segments.join("/");
  const resolvedPath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, resolvedPath);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Path "${inputPath}" resolves outside the connected workspace root.`);
  }

  return {
    resolvedPath,
    relativePath
  };
}

function buildWorkspacePlanSummary(input: {
  createdDirectoryCount: number;
  writtenFileCount: number;
  deletedFileCount: number;
}) {
  const parts: string[] = [];

  if (input.createdDirectoryCount > 0) {
    parts.push(
      `created ${input.createdDirectoryCount} director${input.createdDirectoryCount === 1 ? "y" : "ies"}`
    );
  }

  if (input.writtenFileCount > 0) {
    parts.push(`wrote ${input.writtenFileCount} file${input.writtenFileCount === 1 ? "" : "s"}`);
  }

  if (input.deletedFileCount > 0) {
    parts.push(
      `deleted ${input.deletedFileCount} file${input.deletedFileCount === 1 ? "" : "s"}`
    );
  }

  return parts.length > 0
    ? `Applied workspace file plan: ${parts.join(", ")}.`
    : "Applied workspace file plan.";
}
