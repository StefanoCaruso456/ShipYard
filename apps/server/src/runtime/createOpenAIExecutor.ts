import { createOpenAI } from "@ai-sdk/openai";
import type {
  AgentInstructionRuntime,
  AgentRunRecord,
  AgentRunResult,
  ExecuteRun
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
      return createMissingKeyResult(run, context.instructionRuntime, options.config);
    }

    const { text } = await generateTextImpl({
      model: openai(options.config.modelId),
      system: buildSystemPrompt(context.instructionRuntime),
      prompt: buildTaskPrompt(run)
    });
    const responseText = text.trim();
    const completedAt = new Date().toISOString();

    return {
      mode: "ai-sdk-openai",
      summary: summarizeResponse(responseText),
      responseText,
      instructionEcho: run.instruction,
      skillId: context.instructionRuntime.skill.meta.id,
      completedAt,
      provider: "openai",
      modelId: options.config.modelId
    };
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

function buildTaskPrompt(run: AgentRunRecord) {
  return [
    "Produce the next execution response for the operator.",
    run.title ? `Thread title: ${run.title}` : null,
    `Task instruction:\n${run.instruction}`,
    renderAttachmentContext(run),
    renderRunContext(run),
    "Keep the answer concise, concrete, and implementation-focused.",
    "If you are blocked by missing backend capability, say so clearly."
  ]
    .filter(Boolean)
    .join("\n\n");
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

function renderRunContext(run: AgentRunRecord) {
  const contextParts = [
    run.context.objective ? `Objective: ${run.context.objective}` : null,
    run.context.constraints.length > 0
      ? `Constraints:\n${run.context.constraints.map((constraint) => `- ${constraint}`).join("\n")}`
      : null,
    run.context.relevantFiles.length > 0
      ? `Relevant files:\n${run.context.relevantFiles
          .map((file) => `- ${file.path}${file.reason ? ` (${file.reason})` : ""}`)
          .join("\n")}`
      : null,
    run.context.validationTargets.length > 0
      ? `Validation targets:\n${run.context.validationTargets.map((target) => `- ${target}`).join("\n")}`
      : null
  ].filter(Boolean);

  return contextParts.length > 0 ? contextParts.join("\n\n") : null;
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
    modelId: config.modelId
  };
}

function summarizeResponse(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();

  if (!compact) {
    return "OpenAI returned an empty response.";
  }

  if (compact.length <= 180) {
    return compact;
  }

  return `${compact.slice(0, 177).trimEnd()}...`;
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
