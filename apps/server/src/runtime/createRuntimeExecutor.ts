import type {
  ExecuteRun,
  RepoMutationToolRequest,
  RepoMutationToolResult,
  RepoToolset,
  RollbackResult,
  ValidationResult
} from "@shipyard/agent-core";
import { getActiveTraceScope } from "@shipyard/agent-core";
import { generateText } from "ai";

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
        plannedStepId: context.plannedStep?.id ?? null
      }
    });

    const toolResult = await executeToolRequest(options.repoToolset, toolRequest).catch(
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
          validationStatus: toolResult.error.validationResult
            ? toolResult.error.validationResult.success
              ? "passed"
              : "failed"
            : null,
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
        path: toolResult.data.path,
        validationStatus: toolResult.data.validationResult.success ? "passed" : "failed",
        changedFiles: [toolResult.data.path]
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

function summarizeToolRequest(toolRequest: RepoMutationToolRequest) {
  const toolPath = extractToolPath(toolRequest);

  return toolPath
    ? `Invoke ${toolRequest.toolName} on ${toolPath}.`
    : `Invoke ${toolRequest.toolName}.`;
}

function extractToolPath(toolRequest: RepoMutationToolRequest) {
  return "path" in toolRequest.input && typeof toolRequest.input.path === "string"
    ? toolRequest.input.path
    : null;
}

async function executeToolRequest(
  repoToolset: RepoToolset,
  toolRequest: RepoMutationToolRequest
): Promise<RepoMutationToolResult> {
  switch (toolRequest.toolName) {
    case "edit_file_region":
      return repoToolset.editFileRegion(toolRequest.input);
    case "create_file":
      return repoToolset.createFile(toolRequest.input);
    case "delete_file":
      return repoToolset.deleteFile(toolRequest.input);
  }
}

function summarizeToolResult(toolResult: Extract<RepoMutationToolResult, { ok: true }>) {
  switch (toolResult.toolName) {
    case "edit_file_region":
      return `Edited ${toolResult.data.path} surgically around the provided anchor.`;
    case "create_file":
      return `Created ${toolResult.data.path}.`;
    case "delete_file":
      return `Deleted ${toolResult.data.path}.`;
  }
}

function renderToolResponse(toolResult: Extract<RepoMutationToolResult, { ok: true }>) {
  switch (toolResult.toolName) {
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
