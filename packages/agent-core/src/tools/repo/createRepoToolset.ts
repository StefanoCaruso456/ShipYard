import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type {
  CreateFileInput,
  CreateFileResult,
  DeleteFileInput,
  DeleteFileResult,
  EditFileRegionInput,
  EditFileRegionResult,
  ListFilesInput,
  ListFilesResult,
  ReadFileInput,
  ReadFileRangeInput,
  ReadFileRangeResult,
  ReadFileResult,
  RepoToolError,
  RepoToolFailure,
  RepoToolName,
  RepoToolset,
  SearchRepoInput,
  SearchRepoResult
} from "./types";
import { applyAnchoredEdit } from "./editing/applyAnchoredEdit";
import { commitTextFileMutation } from "./editing/commitTextFileMutation";
import { validateEditedFile } from "./editing/validateEditedFile";

type CreateRepoToolsetOptions = {
  rootDir?: string;
  defaultListLimit?: number;
  defaultSearchLimit?: number;
};

type RgRunResult =
  | {
      kind: "completed";
      stdout: string;
      stderr: string;
      exitCode: number;
    }
  | {
      kind: "missing_binary";
    }
  | {
      kind: "spawn_error";
      message: string;
    };

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 100;
const MAX_TOOL_LIMIT = 1000;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".shipyard",
  ".vercel",
  "coverage",
  "dist",
  "node_modules"
]);

