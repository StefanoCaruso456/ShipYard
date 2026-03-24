import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";

import type {
  AgentRunRecord,
  AgentRole,
  ContextAssembler,
  PersistentAgentRuntimeService,
  RepoMutationToolRequest,
  SubmitTaskInput,
  TraceService,
  ValidationGate,
  ValidationGateKind
} from "@shipyard/agent-core";

import type { OpenAIExecutorConfig } from "../runtime/createOpenAIExecutor";
import { analyzeTaskAttachments } from "../runtime/analyzeTaskAttachments";
import {
  AudioTranscriptionError,
  type AudioTranscriptionConfig,
  type createAudioTranscriber
} from "../runtime/createAudioTranscriber";

type RuntimeTaskRequest = Request & {
  files?: Express.Multer.File[];
};

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 15 * 1024 * 1024
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 25 * 1024 * 1024
  }
});

export function registerRuntimeRoutes(
  app: Express,
  runtimeService: PersistentAgentRuntimeService,
  openAI: OpenAIExecutorConfig,
  audioTranscriber: ReturnType<typeof createAudioTranscriber>,
  contextAssembler?: ContextAssembler,
  traceService?: TraceService
) {
  app.get("/api/runtime/status", (_request, response) => {
    response.json({
      ...runtimeService.getStatus(),
      model: serializeOpenAIConfig(openAI),
      audioTranscription: serializeAudioTranscriptionConfig(audioTranscriber.config),
      observability: traceService?.status ?? null
    });
  });

  app.post("/api/runtime/audio/transcriptions", parseAudioUpload, async (request, response) => {
    const audioFile = Array.isArray((request as RuntimeTaskRequest).files)
      ? (request as RuntimeTaskRequest).files?.[0] ?? null
      : null;

    if (!audioFile) {
      response.status(400).json({
        error: "An audio file is required."
      });
      return;
    }

    if (!looksLikeAudioFile(audioFile)) {
      response.status(400).json({
        error: "Only audio uploads are supported on this route."
      });
      return;
    }

    const prompt =
      typeof request.body?.prompt === "string" && request.body.prompt.trim()
        ? request.body.prompt.trim()
        : undefined;
    const language =
      typeof request.body?.language === "string" && request.body.language.trim()
        ? request.body.language.trim()
        : undefined;

    try {
      const transcription = await audioTranscriber.transcribe({
        fileName: audioFile.originalname,
        mimeType: audioFile.mimetype || null,
        buffer: audioFile.buffer,
        prompt,
        language
      });

      response.status(200).json({
        transcription: {
          text: transcription.text,
          summary: transcription.summary,
          excerpt: transcription.excerpt,
          language: transcription.language,
          model: {
            provider: transcription.provider,
            modelId: transcription.modelId
          },
          file: {
            name: audioFile.originalname,
            mimeType: audioFile.mimetype || null,
            size: audioFile.size
          }
        }
      });
    } catch (error) {
      if (error instanceof AudioTranscriptionError) {
        response.status(error.statusCode).json({
          error: error.message
        });
        return;
      }

      response.status(500).json({
        error: error instanceof Error ? error.message : "Audio transcription failed."
      });
    }
  });

  app.post("/api/runtime/tasks", parseMultipartAttachments, (request, response) => {
    const submission = parseTaskSubmission(request as RuntimeTaskRequest);

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

  app.get("/api/runtime/context/:role/:id", (request, response) => {
    if (!contextAssembler) {
      response.status(503).json({
        error: "Runtime context assembler is not available."
      });
      return;
    }

    const role = parseRole(request.params.role);

    if (!role) {
      response.status(400).json({
        error: "role must be planner, executor, or verifier."
      });
      return;
    }

    const task = runtimeService.getRun(request.params.id);

    if (!task) {
      response.status(404).json({
        error: `Task ${request.params.id} not found.`
      });
      return;
    }

    response.json({
      taskId: task.id,
      role,
      payload: contextAssembler.buildRolePayload(role, {
        run: task,
        runtimeStatus: runtimeService.getStatus()
      })
    });
  });

  app.get("/api/runtime/traces/:id", (request, response) => {
    if (!traceService) {
      response.status(503).json({
        error: "Runtime trace service is not available."
      });
      return;
    }

    const trace = traceService.getRunTrace(request.params.id);

    if (!trace) {
      response.status(404).json({
        error: `Trace for task ${request.params.id} not found.`
      });
      return;
    }

    response.json({
      runId: request.params.id,
      observability: traceService.status,
      trace
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

function serializeAudioTranscriptionConfig(config: AudioTranscriptionConfig) {
  return {
    provider: config.provider,
    configured: config.configured,
    modelId: config.modelId,
    apiKeySource: config.apiKeySource
  };
}

function parseMultipartAttachments(request: Request, response: Response, next: NextFunction) {
  if (!request.is("multipart/form-data")) {
    next();
    return;
  }

  attachmentUpload.array("attachments", 8)(request, response, (error) => {
    if (!error) {
      next();
      return;
    }

    response.status(400).json({
      error: error instanceof Error ? error.message : "Attachment upload failed."
    });
  });
}

function parseAudioUpload(request: Request, response: Response, next: NextFunction) {
  if (!request.is("multipart/form-data")) {
    response.status(400).json({
      error: "Audio uploads must use multipart/form-data."
    });
    return;
  }

  audioUpload.array("audio", 1)(request, response, (error) => {
    if (!error) {
      next();
      return;
    }

    response.status(400).json({
      error: error instanceof Error ? error.message : "Audio upload failed."
    });
  });
}

function parseTaskSubmission(request: RuntimeTaskRequest): SubmitTaskInput | { error: string } {
  const body = request.body as {
    instruction?: unknown;
    title?: unknown;
    simulateFailure?: unknown;
    toolRequest?: unknown;
    context?: unknown;
    phaseExecution?: unknown;
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

  const simulateFailure = parseBooleanField(body.simulateFailure);

  if (body.simulateFailure !== undefined && simulateFailure === null) {
    return {
      error: "simulateFailure must be a boolean when provided."
    };
  }

  const toolRequest = parseToolRequest(parseUnknownJson(body.toolRequest));

  if ("error" in toolRequest) {
    return toolRequest;
  }

  const context = parseRunContextInput(parseUnknownJson(body.context));

  if ("error" in context) {
    return context;
  }

  const phaseExecution = parsePhaseExecutionInput(parseUnknownJson(body.phaseExecution));

  if ("error" in phaseExecution) {
    return phaseExecution;
  }

  return {
    instruction: body.instruction,
    title: body.title,
    simulateFailure: simulateFailure ?? false,
    toolRequest: toolRequest.value,
    attachments: analyzeTaskAttachments(
      Array.isArray(request.files)
        ? request.files.map((file) => ({
            name: file.originalname,
            mimeType: file.mimetype || null,
            size: file.size,
            buffer: file.buffer
          }))
        : []
    ),
    context: context.value,
    phaseExecution: phaseExecution.value
  };
}

function serializeRun(run: AgentRunRecord) {
  return {
    id: run.id,
    title: run.title,
    instruction: run.instruction,
    simulateFailure: run.simulateFailure,
    toolRequest: run.toolRequest,
    attachments: run.attachments,
    context: run.context,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    retryCount: run.retryCount,
    validationStatus: run.validationStatus,
    lastValidationResult: run.lastValidationResult,
    orchestration: run.orchestration,
    phaseExecution: run.phaseExecution ?? null,
    rollingSummary: run.rollingSummary,
    events: run.events,
    error: run.error,
    result: run.result
  };
}

function parseRole(value: string): AgentRole | null {
  return value === "planner" || value === "executor" || value === "verifier" ? value : null;
}

function parseUnknownJson(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function looksLikeAudioFile(file: { originalname: string; mimetype: string }) {
  if (file.mimetype?.toLowerCase().startsWith("audio/")) {
    return true;
  }

  return /\.(mp3|mp4|m4a|wav|webm|ogg|oga)$/i.test(file.originalname);
}

function parseBooleanField(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return null;
}

function parseRunContextInput(value: unknown): { value: SubmitTaskInput["context"] } | { error: string } {
  if (value === undefined || value === null) {
    return {
      value: null
    };
  }

  if (!value || typeof value !== "object") {
    return {
      error: "context must be an object when provided."
    };
  }

  const candidate = value as {
    objective?: unknown;
    constraints?: unknown;
    relevantFiles?: unknown;
    validationTargets?: unknown;
  };

  if (candidate.objective !== undefined && typeof candidate.objective !== "string") {
    return {
      error: "context.objective must be a string when provided."
    };
  }

  if (
    candidate.constraints !== undefined &&
    (!Array.isArray(candidate.constraints) ||
      candidate.constraints.some((constraint) => typeof constraint !== "string"))
  ) {
    return {
      error: "context.constraints must be an array of strings when provided."
    };
  }

  if (
    candidate.validationTargets !== undefined &&
    (!Array.isArray(candidate.validationTargets) ||
      candidate.validationTargets.some((target) => typeof target !== "string"))
  ) {
    return {
      error: "context.validationTargets must be an array of strings when provided."
    };
  }

  if (candidate.relevantFiles !== undefined) {
    if (!Array.isArray(candidate.relevantFiles)) {
      return {
        error: "context.relevantFiles must be an array when provided."
      };
    }

    for (const file of candidate.relevantFiles) {
      if (!file || typeof file !== "object") {
        return {
          error: "Each context.relevantFiles entry must be an object."
        };
      }

      const entry = file as {
        path?: unknown;
        excerpt?: unknown;
        startLine?: unknown;
        endLine?: unknown;
        source?: unknown;
        reason?: unknown;
      };

      if (typeof entry.path !== "string") {
        return {
          error: "Each context.relevantFiles entry requires a string path."
        };
      }

      if (entry.excerpt !== undefined && typeof entry.excerpt !== "string") {
        return {
          error: "context.relevantFiles.excerpt must be a string when provided."
        };
      }

      if (entry.startLine !== undefined && typeof entry.startLine !== "number") {
        return {
          error: "context.relevantFiles.startLine must be a number when provided."
        };
      }

      if (entry.endLine !== undefined && typeof entry.endLine !== "number") {
        return {
          error: "context.relevantFiles.endLine must be a number when provided."
        };
      }

      if (entry.source !== undefined && typeof entry.source !== "string") {
        return {
          error: "context.relevantFiles.source must be a string when provided."
        };
      }

      if (entry.reason !== undefined && typeof entry.reason !== "string") {
        return {
          error: "context.relevantFiles.reason must be a string when provided."
        };
      }
    }
  }

  return {
    value: {
      objective: candidate.objective as string | undefined,
      constraints: (candidate.constraints as string[] | undefined) ?? [],
      relevantFiles:
        (candidate.relevantFiles as NonNullable<SubmitTaskInput["context"]>["relevantFiles"] | undefined) ??
        [],
      validationTargets: (candidate.validationTargets as string[] | undefined) ?? []
    }
  };
}

function parseToolRequest(
  value: unknown
): { value: RepoMutationToolRequest | null } | { error: string } {
  if (value === undefined || value === null) {
    return {
      value: null
    };
  }

  if (!value || typeof value !== "object") {
    return {
      error: "toolRequest must be an object when provided."
    };
  }

  const candidate = value as {
    toolName?: unknown;
    input?: unknown;
  };

  if (candidate.toolName === "edit_file_region") {
    const input = candidate.input as {
      path?: unknown;
      anchor?: unknown;
      currentText?: unknown;
      replacementText?: unknown;
    };

    if (
      typeof input?.path !== "string" ||
      typeof input.anchor !== "string" ||
      typeof input.currentText !== "string" ||
      typeof input.replacementText !== "string"
    ) {
      return {
        error:
          "edit_file_region requires string path, anchor, currentText, and replacementText fields."
      };
    }

    return {
      value: {
        toolName: "edit_file_region",
        input: {
          path: input.path,
          anchor: input.anchor,
          currentText: input.currentText,
          replacementText: input.replacementText
        }
      }
    };
  }

  if (candidate.toolName === "create_file") {
    const input = candidate.input as {
      path?: unknown;
      content?: unknown;
    };

    if (typeof input?.path !== "string" || typeof input.content !== "string") {
      return {
        error: "create_file requires string path and content fields."
      };
    }

    return {
      value: {
        toolName: "create_file",
        input: {
          path: input.path,
          content: input.content
        }
      }
    };
  }

  if (candidate.toolName === "delete_file") {
    const input = candidate.input as {
      path?: unknown;
    };

    if (typeof input?.path !== "string") {
      return {
        error: "delete_file requires a string path field."
      };
    }

    return {
      value: {
        toolName: "delete_file",
        input: {
          path: input.path
        }
      }
    };
  }

  return {
    error: "toolRequest.toolName must be edit_file_region, create_file, or delete_file."
  };
}

function parsePhaseExecutionInput(
  value: unknown
): { value: SubmitTaskInput["phaseExecution"] } | { error: string } {
  if (value === undefined || value === null) {
    return {
      value: null
    };
  }

  if (!value || typeof value !== "object") {
    return {
      error: "phaseExecution must be an object when provided."
    };
  }

  const candidate = value as {
    phases?: unknown;
    retryPolicy?: unknown;
  };

  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0) {
    return {
      error: "phaseExecution.phases must be a non-empty array."
    };
  }

  const phases: NonNullable<SubmitTaskInput["phaseExecution"]>["phases"] = [];

  for (const [phaseIndex, rawPhase] of candidate.phases.entries()) {
    if (!rawPhase || typeof rawPhase !== "object") {
      return {
        error: `phaseExecution.phases[${phaseIndex}] must be an object.`
      };
    }

    const phase = rawPhase as {
      id?: unknown;
      name?: unknown;
      description?: unknown;
      userStories?: unknown;
    };

    if (
      typeof phase.id !== "string" ||
      typeof phase.name !== "string" ||
      typeof phase.description !== "string"
    ) {
      return {
        error: "Each phase requires string id, name, and description fields."
      };
    }

    if (!Array.isArray(phase.userStories) || phase.userStories.length === 0) {
      return {
        error: `phaseExecution.phases[${phaseIndex}].userStories must be a non-empty array.`
      };
    }

    const userStories: NonNullable<
      SubmitTaskInput["phaseExecution"]
    >["phases"][number]["userStories"] = [];

    for (const [storyIndex, rawStory] of phase.userStories.entries()) {
      if (!rawStory || typeof rawStory !== "object") {
        return {
          error: `phaseExecution.phases[${phaseIndex}].userStories[${storyIndex}] must be an object.`
        };
      }

      const story = rawStory as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        tasks?: unknown;
        acceptanceCriteria?: unknown;
        validationGates?: unknown;
      };

      if (
        typeof story.id !== "string" ||
        typeof story.title !== "string" ||
        typeof story.description !== "string"
      ) {
        return {
          error: "Each user story requires string id, title, and description fields."
        };
      }

      if (!Array.isArray(story.tasks) || story.tasks.length === 0) {
        return {
          error: "Each user story requires a non-empty tasks array."
        };
      }

      if (
        !Array.isArray(story.acceptanceCriteria) ||
        story.acceptanceCriteria.some((criterion) => typeof criterion !== "string")
      ) {
        return {
          error: "Each user story requires acceptanceCriteria as an array of strings."
        };
      }

      const validationGates = parseValidationGates(story.validationGates);

      if ("error" in validationGates) {
        return validationGates;
      }

      const tasks: NonNullable<
        SubmitTaskInput["phaseExecution"]
      >["phases"][number]["userStories"][number]["tasks"] = [];

      for (const [taskIndex, rawTask] of story.tasks.entries()) {
        if (!rawTask || typeof rawTask !== "object") {
          return {
            error: `phaseExecution.phases[${phaseIndex}].userStories[${storyIndex}].tasks[${taskIndex}] must be an object.`
          };
        }

        const task = rawTask as {
          id?: unknown;
          instruction?: unknown;
          expectedOutcome?: unknown;
          toolRequest?: unknown;
          context?: unknown;
          validationGates?: unknown;
        };

        if (
          typeof task.id !== "string" ||
          typeof task.instruction !== "string" ||
          typeof task.expectedOutcome !== "string"
        ) {
          return {
            error: "Each task requires string id, instruction, and expectedOutcome fields."
          };
        }

        const taskToolRequest = parseToolRequest(task.toolRequest);

        if ("error" in taskToolRequest) {
          return taskToolRequest;
        }

        const taskContext = parseRunContextInput(task.context);

        if ("error" in taskContext) {
          return taskContext;
        }

        const taskValidationGates = parseValidationGates(task.validationGates);

        if ("error" in taskValidationGates) {
          return taskValidationGates;
        }

        tasks.push({
          id: task.id,
          instruction: task.instruction,
          expectedOutcome: task.expectedOutcome,
          toolRequest: taskToolRequest.value,
          context: taskContext.value,
          validationGates: taskValidationGates.value
        });
      }

      userStories.push({
        id: story.id,
        title: story.title,
        description: story.description,
        tasks,
        acceptanceCriteria: story.acceptanceCriteria as string[],
        validationGates: validationGates.value
      });
    }

    phases.push({
      id: phase.id,
      name: phase.name,
      description: phase.description,
      userStories
    });
  }

  const retryPolicy = parseRetryPolicy(candidate.retryPolicy);

  if ("error" in retryPolicy) {
    return retryPolicy;
  }

  return {
    value: {
      phases,
      retryPolicy: retryPolicy.value
    }
  };
}

function parseValidationGates(
  value: unknown
): { value: ValidationGate[] } | { error: string } {
  if (value === undefined || value === null) {
    return {
      value: []
    };
  }

  if (!Array.isArray(value)) {
    return {
      error: "validationGates must be an array when provided."
    };
  }

  const gates = [];

  for (const [index, rawGate] of value.entries()) {
    if (!rawGate || typeof rawGate !== "object") {
      return {
        error: `validationGates[${index}] must be an object.`
      };
    }

    const gate = rawGate as {
      id?: unknown;
      description?: unknown;
      kind?: unknown;
      expectedValue?: unknown;
    };

    if (typeof gate.description !== "string" || typeof gate.kind !== "string") {
      return {
        error: "Each validation gate requires string description and kind fields."
      };
    }

    if (!isValidationGateKind(gate.kind)) {
      return {
        error:
          "validationGates.kind must be task_completed, all_tasks_completed, all_user_stories_completed, tool_result_ok, validation_passed, result_summary_includes, response_text_includes, evidence_includes, or event_type_present."
      };
    }

    if (gate.expectedValue !== undefined && typeof gate.expectedValue !== "string") {
      return {
        error: "validationGates.expectedValue must be a string when provided."
      };
    }

    gates.push({
      id: typeof gate.id === "string" && gate.id.trim() ? gate.id.trim() : `gate-${index + 1}`,
      description: gate.description,
      kind: gate.kind,
      expectedValue: gate.expectedValue as string | undefined
    });
  }

  return {
    value: gates
  };
}

function parseRetryPolicy(
  value: unknown
): { value: NonNullable<SubmitTaskInput["phaseExecution"]>["retryPolicy"] | undefined } | { error: string } {
  if (value === undefined || value === null) {
    return {
      value: undefined
    };
  }

  if (!value || typeof value !== "object") {
    return {
      error: "phaseExecution.retryPolicy must be an object when provided."
    };
  }

  const candidate = value as {
    maxTaskRetries?: unknown;
    maxStoryRetries?: unknown;
    maxReplans?: unknown;
  };

  if (
    candidate.maxTaskRetries !== undefined &&
    (typeof candidate.maxTaskRetries !== "number" || candidate.maxTaskRetries < 0)
  ) {
    return {
      error: "phaseExecution.retryPolicy.maxTaskRetries must be a non-negative number."
    };
  }

  if (
    candidate.maxStoryRetries !== undefined &&
    (typeof candidate.maxStoryRetries !== "number" || candidate.maxStoryRetries < 0)
  ) {
    return {
      error: "phaseExecution.retryPolicy.maxStoryRetries must be a non-negative number."
    };
  }

  if (
    candidate.maxReplans !== undefined &&
    (typeof candidate.maxReplans !== "number" || candidate.maxReplans < 0)
  ) {
    return {
      error: "phaseExecution.retryPolicy.maxReplans must be a non-negative number."
    };
  }

  return {
    value: {
      maxTaskRetries: candidate.maxTaskRetries as number | undefined,
      maxStoryRetries: candidate.maxStoryRetries as number | undefined,
      maxReplans: candidate.maxReplans as number | undefined
    }
  };
}

function isValidationGateKind(value: string): value is ValidationGateKind {
  return (
    value === "task_completed" ||
    value === "all_tasks_completed" ||
    value === "all_user_stories_completed" ||
    value === "tool_result_ok" ||
    value === "validation_passed" ||
    value === "result_summary_includes" ||
    value === "response_text_includes" ||
    value === "evidence_includes" ||
    value === "event_type_present"
  );
}
