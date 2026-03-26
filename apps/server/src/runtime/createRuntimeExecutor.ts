import type {
  ExecuteRun,
  RepoToolRequest,
  RepoToolResult,
  RepoToolset,
  RollbackResult,
  ValidationResult
} from "@shipyard/agent-core";
import { createRepoToolset, getActiveTraceScope } from "@shipyard/agent-core";
import { generateText } from "ai";
import path from "node:path";

import {
  createOpenAIExecutor,
  type OpenAIExecutorConfig
} from "./createOpenAIExecutor";

type CreateRuntimeExecutorOptions = {
  openAI: OpenAIExecutorConfig;
  repoToolset: RepoToolset;
  generateTextImpl?: typeof generateText;
};

export function createRuntimeExecutor(options: CreateRuntimeExecutorOptions): ExecuteRun {
  const openAIExecutor = createOpenAIExecutor({
    config: options.openAI,
    generateTextImpl: options.generateTextImpl
  });
  const repoToolsetsByRoot = new Map<string, RepoToolset>();

  return async (run, context) => {
    if (!run.toolRequest) {
      return openAIExecutor(run, context);
    }

    const toolRequest = run.toolRequest;
    const traceScope = getActiveTraceScope();
    const toolPath = extractToolPath(toolRequest);
    traceScope?.activeSpan.addEvent("tool_requested", {
      message: summarizeToolRequest(toolRequest),
      metadata: {
        toolName: toolRequest.toolName,
        path: toolPath,
        query:
          toolRequest.toolName === "search_repo"
            ? toolRequest.input.query
            : null,
        glob:
          toolRequest.toolName === "list_files" || toolRequest.toolName === "search_repo"
            ? toolRequest.input.glob ?? null
            : null,
        plannedStepId: context.plannedStep?.id ?? null
      }
    });

    const repoToolset = resolveRepoToolsetForRun(
      options.repoToolset,
      repoToolsetsByRoot,
      run
    );
    const toolResult = await executeToolRequest(repoToolset, toolRequest).catch(
      async (error) => {
        traceScope?.activeSpan.addEvent("tool_failed", {
          message: error instanceof Error ? error.message : String(error),
          metadata: {
            toolName: toolRequest.toolName,
            path: toolPath,
            plannedStepId: context.plannedStep?.id ?? null
          }
        });
        throw error;
      }
    );

    if (!toolResult.ok) {
      traceScope?.activeSpan.addEvent("tool_failed", {
        message: toolResult.error.message,
        metadata: {
          toolName: toolResult.toolName,
          path: toolResult.error.path ?? toolPath,
          validationStatus: extractToolValidationStatus(toolResult),
          rollbackAttempted: toolResult.error.rollback?.attempted ?? false,
          rollbackSucceeded: toolResult.error.rollback?.success ?? null,
          errorCode: toolResult.error.code ?? null
        }
      });

      const error = new Error(toolResult.error.message) as Error & {
        code?: string;
        toolName?: string;
        path?: string;
        validationResult?: ValidationResult | null;
        rollback?: RollbackResult | null;
      };

      error.code = toolResult.error.code;
      error.toolName = toolResult.toolName;
      error.path = toolResult.error.path;
      error.validationResult = toolResult.error.validationResult ?? null;
      error.rollback = toolResult.error.rollback ?? null;

      throw error;
    }

    traceScope?.activeSpan.addEvent("tool_completed", {
      message: summarizeToolResult(toolResult),
      metadata: {
        toolName: toolResult.toolName,
        path: extractToolResultPath(toolResult),
        validationStatus: extractToolValidationStatus(toolResult),
        changedFiles: extractChangedFiles(toolResult)
      }
    });

    return {
      mode: "repo-tool",
      summary: summarizeToolResult(toolResult),
      responseText: renderToolResponse(toolResult),
      instructionEcho: run.instruction,
      skillId: context.instructionRuntime.skill.meta.id,
      completedAt: new Date().toISOString(),
      toolResult
    };
  };
}

function resolveRepoToolsetForRun(
  defaultToolset: RepoToolset,
  cache: Map<string, RepoToolset>,
  run: Parameters<ExecuteRun>[0]
) {
  const runtimeFolder =
    run.project?.folder?.provider === "runtime" && run.project.folder.displayPath?.trim()
      ? path.resolve(run.project.folder.displayPath.trim())
      : null;

  if (!runtimeFolder) {
    return defaultToolset;
  }

  const cached = cache.get(runtimeFolder);

  if (cached) {
    return cached;
  }

  const toolset = createRepoToolset({
    rootDir: runtimeFolder
  });
  cache.set(runtimeFolder, toolset);

  return toolset;
}

function summarizeToolRequest(toolRequest: RepoToolRequest) {
  switch (toolRequest.toolName) {
    case "list_files":
      return toolRequest.input.glob
        ? `List files matching ${toolRequest.input.glob}.`
        : "List files in the repository.";
    case "search_repo":
      return `Search the repo for "${toolRequest.input.query}".`;
    default: {
      const toolPath = extractToolPath(toolRequest);

      return toolPath
        ? `Invoke ${toolRequest.toolName} on ${toolPath}.`
        : `Invoke ${toolRequest.toolName}.`;
    }
  }
}

function extractToolPath(toolRequest: RepoToolRequest) {
  return "path" in toolRequest.input && typeof toolRequest.input.path === "string"
    ? toolRequest.input.path
    : null;
}