export function createRepoToolset(options: CreateRepoToolsetOptions = {}): RepoToolset {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const defaultListLimit = options.defaultListLimit ?? DEFAULT_LIST_LIMIT;
  const defaultSearchLimit = options.defaultSearchLimit ?? DEFAULT_SEARCH_LIMIT;

  return {
    rootDir,
    async listFiles(input = {}) {
      const limit = normalizeLimit(input.limit, defaultListLimit);

      if (typeof limit !== "number") {
        return fail("list_files", limit);
      }

      if (input.glob !== undefined && !input.glob.trim()) {
        return fail("list_files", invalidInput("glob must be a non-empty string when provided."));
      }

      const matcher = input.glob ? createGlobMatcher(input.glob) : null;
      const rgResult = await runRipgrep(["--files", rootDir], rootDir);

      let files: string[];

      if (rgResult.kind === "completed") {
        if (rgResult.exitCode !== 0) {
          return fail(
            "list_files",
            commandFailed("rg --files", rgResult.stderr || "ripgrep failed while listing files.")
          );
        }

        files = rgResult.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((entry) => normalizeRelativePath(rootDir, entry))
          .filter((entry) => !matcher || matcher.test(entry));
      } else if (rgResult.kind === "missing_binary") {
        files = await walkRepoFiles(rootDir, input.glob);
      } else {
        return fail("list_files", commandFailed("rg --files", rgResult.message));
      }

      files.sort();

      return {
        ok: true,
        toolName: "list_files",
        data: {
          rootDir,
          glob: input.glob ?? null,
          files: files.slice(0, limit),
          totalCount: files.length,
          truncated: files.length > limit
        }
      };
    },
    async readFile(input) {
      const repoPath = resolveRepoPath(rootDir, input.path);

      if (!repoPath.ok) {
        return fail("read_file", repoPath.error);
      }

      const fileResult = await readRepoFile(repoPath.resolvedPath);

      if (!fileResult.ok) {
        return fail("read_file", {
          ...fileResult.error,
          path: repoPath.relativePath
        });
      }

      return {
        ok: true,
        toolName: "read_file",
        data: {
          rootDir,
          path: repoPath.relativePath,
          content: fileResult.content,
          lineCount: toLines(fileResult.content).length
        }
      };
    },
    async readFileRange(input) {
      const validatedRange = validateRange(input);

      if (!validatedRange.ok) {
        return fail("read_file_range", validatedRange.error);
      }

      const fileResult = await this.readFile({
        path: input.path
      });

      if (!fileResult.ok) {
        return fail("read_file_range", fileResult.error);
      }

      const lines = toLines(fileResult.data.content);

      if (validatedRange.value.startLine > lines.length) {
        return fail(
          "read_file_range",
          invalidInput(
            `startLine ${validatedRange.value.startLine} is outside the file's ${lines.length} line(s).`,
            fileResult.data.path
          )
        );
      }

      const selectedLines = lines.slice(
        validatedRange.value.startLine - 1,
        validatedRange.value.endLine
      );

      return {
        ok: true,
        toolName: "read_file_range",
        data: {
          rootDir,
          path: fileResult.data.path,
          startLine: validatedRange.value.startLine,
          endLine: validatedRange.value.endLine,
          totalLineCount: lines.length,
          lines: selectedLines.map((content, index) => ({
            lineNumber: validatedRange.value.startLine + index,
            content
          })),
          content: selectedLines.join("\n")
        }
      };
    },
    async searchRepo(input) {
      const validatedInput = validateSearchInput(input, defaultSearchLimit);

      if (!validatedInput.ok) {
        return fail("search_repo", validatedInput.error);
      }

      const normalizedInput = validatedInput.value;
      const rgResult = await runRipgrep(
        [
          "--json",
          "--fixed-strings",
          "--line-number",
          normalizedInput.caseSensitive ? "--case-sensitive" : "--ignore-case",
          normalizedInput.query,
          rootDir
        ],
        rootDir
      );

      if (rgResult.kind === "completed") {
        if (rgResult.exitCode !== 0 && rgResult.exitCode !== 1) {
          return fail(
            "search_repo",
            commandFailed("rg --json", rgResult.stderr || "ripgrep failed while searching.")
          );
        }

        const matcher = normalizedInput.glob ? createGlobMatcher(normalizedInput.glob) : null;
        const allMatches = parseRipgrepMatches(rgResult.stdout, rootDir).filter(
          (match) => !matcher || matcher.test(match.path)
        );

        return {
          ok: true,
          toolName: "search_repo",
          data: {
            rootDir,
            query: normalizedInput.query,
            glob: normalizedInput.glob ?? null,
            caseSensitive: normalizedInput.caseSensitive,
            matches: allMatches.slice(0, normalizedInput.limit),
            truncated: allMatches.length > normalizedInput.limit
          }
        };
      }

      if (rgResult.kind === "spawn_error") {
        return fail("search_repo", commandFailed("rg --json", rgResult.message));
      }

      const fallbackMatches = await searchRepoFallback(rootDir, normalizedInput);

      return {
        ok: true,
        toolName: "search_repo",
        data: {
          rootDir,
          query: normalizedInput.query,
          glob: normalizedInput.glob ?? null,
          caseSensitive: normalizedInput.caseSensitive,
          matches: fallbackMatches.matches,
          truncated: fallbackMatches.truncated
        }
      };
    },
    async editFileRegion(input) {
      const validatedInput = validateEditFileRegionInput(input);

      if (!validatedInput.ok) {
        return fail("edit_file_region", validatedInput.error);
      }

      const repoPath = resolveRepoPath(rootDir, validatedInput.value.path);

      if (!repoPath.ok) {
        return fail("edit_file_region", repoPath.error);
      }

      const fileResult = await readRepoFile(repoPath.resolvedPath);

      if (!fileResult.ok) {
        return fail("edit_file_region", {
          ...fileResult.error,
          path: repoPath.relativePath
        });
      }

      const anchoredEdit = applyAnchoredEdit({
        source: fileResult.content,
        anchor: validatedInput.value.anchor,
        currentText: validatedInput.value.currentText,
        replacementText: validatedInput.value.replacementText
      });

      if (!anchoredEdit.ok) {
        return fail("edit_file_region", {
          ...anchoredEdit.error,
          path: repoPath.relativePath
        });
      }

      const mutationResult = await commitTextFileMutation({
        resolvedPath: repoPath.resolvedPath,
        originalContent: fileResult.content,
        nextContent: anchoredEdit.updatedContent,
        validate(updatedContent) {
          return validateEditedFile({
            originalContent: fileResult.content,
            updatedContent,
            replacementText: validatedInput.value.replacementText,
            targetRange: anchoredEdit.targetRange
          });
        }
      });

      if (!mutationResult.ok) {
        return fail("edit_file_region", {
          ...mutationResult.error,
          path: repoPath.relativePath
        });
      }

      return {
        ok: true,
        toolName: "edit_file_region",
        data: {
          rootDir,
          path: repoPath.relativePath,
          status: "success",
          anchor: validatedInput.value.anchor,
          validation: mutationResult.validation,
          changedRegion: {
            startOffset: anchoredEdit.targetRange.startOffset,
            endOffset: anchoredEdit.targetRange.endOffset,
            before: validatedInput.value.currentText,
            after: validatedInput.value.replacementText
          }
        }
      };
    },
    async createFile(input) {
      const validatedInput = validateCreateFileInput(input);

      if (!validatedInput.ok) {
        return fail("create_file", validatedInput.error);
      }

      const repoPath = resolveRepoPath(rootDir, validatedInput.value.path);

      if (!repoPath.ok) {
        return fail("create_file", repoPath.error);
      }

      try {
        await mkdir(path.dirname(repoPath.resolvedPath), { recursive: true });
        await writeFile(repoPath.resolvedPath, validatedInput.value.content, {
          encoding: "utf8",
          flag: "wx"
        });
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;

        if (nodeError.code === "EEXIST") {
          return fail(
            "create_file",
            alreadyExists(
              `File already exists: ${repoPath.relativePath}`,
              repoPath.relativePath
            )
          );
        }

        return fail(
          "create_file",
          writeFailed(
            error instanceof Error ? error.message : "Failed to create the file.",
            repoPath.relativePath
          )
        );
      }

      const fileResult = await readRepoFile(repoPath.resolvedPath);

      if (!fileResult.ok) {
        return fail("create_file", {
          ...fileResult.error,
          path: repoPath.relativePath
        });
      }

      if (fileResult.content !== validatedInput.value.content) {
        await deleteCreatedFile(repoPath.resolvedPath);

        return fail(
          "create_file",
          validationFailed(
            "Created file content did not match the requested content after re-read.",
            repoPath.relativePath
          )
        );
      }

      return {
        ok: true,
        toolName: "create_file",
        data: {
          rootDir,
          path: repoPath.relativePath,
          status: "success",
          lineCount: toLines(fileResult.content).length
        }
      };
    },
    async deleteFile(input) {
      const validatedInput = validateDeleteFileInput(input);

      if (!validatedInput.ok) {
        return fail("delete_file", validatedInput.error);
      }

      const repoPath = resolveRepoPath(rootDir, validatedInput.value.path);

      if (!repoPath.ok) {
        return fail("delete_file", repoPath.error);
      }

      try {
        await unlink(repoPath.resolvedPath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;

        if (nodeError.code === "ENOENT") {
          return fail(
            "delete_file",
            notFound(`File not found: ${repoPath.relativePath}`, repoPath.relativePath)
          );
        }

        return fail(
          "delete_file",
          writeFailed(
            error instanceof Error ? error.message : "Failed to delete the file.",
            repoPath.relativePath
          )
        );
      }

      const fileResult = await readRepoFile(repoPath.resolvedPath);

      if (fileResult.ok) {
        return fail(
          "delete_file",
          validationFailed(
            "Deleted file is still present after the delete operation.",
            repoPath.relativePath
          )
        );
      }

      if (fileResult.error.code !== "not_found") {
        return fail("delete_file", {
          ...fileResult.error,
          path: repoPath.relativePath
        });
      }

      return {
        ok: true,
        toolName: "delete_file",
        data: {
          rootDir,
          path: repoPath.relativePath,
          status: "success"
        }
      };
    }
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number | RepoToolError {
  const limit = value ?? fallback;

  if (!Number.isInteger(limit) || limit <= 0) {
    return invalidInput("limit must be a positive integer.");
  }

  if (limit > MAX_TOOL_LIMIT) {
    return invalidInput(`limit must be ${MAX_TOOL_LIMIT} or smaller.`);
  }

  return limit;
}

function validateRange(
  input: ReadFileRangeInput
):
  | {
      ok: true;
      value: {
        startLine: number;
        endLine: number;
      };
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (!Number.isInteger(input.startLine) || input.startLine <= 0) {
    return {
      ok: false,
      error: invalidInput("startLine must be a positive integer.", input.path)
    };
  }

  if (!Number.isInteger(input.endLine) || input.endLine <= 0) {
    return {
      ok: false,
      error: invalidInput("endLine must be a positive integer.", input.path)
    };
  }

  if (input.endLine < input.startLine) {
    return {
      ok: false,
      error: invalidInput("endLine must be greater than or equal to startLine.", input.path)
    };
  }

  return {
    ok: true,
    value: {
      startLine: input.startLine,
      endLine: input.endLine
    }
  };
}

function validateSearchInput(
  input: SearchRepoInput,
  defaultSearchLimit: number
):
  | {
      ok: true;
      value: {
        query: string;
        glob?: string;
        limit: number;
        caseSensitive: boolean;
      };
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (!input.query.trim()) {
    return {
      ok: false,
      error: invalidInput("query must be a non-empty string.")
    };
  }

  if (input.glob !== undefined && !input.glob.trim()) {
    return {
      ok: false,
      error: invalidInput("glob must be a non-empty string when provided.")
    };
  }

  const limit = normalizeLimit(input.limit, defaultSearchLimit);

  if (typeof limit !== "number") {
    return {
      ok: false,
      error: limit
    };
  }

  return {
    ok: true,
    value: {
      query: input.query,
      glob: input.glob,
      limit,
      caseSensitive: input.caseSensitive ?? false
    }
  };
}

function validateEditFileRegionInput(
  input: EditFileRegionInput
):
  | {
      ok: true;
      value: EditFileRegionInput;
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (typeof input.path !== "string" || !input.path.trim()) {
    return {
      ok: false,
      error: invalidInput("path must be a non-empty string.")
    };
  }

  if (typeof input.anchor !== "string" || !input.anchor.trim()) {
    return {
      ok: false,
      error: invalidInput("anchor must be a non-empty string.", input.path)
    };
  }

  if (typeof input.currentText !== "string" || !input.currentText.trim()) {
    return {
      ok: false,
      error: invalidInput("currentText must be a non-empty string.", input.path)
    };
  }

  if (typeof input.replacementText !== "string") {
    return {
      ok: false,
      error: invalidInput("replacementText must be a string.", input.path)
    };
  }

  return {
    ok: true,
    value: input
  };
}

function validateCreateFileInput(
  input: CreateFileInput
):
  | {
      ok: true;
      value: CreateFileInput;
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (typeof input.path !== "string" || !input.path.trim()) {
    return {
      ok: false,
      error: invalidInput("path must be a non-empty string.")
    };
  }

  if (typeof input.content !== "string") {
    return {
      ok: false,
      error: invalidInput("content must be a string.", input.path)
    };
  }

  return {
    ok: true,
    value: input
  };
}

function validateDeleteFileInput(
  input: DeleteFileInput
):
  | {
      ok: true;
      value: DeleteFileInput;
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (typeof input.path !== "string" || !input.path.trim()) {
    return {
      ok: false,
      error: invalidInput("path must be a non-empty string.")
    };
  }

  return {
    ok: true,
    value: input
  };
}

async function readRepoFile(
  resolvedPath: string
):
  Promise<
    | {
        ok: true;
        content: string;
      }
    | {
        ok: false;
        error: RepoToolError;
      }
  > {
  let buffer: Buffer;

  try {
    buffer = await readFile(resolvedPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `File not found: ${resolvedPath}`
        }
      };
    }

    return {
      ok: false,
      error: {
        code: "io_error",
        message:
          error instanceof Error ? error.message : `Failed to read file: ${resolvedPath}`
      }
    };
  }

  if (buffer.includes(0)) {
    return {
      ok: false,
      error: {
        code: "binary_file",
        message: `File appears to be binary and cannot be read as text: ${resolvedPath}`
      }
    };
  }

  return {
    ok: true,
    content: buffer.toString("utf8")
  };
}

function resolveRepoPath(
  rootDir: string,
  requestedPath: string
):
  | {
      ok: true;
      resolvedPath: string;
      relativePath: string;
    }
  | {
      ok: false;
      error: RepoToolError;
    } {
  if (!requestedPath.trim()) {
    return {
      ok: false,
      error: invalidInput("path must be a non-empty string.")
    };
  }

  const resolvedPath = path.resolve(rootDir, requestedPath);
  const relativePath = path.relative(rootDir, resolvedPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return {
      ok: false,
      error: outsideRoot(
        `Path ${requestedPath} resolves outside the repository root.`,
        requestedPath
      )
    };
  }

  return {
    ok: true,
    resolvedPath,
    relativePath: normalizePathSeparators(relativePath)
  };
}

async function runRipgrep(args: string[], cwd: string): Promise<RgRunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("rg", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;

      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code === "ENOENT") {
        resolve({
          kind: "missing_binary"
        });
        return;
      }

      resolve({
        kind: "spawn_error",
        message: error instanceof Error ? error.message : "Failed to spawn ripgrep."
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        kind: "completed",
        stdout,
        stderr,
        exitCode: exitCode ?? -1
      });
    });
  });
}

