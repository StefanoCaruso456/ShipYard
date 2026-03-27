import { createOpenAI } from "@ai-sdk/openai";
import type {
  AgentInstructionRuntime,
  AgentRunRecord,
  AgentRunResult,
  ExecuteRun
} from "@shipyard/agent-core";
import {
  countTextTokens,
  getActiveTraceScope,
  getRoleContextPolicy,
  resolveRelevantFilesForRun
} from "@shipyard/agent-core";
import { generateText } from "ai";

type OpenAIApiKeySource = "OPENAI_KEY" | "OPENAI_API_KEY" | null;

export type OpenAIExecutorConfig = {
  provider: "openai";
  configured: boolean;
  apiKey: string | null;
  apiKeySource: OpenAIApiKeySource;
  modelId: string;
};

type CreateOpenAIExecutorOptions = {
  config: OpenAIExecutorConfig;
  generateTextImpl?: typeof generateText;
  repoRoot?: string;
};

export function resolveOpenAIExecutorConfig(
  env: NodeJS.ProcessEnv = process.env
): OpenAIExecutorConfig {
  const openAIKey = env.OPENAI_KEY?.trim();
  const openAIApiKey = env.OPENAI_API_KEY?.trim();

  return {
    provider: "openai",
    configured: Boolean(openAIKey || openAIApiKey),
    apiKey: openAIKey || openAIApiKey || null,
    apiKeySource: openAIKey ? "OPENAI_KEY" : openAIApiKey ? "OPENAI_API_KEY" : null,
    modelId: env.OPENAI_MODEL?.trim() || "gpt-4o-mini"
  };
}

export function createOpenAIExecutor(options: CreateOpenAIExecutorOptions): ExecuteRun {
  const generateTextImpl = options.generateTextImpl ?? generateText;
  const openai =
    options.config.configured && options.config.apiKey
      ? createOpenAI({
          apiKey: options.config.apiKey
        })
      : null;

  return async (run, context) => {
    if (run.simulateFailure) {
      throw new Error("Simulated runtime failure.");
    }

    if (!openai) {
      getActiveTraceScope()?.activeSpan.addEvent("model_unavailable", {
        message: "OPENAI_KEY is not configured on the runtime host.",
        metadata: {
          provider: options.config.provider,
          modelId: options.config.modelId
        }
      });
      return createMissingKeyResult(run, context.instructionRuntime, options.config);
    }

    const traceScope = getActiveTraceScope();
    const startedAtMs = Date.now();
    const systemPrompt = buildSystemPrompt(context.instructionRuntime);
    const relevantFiles = resolveRelevantFilesForRun(run, options.repoRoot);
    const prompt = buildTaskPrompt(run, {
      roleContextPrompt: context.roleContextPrompt ?? null,
      plannedStep: context.plannedStep ?? null,
      relevantFiles
    });
    const promptTokenCount = countTextTokens(prompt);
    const systemPromptTokenCount = countTextTokens(systemPrompt);
    const maxOutputTokens = context.maxOutputTokens ?? getRoleContextPolicy("executor").maxOutputTokens;
    const modelSpan = traceScope
      ? await traceScope.activeSpan.startChild({
          name: `model:${options.config.modelId}`,
          spanType: "model",
          inputSummary: context.plannedStep?.summary ?? summarizePrompt(run),
          metadata: {
            provider: options.config.provider,
            modelId: options.config.modelId,
            plannedStepId: context.plannedStep?.id ?? null,
            roleContextSectionIds: context.roleContextSectionIds ?? [],
            roleContextSectionCount: context.roleContextSectionIds?.length ?? 0,
            attachmentCount: run.attachments.length,
            attachmentKinds: [...new Set(run.attachments.map((attachment) => attachment.kind))],
            promptLength: prompt.length,
            promptTokenCount,
            systemPromptTokenCount,
            totalRequestTokenCount: promptTokenCount + systemPromptTokenCount,
            maxOutputTokens
          },
          tags: ["model", `provider:${options.config.provider}`, `model:${options.config.modelId}`]
        })
    : null;

    try {
      const generated = await generateTextImpl({
        model: openai(options.config.modelId),
        system: systemPrompt,
        prompt,
        maxOutputTokens
      });
      const responseText = generated.text.trim();
      const completedAt = new Date().toISOString();
      const usage = {
        inputTokens: generated.totalUsage?.inputTokens ?? generated.usage?.inputTokens ?? null,
        outputTokens: generated.totalUsage?.outputTokens ?? generated.usage?.outputTokens ?? null,
        totalTokens: generated.totalUsage?.totalTokens ?? generated.usage?.totalTokens ?? null,
        providerLatencyMs: Date.now() - startedAtMs,
        estimatedCostUsd: null
      };

      modelSpan?.annotate({
        provider: options.config.provider,
        modelId: options.config.modelId,
        maxOutputTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        providerLatencyMs: usage.providerLatencyMs,
        firstTokenLatencyMs: null,
        estimatedCostUsd: usage.estimatedCostUsd,
        estimatedCostStatus: usage.estimatedCostUsd == null ? "unavailable" : "calculated",
        providerMetadataPresent: generated.providerMetadata != null,
        finishReason: generated.finishReason
      });
      if (generated.finishReason === "length") {
        modelSpan?.addEvent("model_output_capped", {
          message: "Model output hit the configured token cap.",
          metadata: {
            maxOutputTokens,
            modelId: options.config.modelId
          }
        });
      }
      await modelSpan?.end({
        status: "completed",
        outputSummary: summarizeResponse(responseText),
        metadata: {
          finishReason: generated.finishReason,
          maxOutputTokens,
          providerLatencyMs: usage.providerLatencyMs,
          firstTokenLatencyMs: null,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          estimatedCostStatus: usage.estimatedCostUsd == null ? "unavailable" : "calculated"
        }
      });

      return {
        mode: "ai-sdk-openai",
        summary: summarizeResponse(responseText),
        responseText,
        instructionEcho: run.instruction,
        skillId: context.instructionRuntime.skill.meta.id,
        completedAt,
        provider: "openai",
        modelId: options.config.modelId,
        usage
      };
    } catch (error) {
      await modelSpan?.end({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          providerLatencyMs: Date.now() - startedAtMs,
          firstTokenLatencyMs: null,
          estimatedCostUsd: null,
          estimatedCostStatus: "unavailable"
        }
      });
      throw error;
    }
  };
}

