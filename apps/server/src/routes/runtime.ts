import type { Express, Request } from "express";

import type {
  AgentRunRecord,
  PersistentAgentRuntimeService,
  SubmitTaskInput
} from "@shipyard/agent-core";

import type { OpenAIExecutorConfig } from "../runtime/createOpenAIExecutor";

export function registerRuntimeRoutes(
  app: Express,
  runtimeService: PersistentAgentRuntimeService,
  openAI: OpenAIExecutorConfig
) {
  app.get("/api/runtime/status", (_request, response) => {
    response.json({
      ...runtimeService.getStatus(),
      model: serializeOpenAIConfig(openAI)
    });
  });

  app.post("/api/runtime/tasks", (request, response) => {
    const submission = parseTaskSubmission(request);

    if ("error" in submission) {
      response.status(400).json(submission);
      return;
    }

    const task = runtimeService.submitTask(submission);

    response.status(202).json({
      task: serializeRun(task)
    });
  });

  app.get("/api/runtime/tasks/:id", (request, response) => {
    const task = runtimeService.getRun(request.params.id);

    if (!task) {
      response.status(404).json({
        error: `Task ${request.params.id} not found.`
      });
      return;
    }

    response.json({
      task: serializeRun(task)
    });
  });

  app.get("/api/runtime/tasks", (_request, response) => {
    const tasks = runtimeService.listRuns().map(serializeRun);

    response.json({
      total: tasks.length,
      tasks
    });
  });

  app.get("/api/runtime/instructions/skill", (_request, response) => {
    const agentRuntime = runtimeService.instructionRuntime;

    response.json({
      loadedAt: agentRuntime.loadedAt,
      instructionPrecedence: agentRuntime.instructionPrecedence,
      skill: {
        sourcePath: agentRuntime.skill.sourcePath,
        meta: agentRuntime.skill.meta,
        sectionCount: agentRuntime.skill.sections.length,
        sections: agentRuntime.skill.sections.map((section) => ({
          id: section.id,
          title: section.title,
          depth: section.depth,
          path: section.path
        }))
      },
      roleViews: Object.fromEntries(
        Object.entries(agentRuntime.roleViews).map(([role, view]) => [
          role,
          {
            sectionIds: view.sectionIds,
            sections: view.sections.map((section) => ({
              id: section.id,
              title: section.title,
              path: section.path
            })),
            renderedText: view.renderedText
          }
        ])
      )
    });
  });
}

function serializeOpenAIConfig(openAI: OpenAIExecutorConfig) {
  return {
    provider: openAI.provider,
    configured: openAI.configured,
    modelId: openAI.modelId,
    apiKeySource: openAI.apiKeySource
  };
}

function parseTaskSubmission(request: Request): SubmitTaskInput | { error: string } {
  const body = request.body as {
    instruction?: unknown;
    title?: unknown;
    simulateFailure?: unknown;
  };

  if (typeof body?.instruction !== "string" || !body.instruction.trim()) {
    return {
      error: "Task instruction is required."
    };
  }

  if (body.title !== undefined && typeof body.title !== "string") {
    return {
      error: "Task title must be a string when provided."
    };
  }

  if (body.simulateFailure !== undefined && typeof body.simulateFailure !== "boolean") {
    return {
      error: "simulateFailure must be a boolean when provided."
    };
  }

  return {
    instruction: body.instruction,
    title: body.title,
    simulateFailure: body.simulateFailure
  };
}

function serializeRun(run: AgentRunRecord) {
  return {
    id: run.id,
    title: run.title,
    instruction: run.instruction,
    simulateFailure: run.simulateFailure,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    result: run.result
  };
}