async function executeToolRequest(
  repoToolset: RepoToolset,
  toolRequest: RepoToolRequest
): Promise<RepoToolResult> {
  switch (toolRequest.toolName) {
    case "list_files":
      return repoToolset.listFiles(toolRequest.input);
    case "read_file":
      return repoToolset.readFile(toolRequest.input);
    case "read_file_range":
      return repoToolset.readFileRange(toolRequest.input);
    case "search_repo":
      return repoToolset.searchRepo(toolRequest.input);
    case "edit_file_region":
      return repoToolset.editFileRegion(toolRequest.input);
    case "create_file":
      return repoToolset.createFile(toolRequest.input);
    case "delete_file":
      return repoToolset.deleteFile(toolRequest.input);
  }
}

function summarizeToolResult(toolResult: Extract<RepoToolResult, { ok: true }>) {
  switch (toolResult.toolName) {
    case "list_files":
      return `Listed ${toolResult.data.files.length} file${toolResult.data.files.length === 1 ? "" : "s"} from the repository.`;
    case "read_file":
      return `Read ${toolResult.data.path}.`;
    case "read_file_range":
      return `Read lines ${toolResult.data.startLine}-${toolResult.data.endLine} from ${toolResult.data.path}.`;
    case "search_repo":
      return `Found ${toolResult.data.matches.length} match${toolResult.data.matches.length === 1 ? "" : "es"} for "${toolResult.data.query}".`;
    case "edit_file_region":
      return `Edited ${toolResult.data.path} surgically around the provided anchor.`;
    case "create_file":
      return `Created ${toolResult.data.path}.`;
    case "delete_file":
      return `Deleted ${toolResult.data.path}.`;
  }
}

function renderToolResponse(toolResult: Extract<RepoToolResult, { ok: true }>) {
  switch (toolResult.toolName) {
    case "list_files":
      return [
        `Tool: ${toolResult.toolName}`,
        `Total files returned: ${toolResult.data.files.length}`,
        `Total files matched: ${toolResult.data.totalCount}`,
        `Glob: ${toolResult.data.glob ?? "(none)"}`,
        `Truncated: ${toolResult.data.truncated ? "yes" : "no"}`,
        "",
        ...toolResult.data.files.map((file) => `- ${file}`)
      ].join("\n");
    case "read_file":
      return [
        `Tool: ${toolResult.toolName}`,
        `Path: ${toolResult.data.path}`,
        `Line count: ${toolResult.data.lineCount}`,
        "",
        toolResult.data.content
      ].join("\n");
    case "read_file_range":
      return [
        `Tool: ${toolResult.toolName}`,
        `Path: ${toolResult.data.path}`,
        `Lines: ${toolResult.data.startLine}-${toolResult.data.endLine}`,
        `Total lines in file: ${toolResult.data.totalLineCount}`,
        "",
        toolResult.data.content
      ].join("\n");
    case "search_repo":
      return [
        `Tool: ${toolResult.toolName}`,
        `Query: ${toolResult.data.query}`,
        `Matches: ${toolResult.data.matches.length}`,
        `Glob: ${toolResult.data.glob ?? "(none)"}`,
        `Case sensitive: ${toolResult.data.caseSensitive ? "yes" : "no"}`,
        `Truncated: ${toolResult.data.truncated ? "yes" : "no"}`,
        "",
        ...toolResult.data.matches.map(
          (match) => `- ${match.path}:${match.lineNumber}:${match.column} ${match.lineText}`
        )
      ].join("\n");
    case "edit_file_region":
      return [
        `Tool: ${toolResult.toolName}`,
        `Path: ${toolResult.data.path}`,
        `Validation: change applied and unrelated regions preserved.`,
        `Validation status: ${toolResult.data.validationResult.success ? "passed" : "failed"}`,
        `Anchor: ${toolResult.data.anchor}`
      ].join("\n");
    case "create_file":
      return [
        `Tool: ${toolResult.toolName}`,
        `Path: ${toolResult.data.path}`,
        `Validation status: ${toolResult.data.validationResult.success ? "passed" : "failed"}`
      ].join("\n");
    case "delete_file":
      return [
        `Tool: ${toolResult.toolName}`,
        `Path: ${toolResult.data.path}`,
        `Validation status: ${toolResult.data.validationResult.success ? "passed" : "failed"}`
      ].join("\n");
  }
}

function extractToolResultPath(toolResult: Extract<RepoToolResult, { ok: true }>) {
  return "path" in toolResult.data && typeof toolResult.data.path === "string"
    ? toolResult.data.path
    : null;
}

function extractToolValidationStatus(toolResult: RepoToolResult) {
  if (!toolResult.ok) {
    return toolResult.error.validationResult
      ? toolResult.error.validationResult.success
        ? "passed"
        : "failed"
      : null;
  }

  if (
    "validationResult" in toolResult.data &&
    toolResult.data.validationResult &&
    typeof toolResult.data.validationResult === "object"
  ) {
    return toolResult.data.validationResult.success ? "passed" : "failed";
  }

  return null;
}

function extractChangedFiles(toolResult: Extract<RepoToolResult, { ok: true }>) {
  if (
    (toolResult.toolName === "edit_file_region" ||
      toolResult.toolName === "create_file" ||
      toolResult.toolName === "delete_file") &&
    "path" in toolResult.data &&
    typeof toolResult.data.path === "string"
  ) {
    return [toolResult.data.path];
  }

  return [];
}