async function walkRepoFiles(rootDir: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  const matcher = glob ? createGlobMatcher(glob) : null;

  async function visitDirectory(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
      }

      const nextPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        await visitDirectory(nextPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizeRelativePath(rootDir, nextPath);

      if (!matcher || matcher.test(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  await visitDirectory(rootDir);

  return files;
}

async function searchRepoFallback(
  rootDir: string,
  input: {
    query: string;
    glob?: string;
    limit: number;
    caseSensitive: boolean;
  }
) {
  const files = await walkRepoFiles(rootDir, input.glob);
  const matches: Array<{
    path: string;
    lineNumber: number;
    column: number;
    lineText: string;
  }> = [];
  const searchQuery = input.caseSensitive ? input.query : input.query.toLowerCase();
  let truncated = false;

  for (const relativePath of files) {
    const fileResult = await readRepoFile(path.resolve(rootDir, relativePath));

    if (!fileResult.ok) {
      continue;
    }

    const lines = toLines(fileResult.content);

    for (const [index, line] of lines.entries()) {
      const haystack = input.caseSensitive ? line : line.toLowerCase();
      let searchIndex = 0;

      while (searchIndex <= haystack.length) {
        const foundAt = haystack.indexOf(searchQuery, searchIndex);

        if (foundAt === -1) {
          break;
        }

        matches.push({
          path: relativePath,
          lineNumber: index + 1,
          column: foundAt + 1,
          lineText: line
        });

        if (matches.length >= input.limit) {
          truncated = true;
          return {
            matches,
            truncated
          };
        }

        searchIndex = foundAt + Math.max(searchQuery.length, 1);
      }
    }
  }

  return {
    matches,
    truncated
  };
}

function parseRipgrepMatches(stdout: string, rootDir: string) {
  const matches: Array<{
    path: string;
    lineNumber: number;
    column: number;
    lineText: string;
  }> = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parsed = JSON.parse(line) as {
      type?: string;
      data?: {
        path?: {
          text?: string;
        };
        line_number?: number;
        lines?: {
          text?: string;
        };
        submatches?: Array<{
          start?: number;
        }>;
      };
    };

    if (parsed.type !== "match") {
      continue;
    }

    const pathText = parsed.data?.path?.text;
    const lineText = parsed.data?.lines?.text;
    const lineNumber = parsed.data?.line_number;
    const column = (parsed.data?.submatches?.[0]?.start ?? 0) + 1;

    if (!pathText || typeof lineText !== "string" || typeof lineNumber !== "number") {
      continue;
    }

    matches.push({
      path: normalizeRelativePath(rootDir, pathText),
      lineNumber,
      column,
      lineText: lineText.replace(/\r?\n$/, "")
    });
  }

  return matches;
}

function normalizeRelativePath(rootDir: string, filePath: string) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  return normalizePathSeparators(path.relative(rootDir, resolvedPath));
}

function normalizePathSeparators(value: string) {
  return value.split(path.sep).join("/");
}

function toLines(content: string) {
  return content === "" ? [] : content.split(/\r?\n/);
}

function invalidInput(message: string, pathValue?: string): RepoToolError {
  return {
    code: "invalid_input",
    message,
    path: pathValue
  };
}

function validationFailed(message: string, pathValue?: string): RepoToolError {
  return {
    code: "validation_failed",
    message,
    path: pathValue
  };
}

function outsideRoot(message: string, pathValue?: string): RepoToolError {
  return {
    code: "outside_root",
    message,
    path: pathValue
  };
}

function writeFailed(message: string, pathValue?: string): RepoToolError {
  return {
    code: "write_failed",
    message,
    path: pathValue
  };
}

function commandFailed(command: string, message: string): RepoToolError {
  return {
    code: "command_failed",
    message,
    command
  };
}

function alreadyExists(message: string, pathValue?: string): RepoToolError {
  return {
    code: "already_exists",
    message,
    path: pathValue
  };
}

function notFound(message: string, pathValue?: string): RepoToolError {
  return {
    code: "not_found",
    message,
    path: pathValue
  };
}

function fail<Name extends RepoToolName>(
  toolName: Name,
  error: RepoToolError
): RepoToolFailure<Name> {
  return {
    ok: false,
    toolName,
    error
  };
}

function createGlobMatcher(glob: string) {
  const normalizedGlob = normalizePathSeparators(glob);
  const pattern = normalizedGlob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "::DOUBLE_STAR::");
  const expression = pattern
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*")
    .replace(/\?/g, "[^/]");

  return new RegExp(`^${expression}$`);
}

async function deleteCreatedFile(resolvedPath: string) {
  try {
    await unlink(resolvedPath);
  } catch {
    return;
  }
}
