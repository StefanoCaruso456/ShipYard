import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type RuntimeWorkspacePlanOperation =
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

export type RuntimeWorkspacePlan = {
  operations: RuntimeWorkspacePlanOperation[];
};

export type ExtractedRuntimeWorkspacePlan = {
  strippedText: string;
  plan: RuntimeWorkspacePlan | null;
  error: string | null;
};

export type AppliedRuntimeWorkspacePlan = {
  summary: string;
  changedFiles: string[];
  operationCount: number;
};

const LOCAL_FILE_PLAN_PATTERN = /<local-file-plan>\s*([\s\S]*?)\s*<\/local-file-plan>/i;
const runtimeWorkspacePlanOperationSchema = z.object({
  kind: z.enum(["mkdir", "write_file", "delete_file"]),
  path: z.string().trim().min(1),
  content: z.string().optional()
});
const runtimeWorkspaceStructuredOutputOperationSchema = z.object({
  kind: z.enum(["mkdir", "write_file", "delete_file"]),
  path: z.string().trim().min(1),
  content: z.string()
});

export const runtimeWorkspacePlanSchema = z.object({
  operations: z
    .array(runtimeWorkspacePlanOperationSchema)
    .min(1)
});

export const runtimeWorkspaceStructuredOutputSchema = z.object({
  operations: z
    .array(runtimeWorkspaceStructuredOutputOperationSchema)
    .min(1)
});

export function extractRuntimeWorkspacePlan(
  text: string | null | undefined
): ExtractedRuntimeWorkspacePlan {
  const source = text ?? "";
  const match = LOCAL_FILE_PLAN_PATTERN.exec(source);
  const strippedText = source
    .replace(LOCAL_FILE_PLAN_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!match) {
    return {
      strippedText,
      plan: null,
      error: null
    };
  }

  try {
    const candidate = parsePlanPayload(match[1]);

    return {
      strippedText,
      plan: validateRuntimeWorkspacePlan(candidate),
      error: null
    };
  } catch (error) {
    return {
      strippedText,
      plan: null,
      error:
        error instanceof Error
          ? `Invalid runtime workspace plan JSON: ${error.message}`
          : "Invalid runtime workspace plan JSON."
    };
  }
}

export async function applyRuntimeWorkspacePlan(input: {
  rootDir: string;
  plan: RuntimeWorkspacePlan;
}): Promise<AppliedRuntimeWorkspacePlan> {
  const changedFiles = new Set<string>();
  let createdDirectoryCount = 0;
  let writtenFileCount = 0;
  let deletedFileCount = 0;

  for (const operation of input.plan.operations) {
    switch (operation.kind) {
      case "mkdir": {
        const relativePath = normalizeRelativePath(operation.path);
        await mkdir(path.join(input.rootDir, relativePath), { recursive: true });
        createdDirectoryCount += 1;
        break;
      }
      case "write_file": {
        const relativePath = normalizeRelativePath(operation.path);
        const absolutePath = path.join(input.rootDir, relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(
          absolutePath,
          normalizeGeneratedWorkspaceFileContent(relativePath, operation.content),
          "utf8"
        );
        writtenFileCount += 1;
        changedFiles.add(relativePath);
        break;
      }
      case "delete_file": {
        const relativePath = normalizeRelativePath(operation.path);
        await rm(path.join(input.rootDir, relativePath), { force: false });
        deletedFileCount += 1;
        changedFiles.add(relativePath);
        break;
      }
    }
  }

  return {
    summary: buildAppliedSummary(createdDirectoryCount, writtenFileCount, deletedFileCount),
    changedFiles: [...changedFiles],
    operationCount: input.plan.operations.length
  };
}

function parsePlanPayload(rawPayload: string) {
  const candidates = buildPlanPayloadCandidates(rawPayload);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Invalid runtime workspace plan JSON.");
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

function validateRuntimeWorkspacePlan(value: unknown): RuntimeWorkspacePlan {
  const parsed = runtimeWorkspacePlanSchema.parse(value);

  return {
    operations: parsed.operations.map((operation, index) =>
      validateOperation(operation, index)
    )
  };
}

function validateOperation(value: unknown, index: number): RuntimeWorkspacePlanOperation {
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
    throw new Error("Runtime workspace plan paths must not be empty.");
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Path "${input}" must stay relative to the connected runtime root.`);
  }

  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Path "${input}" must include a file or directory name.`);
  }

  if (parts.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Path "${input}" must not escape the connected runtime root.`);
  }

  return parts.join("/");
}

function normalizeGeneratedWorkspaceFileContent(relativePath: string, content: string) {
  if (!isTypeScriptConfigPath(relativePath)) {
    return content;
  }

  try {
    const parsed = JSON.parse(content) as {
      compilerOptions?: Record<string, unknown>;
    };

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return content;
    }

    const compilerOptions = parsed.compilerOptions;

    if (!compilerOptions || typeof compilerOptions !== "object" || Array.isArray(compilerOptions)) {
      return content;
    }

    if (typeof compilerOptions.baseUrl !== "string" || "ignoreDeprecations" in compilerOptions) {
      return content;
    }

    return `${JSON.stringify(
      {
        ...parsed,
        compilerOptions: {
          ...compilerOptions,
          ignoreDeprecations: "6.0"
        }
      },
      null,
      2
    )}\n`;
  } catch {
    return content;
  }
}

function isTypeScriptConfigPath(relativePath: string) {
  const basename = path.posix.basename(relativePath);

  return basename === "tsconfig.json" || /^tsconfig\..+\.json$/i.test(basename);
}

function buildAppliedSummary(
  createdDirectoryCount: number,
  writtenFileCount: number,
  deletedFileCount: number
) {
  const details = [
    createdDirectoryCount > 0
      ? `created ${createdDirectoryCount} director${createdDirectoryCount === 1 ? "y" : "ies"}`
      : null,
    writtenFileCount > 0
      ? `wrote ${writtenFileCount} file${writtenFileCount === 1 ? "" : "s"}`
      : null,
    deletedFileCount > 0
      ? `deleted ${deletedFileCount} file${deletedFileCount === 1 ? "" : "s"}`
      : null
  ].filter(Boolean);

  if (details.length === 0) {
    return "Applied the runtime workspace plan.";
  }

  return `Applied the runtime workspace plan: ${details.join(", ")}.`;
}