function buildSystemPrompt(instructionRuntime: AgentInstructionRuntime) {
  return [
    "You are Shipyard Runtime, the backend coding-agent executor for this repository.",
    "Honor this instruction precedence order exactly:",
    instructionRuntime.instructionPrecedence.map((layer, index) => `${index + 1}. ${layer}`).join("\n"),
    "You are acting in the executor role.",
    "Use the following executor skill guidance while responding:",
    instructionRuntime.roleViews.executor.renderedText
  ].join("\n\n");
}

function buildTaskPrompt(
  run: AgentRunRecord,
  input: {
    relevantFiles: AgentRunRecord["context"]["relevantFiles"];
    roleContextPrompt: string | null;
    plannedStep: {
      id: string;
      title: string;
      summary: string;
      successCriteria: string[];
      validationTargets: string[];
    } | null;
  }
) {
  return [
    "Produce the next execution response for the operator.",
    run.title ? `Thread title: ${run.title}` : null,
    `Task instruction:\n${run.instruction}`,
    input.plannedStep
      ? [
          "Planned step:",
          `Step id: ${input.plannedStep.id}`,
          `Title: ${input.plannedStep.title}`,
          `Summary: ${input.plannedStep.summary}`,
          input.plannedStep.successCriteria.length > 0
            ? `Success criteria:\n${input.plannedStep.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}`
            : null,
          input.plannedStep.validationTargets.length > 0
            ? `Planned validation targets:\n${input.plannedStep.validationTargets
                .map((target) => `- ${target}`)
                .join("\n")}`
            : null
        ]
          .filter(Boolean)
          .join("\n")
      : null,
    renderFactoryContext(run),
    renderProjectContext(run),
    renderPhaseExecutionContext(run),
    renderAttachmentContext(run),
    renderRunContext(run, input.relevantFiles),
    input.roleContextPrompt ? `Executor context payload:\n${input.roleContextPrompt}` : null,
    renderLocalFilePlanInstructions(run),
    [
      "Response style:",
      "- Start with the direct answer or outcome for the operator.",
      "- Prefer short paragraphs unless multiple distinct items need to be enumerated.",
      "- When listing multiple items, use flat bullet points that are easy to scan.",
      "- Avoid internal runtime labels such as \"Runtime result\" and avoid raw trace jargon.",
      "- Keep the reply concise, concrete, and implementation-focused."
    ].join("\n"),
    "Keep the answer concise, concrete, and implementation-focused.",
    "If you are blocked by missing backend capability, say so clearly."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderPhaseExecutionContext(run: AgentRunRecord) {
  const phaseExecution = run.phaseExecution;

  if (!phaseExecution) {
    return null;
  }

  const phase = phaseExecution.phases.find((candidate) => candidate.id === phaseExecution.current.phaseId);
  const story = phase?.userStories.find((candidate) => candidate.id === phaseExecution.current.storyId);
  const task = story?.tasks.find((candidate) => candidate.id === phaseExecution.current.taskId);

  return [
    "Phase execution context:",
    `Progress: ${phaseExecution.progress.completedPhases}/${phaseExecution.progress.totalPhases} phases, ${phaseExecution.progress.completedStories}/${phaseExecution.progress.totalStories} stories, ${phaseExecution.progress.completedTasks}/${phaseExecution.progress.totalTasks} tasks completed.`,
    phase ? `Current phase: ${phase.name}` : null,
    story ? `Current story: ${story.title}` : null,
    task ? `Current task expected outcome: ${task.expectedOutcome}` : null,
    story && story.acceptanceCriteria.length > 0
      ? `Story acceptance criteria:\n${story.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`
      : null
  ]
    .filter(Boolean)
    .join("\n");
}

function renderProjectContext(run: AgentRunRecord) {
  if (!run.project) {
    return null;
  }

  return [
    "Project context:",
    `Project: ${run.project.name ?? run.project.id}`,
    `Kind: ${run.project.kind}`,
    run.project.environment ? `Environment: ${run.project.environment}` : null,
    run.project.description ? `Description: ${run.project.description}` : null,
    run.project.folder
      ? `Connected folder: ${run.project.folder.displayPath ?? run.project.folder.name ?? "connected folder"}`
      : null,
    run.project.folder?.provider ? `Folder provider: ${run.project.folder.provider}` : null,
    run.project.folder?.status ? `Folder status: ${run.project.folder.status}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function renderFactoryContext(run: AgentRunRecord) {
  if (!run.factory) {
    return null;
  }

  return [
    "Factory mode context:",
    `App: ${run.factory.appName}`,
    `Current stage: ${run.factory.currentStage}`,
    `Stack: ${run.factory.stack.label}`,
    `Repository target: ${run.factory.repository.owner ? `${run.factory.repository.owner}/` : ""}${run.factory.repository.name}`,
    `Deployment target: ${run.factory.deployment.provider}`,
    run.factory.repository.localPath
      ? `Factory workspace: ${run.factory.repository.localPath}`
      : null,
    "Important: work only inside the connected runtime folder for this factory run. Do not modify the Shipyard control repository."
  ]
    .filter(Boolean)
    .join("\n");
}

function renderAttachmentContext(run: AgentRunRecord) {
  if (run.attachments.length === 0) {
    return null;
  }

  return [
    "Attachment context:",
    ...run.attachments.map((attachment, index) =>
      [
        `${index + 1}. ${attachment.name} (${attachment.kind}, ${formatBytes(attachment.size)})`,
        `Summary: ${attachment.analysis.summary}`,
        attachment.analysis.excerpt ? `Excerpt:\n${attachment.analysis.excerpt}` : null,
        attachment.analysis.warnings.length > 0
          ? `Warnings: ${attachment.analysis.warnings.join(" ")}`
          : null
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n\n");
}

function renderRunContext(
  run: AgentRunRecord,
  relevantFiles: AgentRunRecord["context"]["relevantFiles"]
) {
  const contextParts = [
    run.context.objective ? `Objective: ${run.context.objective}` : null,
    run.context.constraints.length > 0
      ? `Constraints:\n${run.context.constraints.map((constraint) => `- ${constraint}`).join("\n")}`
      : null,
    relevantFiles.length > 0
      ? `Relevant files:\n${relevantFiles
          .map((file) => `- ${file.path}${file.reason ? ` (${file.reason})` : ""}`)
          .join("\n")}`
      : null,
    run.context.validationTargets.length > 0
      ? `Validation targets:\n${run.context.validationTargets.map((target) => `- ${target}`).join("\n")}`
      : null
  ].filter(Boolean);

  return contextParts.length > 0 ? contextParts.join("\n\n") : null;
}

function renderLocalFilePlanInstructions(run: AgentRunRecord) {
  if (
    run.project?.kind !== "local" ||
    run.project.folder?.provider !== "browser-file-system-access"
  ) {
    return null;
  }

  return [
    "Local workspace file action contract:",
    "When the request requires creating, updating, or deleting files in the connected local folder, append a <local-file-plan>...</local-file-plan> block to the end of your response.",
    "Inside that block emit valid JSON with exactly this shape: {\"operations\":[...]}",
    "Inside the tags output raw JSON only. Do not wrap it in ``` fences. Do not prefix it with json. Do not add commentary inside the tags.",
    "Supported operations:",
    '- {"kind":"mkdir","path":"src/routes"}',
    '- {"kind":"write_file","path":"src/index.ts","content":"..."}',
    '- {"kind":"delete_file","path":"obsolete.txt"}',
    "Rules:",
    "- Use only relative paths rooted at the connected local folder.",
    "- Never use absolute paths or .. segments.",
    "- Use write_file to create or fully replace a file with the desired content.",
    "- Encode file content as valid JSON strings with escaped newlines like \\n.",
    "- For scaffold requests, prefer short placeholder file contents unless the operator explicitly asks for a full implementation.",
    "- Include every file or directory you want created in the operations array. A description in prose will not touch the local workspace.",
    "- Omit the block when no local filesystem change is needed.",
    "- Do not claim files were already written unless they are represented in the local file plan block. The client applies the plan after your response."
  ].join("\n");
}

function createMissingKeyResult(
  run: AgentRunRecord,
  instructionRuntime: AgentInstructionRuntime,
  config: OpenAIExecutorConfig
): AgentRunResult {
  const completedAt = new Date().toISOString();

  return {
    mode: "placeholder-execution",
    summary: "OPENAI_KEY is not configured on the runtime host, so the run stayed in placeholder mode.",
    responseText:
      "Configure OPENAI_KEY on the server runtime host to enable real model execution through the Vercel AI SDK.",
    instructionEcho: run.instruction,
    skillId: instructionRuntime.skill.meta.id,
    completedAt,
    provider: config.provider,
    modelId: config.modelId,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      providerLatencyMs: null,
      estimatedCostUsd: null
    }
  };
}

function summarizeResponse(text: string) {
  const stripped = stripLocalFilePlanBlock(text);
  const compact = stripped.replace(/\s+/g, " ").trim();

  if (!compact) {
    return hasLocalFilePlanBlock(text)
      ? "Prepared a local file plan for the connected workspace."
      : "OpenAI returned an empty response.";
  }

  if (compact.length <= 180) {
    return compact;
  }

  return `${compact.slice(0, 177).trimEnd()}...`;
}

function stripLocalFilePlanBlock(text: string) {
  return text.replace(/<local-file-plan>\s*[\s\S]*?\s*<\/local-file-plan>/gi, "").trim();
}

function hasLocalFilePlanBlock(text: string) {
  return /<local-file-plan>\s*[\s\S]*?\s*<\/local-file-plan>/i.test(text);
}

function summarizePrompt(run: AgentRunRecord) {
  const compact = run.instruction.replace(/\s+/g, " ").trim();

  if (compact.length <= 120) {
    return compact;
  }

  return `${compact.slice(0, 117).trimEnd()}...`;
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
