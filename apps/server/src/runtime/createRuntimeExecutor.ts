import type {
  ExecuteRun,
  RepoMutationToolRequest,
  RepoMutationToolResult,
  RepoToolset
} from "@shipyard/agent-core";
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

    const toolResult = await executeToolRequest(options.repoToolset, run.toolRequest);

    if (!toolResult.ok) {
      const error = new Error(toolResult.error.message) as Error & {
        code?: string;
        toolName?: string;
        path?: string;
      };

      error.code = toolResult.error.code;
      error.toolName = toolResult.toolName;
      error.path = toolResult.error.path;

      throw error;
    }

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
        `Anchor: ${toolResult.data.anchor}`
      ].join("\n");
    case "create_file":
      return [`Tool: ${toolResult.toolName}`, `Path: ${toolResult.data.path}`].join("\n");
    case "delete_file":
      return [`Tool: ${toolResult.toolName}`, `Path: ${toolResult.data.path}`].join("\n");
  }
}
