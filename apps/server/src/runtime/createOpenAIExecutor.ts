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
  getOperatingModePolicy,
  getRoleContextPolicy,
  normalizeRequestedOperatingMode,
  resolveOperatingMode,
  resolveRelevantFilesForRun
} from "@shipyard/agent-core";
import { generateText, Output } from "ai";

import {
  applyRuntimeWorkspacePlan,
  extractRuntimeWorkspacePlan,
  runtimeWorkspaceStructuredOutputSchema,
  type ExtractedRuntimeWorkspacePlan,
  type RuntimeWorkspacePlan
} from "./runtimeWorkspacePlan";
import {
  buildFactoryBootstrapFallbackPlan,
  renderBootstrapRecoveryPlanGuidance
} from "./factoryBootstrapFallbackPlan";

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

type UsageCarrier = {
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
  totalUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
};

type TokenUsageTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

const DEFAULT_OPENAI_EXECUTOR_MODEL_ID = "gpt-5.4";

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
    modelId: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_EXECUTOR_MODEL_ID
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

    const requestedOperatingMode = normalizeRequestedOperatingMode(run.requestedOperatingMode);
    const operatingMode = run.operatingMode
      ? run.operatingMode
      : resolveOperatingMode({
          requestedOperatingMode,
          instruction: run.instruction,
          toolRequest: run.toolRequest ?? null,
          factory: run.factory ?? null
        });
    const factoryExecution = isFactoryExecutionRun(run, operatingMode);
    const operatingModePolicy = getOperatingModePolicy(operatingMode);

    if (!openai) {
      getActiveTraceScope()?.activeSpan.addEvent("model_unavailable", {
        message: "OPENAI_KEY is not configured on the runtime host.",
        metadata: {
          provider: options.config.provider,
          modelId: options.config.modelId
        }
      });
      return createMissingKeyResult(
        run,
        context.instructionRuntime,
        options.config,
        requestedOperatingMode,
        operatingMode
      );
    }

    const traceScope = getActiveTraceScope();
    const startedAtMs = Date.now();
    const systemPrompt = buildSystemPrompt(context.instructionRuntime, operatingMode);
    const relevantFiles = resolveRelevantFilesForRun(run, options.repoRoot);
    const prompt = buildTaskPrompt(run, {
      roleContextPrompt: context.roleContextPrompt ?? null,
      plannedStep: context.plannedStep ?? null,
      relevantFiles,
      requestedOperatingMode,
      operatingMode
    });
    const promptTokenCount = countTextTokens(prompt);
    const systemPromptTokenCount = countTextTokens(systemPrompt);
    const maxOutputTokens = resolveModelMaxOutputTokens({
      factoryExecution,
      operatingMode,
      requestedMaxOutputTokens: context.maxOutputTokens
    });
    const modelSpan = traceScope
      ? await traceScope.activeSpan.startChild({
          name: `model:${options.config.modelId}`,
          spanType: "model",
          inputSummary: context.plannedStep?.summary ?? summarizePrompt(run),
          metadata: {
            provider: options.config.provider,
            modelId: options.config.modelId,
            plannedStepId: context.plannedStep?.id ?? null,
            requestedOperatingMode,
            operatingMode,
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
      const generated = await generateTextImpl(
        withOptionalMaxOutputTokens(
          {
            model: openai(options.config.modelId),
            system: systemPrompt,
            prompt
          },
          maxOutputTokens
        )
      );
      let rawResponseText = generated.text.trim();
      const runtimeWorkspaceRoot = resolveRuntimeWorkspaceRoot(run);
      const currentTask = resolveCurrentPhaseTask(run);
      const requiresRuntimeWorkspacePlan = shouldRequireRuntimeWorkspacePlan(run, currentTask);
      let extractedWorkspacePlan =
        runtimeWorkspaceRoot != null ? extractRuntimeWorkspacePlan(rawResponseText) : null;
      const workspaceProvider = resolveWorkspaceFilePlanProvider(run);
      let usageTotals = extractTokenUsageTotals(generated);
      const usesStructuredRuntimeWorkspacePlan =
        runtimeWorkspaceRoot != null && requiresRuntimeWorkspacePlan;
      let runtimeWorkspacePlanGenerationAttempted = false;
      let runtimeWorkspacePlanGenerationSucceeded = false;
      let runtimeWorkspacePlanSource:
        | "embedded_response"
        | "structured_output"
        | "bootstrap_fallback"
        | "none" = hasNonEmptyRuntimeWorkspacePlan(extractedWorkspacePlan)
        ? "embedded_response"
        : "none";

      if (usesStructuredRuntimeWorkspacePlan && !hasNonEmptyRuntimeWorkspacePlan(extractedWorkspacePlan)) {
        runtimeWorkspacePlanGenerationAttempted = true;
        modelSpan?.addEvent("runtime_workspace_plan_generation_requested", {
          message:
            "Visible model response did not include a usable runtime workspace plan. Generating a structured workspace plan.",
          metadata: {
            taskId: currentTask?.id ?? null,
            workspaceProvider,
            initialPlanError: extractedWorkspacePlan?.error ?? null
          }
        });

        try {
          let normalizedWorkspacePlan = await generateStructuredRuntimeWorkspacePlan({
            generateTextImpl,
            openai,
            modelId: options.config.modelId,
            systemPrompt,
            prompt: buildRuntimeWorkspacePlanPrompt({
              run,
              task: currentTask,
              rawResponseText
            }),
            factoryExecution,
            onUsage: (generatedWorkspacePlan) => {
              usageTotals = mergeTokenUsageTotals(
                usageTotals,
                extractTokenUsageTotals(generatedWorkspacePlan)
              );
            }
          });
          let rejectedPlanReason = describeRejectedFactoryRuntimeWorkspacePlan({
            run,
            task: currentTask,
            plan: normalizedWorkspacePlan
          });

          if (rejectedPlanReason) {
            modelSpan?.addEvent("runtime_workspace_plan_generation_rejected", {
              message: rejectedPlanReason,
              metadata: {
                taskId: currentTask?.id ?? null,
                workspaceProvider
              }
            });

            normalizedWorkspacePlan = await generateStructuredRuntimeWorkspacePlan({
              generateTextImpl,
              openai,
              modelId: options.config.modelId,
              systemPrompt,
              prompt: buildRuntimeWorkspacePlanRepairPrompt({
                run,
                task: currentTask,
                rawResponseText,
                rejectionReason: rejectedPlanReason,
                rejectedPlan: normalizedWorkspacePlan
              }),
              factoryExecution,
              onUsage: (generatedWorkspacePlan) => {
                usageTotals = mergeTokenUsageTotals(
                  usageTotals,
                  extractTokenUsageTotals(generatedWorkspacePlan)
                );
              }
            });
            rejectedPlanReason = describeRejectedFactoryRuntimeWorkspacePlan({
              run,
              task: currentTask,
              plan: normalizedWorkspacePlan
            });
          }

          if (
            normalizedWorkspacePlan &&
            normalizedWorkspacePlan.operations.length > 0 &&
            !rejectedPlanReason
          ) {
            extractedWorkspacePlan = {
              strippedText: stripLocalFilePlanBlock(rawResponseText),
              plan: normalizedWorkspacePlan,
              error: null
            };
            runtimeWorkspacePlanGenerationSucceeded = true;
            runtimeWorkspacePlanSource = "structured_output";
            modelSpan?.addEvent("runtime_workspace_plan_generation_succeeded", {
              message: "Generated a structured runtime workspace plan for the active Factory task.",
              metadata: {
                taskId: currentTask?.id ?? null,
                operationCount: normalizedWorkspacePlan.operations.length
              }
            });
          } else {
            modelSpan?.addEvent("runtime_workspace_plan_generation_failed", {
              message:
                rejectedPlanReason ??
                "Structured workspace plan generation returned no operations.",
              metadata: {
                taskId: currentTask?.id ?? null,
                workspaceProvider
              }
            });
          }
        } catch (error) {
          modelSpan?.addEvent("runtime_workspace_plan_generation_failed", {
            message:
              error instanceof Error
                ? error.message
                : "Structured workspace plan generation failed.",
            metadata: {
              taskId: currentTask?.id ?? null,
              workspaceProvider
            }
          });
        }
      }

      if (usesStructuredRuntimeWorkspacePlan && !hasNonEmptyRuntimeWorkspacePlan(extractedWorkspacePlan)) {
        const bootstrapFallbackPlan = buildFactoryBootstrapFallbackPlan({
          run,
          task: currentTask
        });

        if (bootstrapFallbackPlan && bootstrapFallbackPlan.operations.length > 0) {
          extractedWorkspacePlan = {
            strippedText: stripLocalFilePlanBlock(rawResponseText),
            plan: bootstrapFallbackPlan,
            error: null
          };
          runtimeWorkspacePlanGenerationSucceeded = true;
          runtimeWorkspacePlanSource = "bootstrap_fallback";
          modelSpan?.addEvent("runtime_workspace_plan_bootstrap_fallback_applied", {
            message:
              "Structured workspace plan generation returned no usable operations. Applied the bootstrap scaffold fallback plan.",
            metadata: {
              taskId: currentTask?.id ?? null,
              operationCount: bootstrapFallbackPlan.operations.length
            }
          });
        }
      }

      modelSpan?.annotate({
        workspaceProvider,
        runtimeWorkspacePlanRequired: requiresRuntimeWorkspacePlan,
        runtimeWorkspacePlanGenerationAttempted,
        runtimeWorkspacePlanGenerationSucceeded,
        runtimeWorkspacePlanSource,
        runtimeWorkspacePlanPresent: Boolean(extractedWorkspacePlan?.plan),
        runtimeWorkspacePlanOperationCount:
          extractedWorkspacePlan?.plan?.operations.length ?? 0
      });

      if (runtimeWorkspaceRoot != null && extractedWorkspacePlan?.error) {
        throw new Error(extractedWorkspacePlan.error);
      }

      if (
        runtimeWorkspaceRoot != null &&
        requiresRuntimeWorkspacePlan &&
        (!extractedWorkspacePlan?.plan || extractedWorkspacePlan.plan.operations.length === 0)
      ) {
        throw new Error(
          `Factory task ${currentTask?.id ?? "current-task"} must produce a non-empty runtime workspace plan for the connected runtime workspace.${runtimeWorkspacePlanGenerationAttempted ? " The visible response and structured plan pass both failed to produce a valid workspace plan." : ""}`
        );
      }

      const appliedWorkspacePlan =
        runtimeWorkspaceRoot != null && extractedWorkspacePlan?.plan
          ? await applyRuntimeWorkspacePlan({
              rootDir: runtimeWorkspaceRoot,
              plan: extractedWorkspacePlan.plan
            })
          : null;
      modelSpan?.annotate({
        runtimeWorkspacePlanApplied: appliedWorkspacePlan != null,
        runtimeWorkspacePlanChangedFiles: appliedWorkspacePlan?.changedFiles ?? []
      });
      const responseText =
        runtimeWorkspaceRoot != null
          ? normalizeRuntimeWorkspaceResponse({
              run,
              task: currentTask,
              rawResponseText,
              strippedResponseText:
                extractedWorkspacePlan?.strippedText ?? stripLocalFilePlanBlock(rawResponseText),
              appliedWorkspacePlanSummary: appliedWorkspacePlan?.summary ?? null,
              appliedWorkspacePlanOperationCount: appliedWorkspacePlan?.operationCount ?? 0,
              appliedWorkspacePlanChangedFiles: appliedWorkspacePlan?.changedFiles ?? [],
              runtimeWorkspacePlanSource
            })
          : rawResponseText;
      const summary = summarizeResponse(
        runtimeWorkspaceRoot != null ? responseText : rawResponseText,
        appliedWorkspacePlan?.summary ?? null
      );
      const completedAt = new Date().toISOString();
      const usage = {
        inputTokens: usageTotals.inputTokens,
        outputTokens: usageTotals.outputTokens,
        totalTokens: usageTotals.totalTokens,
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
        outputSummary: summary,
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
        summary,
        responseText,
        instructionEcho: run.instruction,
        skillId: context.instructionRuntime.skill.meta.id,
        completedAt,
        requestedOperatingMode,
        operatingMode,
        provider: "openai",
        modelId: options.config.modelId,
        usage,
        appliedWorkspacePlan: appliedWorkspacePlan
          ? {
              provider: "runtime",
              ...appliedWorkspacePlan
            }
          : null
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

function buildSystemPrompt(
  instructionRuntime: AgentInstructionRuntime,
  operatingMode: ReturnType<typeof resolveOperatingMode>
) {
  const operatingModePolicy = getOperatingModePolicy(operatingMode);

  return [
    "You are Shipyard Runtime, the backend coding-agent executor for this repository.",
    "Honor this instruction precedence order exactly:",
    instructionRuntime.instructionPrecedence.map((layer, index) => `${index + 1}. ${layer}`).join("\n"),
    "You are acting in the executor role.",
    `Current operating mode: ${operatingModePolicy.label}.`,
    `Mode contract: ${operatingModePolicy.description}`,
    `Executor directive: ${operatingModePolicy.executorDirective}`,
    "Use the following executor skill guidance while responding:",
    instructionRuntime.roleViews.executor.renderedText
  ].join("\n\n");
}

function buildTaskPrompt(
  run: AgentRunRecord,
  input: {
    relevantFiles: AgentRunRecord["context"]["relevantFiles"];
    roleContextPrompt: string | null;
    requestedOperatingMode: ReturnType<typeof normalizeRequestedOperatingMode>;
    operatingMode: ReturnType<typeof resolveOperatingMode>;
    plannedStep: {
      id: string;
      title: string;
      summary: string;
      successCriteria: string[];
      validationTargets: string[];
    } | null;
  }
) {
  const operatingModePolicy = getOperatingModePolicy(input.operatingMode);
  const currentTask = resolveCurrentPhaseTask(run);

  return [
    "Produce the next execution response for the operator.",
    run.title ? `Thread title: ${run.title}` : null,
    renderOperatingModeContext(input.requestedOperatingMode, input.operatingMode),
    renderTaskInstructionContext(run, currentTask),
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
    renderCompletionContract(run),
    renderFactoryContext(run),
    renderProjectContext(run),
    renderPhaseExecutionContext(run),
    renderAttachmentContext(run),
    renderRunContext(run, input.relevantFiles),
    input.roleContextPrompt ? `Executor context payload:\n${input.roleContextPrompt}` : null,
    renderWorkspaceFilePlanInstructions(run),
    [
      "Response style:",
      `- ${operatingModePolicy.defaultResponseLead}`,
      "- Prefer short paragraphs unless multiple distinct items need to be enumerated.",
      "- When listing multiple items, use flat bullet points that are easy to scan.",
      "- Avoid internal runtime labels such as \"Runtime result\" and avoid raw trace jargon.",
      "- Keep the reply concise, concrete, and implementation-focused.",
      input.operatingMode === "review"
        ? "- Stay review-focused and read-only unless the operator explicitly requested edits."
        : null,
      input.operatingMode === "debug"
        ? "- Lead with the root cause, strongest evidence, or next diagnostic step before broader fixes."
        : null,
      input.operatingMode === "refactor"
        ? "- Make behavior-preserving intent explicit when proposing structural changes."
        : null,
      input.operatingMode === "factory"
        ? "- Keep the response aligned to the current factory stage and delivery path."
        : null
    ]
      .filter(Boolean)
      .join("\n"),
    "Keep the answer concise, concrete, and implementation-focused.",
    "If you are blocked by missing backend capability, say so clearly."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderOperatingModeContext(
  requestedOperatingMode: ReturnType<typeof normalizeRequestedOperatingMode>,
  operatingMode: ReturnType<typeof resolveOperatingMode>
) {
  const operatingModePolicy = getOperatingModePolicy(operatingMode);

  return [
    "Operating mode:",
    `Requested: ${formatOperatingModeLabel(requestedOperatingMode)}`,
    `Resolved: ${operatingModePolicy.label}`,
    `Directive: ${operatingModePolicy.executorDirective}`
  ].join("\n");
}

function renderTaskInstructionContext(
  run: AgentRunRecord,
  task: ReturnType<typeof resolveCurrentPhaseTask>
) {
  const taskInstruction = task?.instruction?.trim() || run.instruction.trim();
  const originalInstruction = run.instruction.trim();

  return [
    task?.id ? `Current phase task id: ${task.id}` : null,
    `Task instruction:\n${taskInstruction}`,
    taskInstruction &&
    originalInstruction &&
    normalizeText(taskInstruction) !== normalizeText(originalInstruction)
      ? `Original operator request:\n${originalInstruction}`
      : null
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
    task?.instruction ? `Current task detail: ${task.instruction}` : null,
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
    run.factory.repository.localPath
      ? `Factory workspace: ${run.factory.repository.localPath}`
      : null,
    "Remote repository setup is deferred until an explicit later step.",
    "Delivery policy: build and verify the application locally first. Deployment and live data-service setup are operator-managed follow-up work unless the current task explicitly requests them.",
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

function renderWorkspaceFilePlanInstructions(run: AgentRunRecord) {
  const provider = resolveWorkspaceFilePlanProvider(run);
  const currentTask = resolveCurrentPhaseTask(run);
  const requiresRuntimeWorkspacePlan = shouldRequireRuntimeWorkspacePlan(run, currentTask);

  if (!provider) {
    return null;
  }

  if (provider === "runtime" && requiresRuntimeWorkspacePlan) {
    return [
      "Runtime workspace execution contract:",
      "- This Factory task writes to the connected runtime workspace.",
      "- Do not append a <local-file-plan> block to the visible response for this task.",
      "- The runtime will request the machine-readable workspace operations separately as structured output.",
      "- In the visible response, describe what changed, what remains, and whether the task is complete.",
      "- Only claim completion when the structured workspace plan represents the real edits needed for this task."
    ].join("\n");
  }

  return [
    "Workspace file action contract:",
    "When the request requires creating, updating, or deleting files in the connected workspace, append a <local-file-plan>...</local-file-plan> block to the end of your response.",
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
    provider === "runtime"
      ? "- Do not claim files were already written unless they are represented in the local file plan block. The runtime applies the plan during execution."
      : "- Do not claim files were already written unless they are represented in the local file plan block. The client applies the plan after your response.",
    provider === "runtime"
      ? "- For Factory mode implementation, scaffold, and build tasks, filesystem changes normally belong in this block so the verifier can inspect the actual workspace changes."
      : null,
    provider === "runtime"
      ? "- If the current Factory task builds or scaffolds the app, treat the block as required. A prose-only answer will be rejected."
      : null
  ].join("\n");
}

function renderCompletionContract(run: AgentRunRecord) {
  const phaseExecution = run.phaseExecution;

  if (!phaseExecution) {
    return null;
  }

  const phase = phaseExecution.phases.find((candidate) => candidate.id === phaseExecution.current.phaseId);
  const story = phase?.userStories.find((candidate) => candidate.id === phaseExecution.current.storyId);
  const task = story?.tasks.find((candidate) => candidate.id === phaseExecution.current.taskId);
  const expectedOutcome = task?.expectedOutcome?.trim();

  if (!expectedOutcome) {
    return null;
  }

  return [
    "Completion contract:",
    `- Only when the current task is actually complete, include this exact final standalone line: ${expectedOutcome}`,
    `- If the task is not complete yet, do not output "${expectedOutcome}". Explain what remains instead.`,
    "- For runtime-backed Factory build tasks, the completion line must correspond to real workspace edits represented in the runtime workspace plan.",
    "- Make sure the visible response matches the actual workspace changes and execution evidence."
  ].join("\n");
}

function buildRuntimeWorkspacePlanPrompt(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  rawResponseText: string;
}) {
  const currentInstruction = input.task?.instruction?.trim() || input.run.instruction.trim();
  const expectedOutcome = input.task?.expectedOutcome?.trim();

  return [
    "Generate only the machine-readable runtime workspace plan for the current task.",
    "Do not repeat the visible response. The runtime will apply this plan directly.",
    "Return the exact file and directory operations needed for this task and nothing else.",
    "Return JSON with exactly this shape: {\"operations\":[{\"kind\":\"write_file\"|\"mkdir\"|\"delete_file\",\"path\":\"...\",\"content\":\"...\"}]}",
    "Every operation object must include kind, path, and content.",
    "For mkdir and delete_file operations, set content to an empty string.",
    "Every operation path must stay relative to the connected runtime workspace. Never use absolute paths or .. segments.",
    "This current task requires real workspace edits. Do not return an empty operations array.",
    "Do not add deployment setup, hosted environment configuration, or live database provisioning work to this plan unless the current task explicitly asks for it.",
    input.task?.id ? `Task id: ${input.task.id}` : null,
    `Task instruction:\n${currentInstruction}`,
    expectedOutcome ? `Expected outcome:\n${expectedOutcome}` : null,
    renderBootstrapRecoveryPlanGuidance(input.run),
    renderImplementationRecoveryPlanGuidance(input.run, input.task),
    `Visible response draft:\n${input.rawResponseText}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRuntimeWorkspacePlanRepairPrompt(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  rawResponseText: string;
  rejectionReason: string;
  rejectedPlan: RuntimeWorkspacePlan | null;
}) {
  return [
    buildRuntimeWorkspacePlanPrompt({
      run: input.run,
      task: input.task,
      rawResponseText: input.rawResponseText
    }),
    "The previous structured workspace plan was rejected because it did not satisfy the current factory task intent.",
    `Rejected plan reason: ${input.rejectionReason}`,
    input.rejectedPlan ? `Rejected plan JSON:\n${JSON.stringify(input.rejectedPlan, null, 2)}` : null,
    "Replace the rejected plan with a new one.",
    "Do not write blocker notes, TODO files, TASK-NEEDS-IMPLEMENTATION files, README-only changes, or other placeholder artifacts unless they accompany real implementation files.",
    "For factory implementation tasks, at least one write_file must target an application implementation file under app/, src/, components/, lib/, pages/, client/src/, server/src/, or app/api/."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderImplementationRecoveryPlanGuidance(
  run: AgentRunRecord,
  task: ReturnType<typeof resolveCurrentPhaseTask>
) {
  if (
    run.phaseExecution?.current.phaseId !== "factory-implementation" ||
    !run.factory ||
    !task?.id
  ) {
    return null;
  }

  switch (task.id) {
    case "task-nextjs-shell":
    case "task-frontend-shell":
      return [
        "Implementation task guidance:",
        `- This is the application shell task for ${run.factory.appName}.`,
        "- The plan must modify real application shell files, not placeholder notes or blocker docs.",
        "- Prefer changes under app/, src/app/, components/, src/components/, pages/, or related shell styling files.",
        "- Do not write TASK-NEEDS-IMPLEMENTATION.txt, TODO notes, or README-only changes as the primary result for this task."
      ].join("\n");
    case "task-supabase-flow":
    case "task-railway-data-flow":
    case "task-api-flow":
      return [
        "Implementation task guidance:",
        `- This is the first interactive product flow task for ${run.factory.appName}.`,
        "- The plan must implement actual product flow files, local data adapters, seeded fixtures, or interaction handlers that make the product work locally.",
        "- Prefer changes under app/, src/app/, components/, src/components/, lib/, src/lib/, app/api/, client/src/, or server/src/.",
        "- Do not write TASK-NEEDS-IMPLEMENTATION.txt, blocker notes, TODO files, or documentation-only changes as the primary result for this task."
      ].join("\n");
    default:
      return null;
  }
}

function createMissingKeyResult(
  run: AgentRunRecord,
  instructionRuntime: AgentInstructionRuntime,
  config: OpenAIExecutorConfig,
  requestedOperatingMode: ReturnType<typeof normalizeRequestedOperatingMode>,
  operatingMode: ReturnType<typeof resolveOperatingMode>
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
    requestedOperatingMode,
    operatingMode,
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

function formatOperatingModeLabel(mode: ReturnType<typeof normalizeRequestedOperatingMode>) {
  switch (mode) {
    case "auto":
      return "Auto mode";
    case "build":
      return "Build mode";
    case "review":
      return "Review mode";
    case "debug":
      return "Debug mode";
    case "refactor":
      return "Refactor mode";
    case "factory":
      return "Factory mode";
  }
}

function resolveModelMaxOutputTokens(input: {
  factoryExecution: boolean;
  operatingMode: ReturnType<typeof resolveOperatingMode>;
  requestedMaxOutputTokens: number | null | undefined;
}) {
  if (input.factoryExecution || input.operatingMode === "factory") {
    return null;
  }

  return (
    input.requestedMaxOutputTokens ??
    getOperatingModePolicy(input.operatingMode).defaultMaxOutputTokens ??
    getRoleContextPolicy("executor").maxOutputTokens
  );
}

function isFactoryExecutionRun(
  run: AgentRunRecord,
  operatingMode: ReturnType<typeof resolveOperatingMode>
) {
  return (
    operatingMode === "factory" ||
    run.factory != null ||
    run.phaseExecution?.current.phaseId?.startsWith("factory-") === true
  );
}

function withOptionalMaxOutputTokens<T extends Record<string, unknown>>(
  input: T,
  maxOutputTokens: number | null
) {
  if (maxOutputTokens == null) {
    return input;
  }

  return {
    ...input,
    maxOutputTokens
  };
}

function summarizeResponse(text: string, fallbackSummary: string | null = null) {
  const stripped = stripLocalFilePlanBlock(text);
  const compact = stripped.replace(/\s+/g, " ").trim();

  if (!compact) {
    return fallbackSummary ??
      (hasLocalFilePlanBlock(text)
        ? "Prepared a local file plan for the connected workspace."
        : "OpenAI returned an empty response.");
  }

  if (compact.length <= 180) {
    return compact;
  }

  return `${compact.slice(0, 177).trimEnd()}...`;
}

const LOCAL_FILE_PLAN_BLOCK_PATTERN = /<local-file-plan>\s*[\s\S]*?\s*<\/local-file-plan>/i;

function stripLocalFilePlanBlock(text: string) {
  return text.replace(LOCAL_FILE_PLAN_BLOCK_PATTERN, "").trim();
}

function extractTokenUsageTotals(result: UsageCarrier): TokenUsageTotals {
  return {
    inputTokens: result.totalUsage?.inputTokens ?? result.usage?.inputTokens ?? null,
    outputTokens: result.totalUsage?.outputTokens ?? result.usage?.outputTokens ?? null,
    totalTokens: result.totalUsage?.totalTokens ?? result.usage?.totalTokens ?? null
  };
}

function mergeTokenUsageTotals(
  base: TokenUsageTotals,
  extra: TokenUsageTotals
): TokenUsageTotals {
  return {
    inputTokens: sumTokenUsage(base.inputTokens, extra.inputTokens),
    outputTokens: sumTokenUsage(base.outputTokens, extra.outputTokens),
    totalTokens: sumTokenUsage(base.totalTokens, extra.totalTokens)
  };
}

function sumTokenUsage(left: number | null, right: number | null) {
  if (left == null && right == null) {
    return null;
  }

  return (left ?? 0) + (right ?? 0);
}

function hasNonEmptyRuntimeWorkspacePlan(
  extractedWorkspacePlan: ExtractedRuntimeWorkspacePlan | null
) {
  return Boolean(
    extractedWorkspacePlan?.plan &&
      !extractedWorkspacePlan.error &&
      extractedWorkspacePlan.plan.operations.length > 0
  );
}

function normalizeGeneratedRuntimeWorkspacePlan(
  value: unknown
): RuntimeWorkspacePlan | null {
  const parsed = runtimeWorkspaceStructuredOutputSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  try {
    return {
      operations: parsed.data.operations.map((operation, index) =>
        validateGeneratedRuntimeWorkspacePlanOperation(operation, index)
      )
    };
  } catch {
    return null;
  }
}

function resolveVisibleResponseText(
  rawResponseText: string,
  strippedResponseText: string,
  fallbackSummary: string | null
) {
  if (strippedResponseText.trim()) {
    return strippedResponseText.trim();
  }

  if (hasLocalFilePlanBlock(rawResponseText) && fallbackSummary) {
    return fallbackSummary;
  }

  return strippedResponseText.trim();
}

function normalizeRuntimeWorkspaceResponse(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  rawResponseText: string;
  strippedResponseText: string;
  appliedWorkspacePlanSummary: string | null;
  appliedWorkspacePlanOperationCount: number;
  appliedWorkspacePlanChangedFiles: string[];
  runtimeWorkspacePlanSource:
    | "embedded_response"
    | "structured_output"
    | "bootstrap_fallback"
    | "none";
}) {
  const visibleResponseText = resolveVisibleResponseText(
    input.rawResponseText,
    input.strippedResponseText,
    input.appliedWorkspacePlanSummary
  );
  const expectedOutcome = input.task?.expectedOutcome?.trim();
  const recoveredFactoryTaskResponse = buildRecoveredFactoryTaskResponse({
    run: input.run,
    task: input.task,
    visibleResponseText,
    appliedWorkspacePlanSummary: input.appliedWorkspacePlanSummary,
    appliedWorkspacePlanOperationCount: input.appliedWorkspacePlanOperationCount,
    appliedWorkspacePlanChangedFiles: input.appliedWorkspacePlanChangedFiles,
    runtimeWorkspacePlanSource: input.runtimeWorkspacePlanSource,
    expectedOutcome: expectedOutcome ?? null
  });

  if (recoveredFactoryTaskResponse) {
    return recoveredFactoryTaskResponse;
  }

  if (
    !expectedOutcome ||
    !shouldRequireRuntimeWorkspacePlan(input.run, input.task) ||
    input.appliedWorkspacePlanOperationCount <= 0 ||
    responseIndicatesIncompleteTask(visibleResponseText) ||
    includesNormalized(visibleResponseText, expectedOutcome)
  ) {
    return visibleResponseText;
  }

  if (!visibleResponseText.trim()) {
    return expectedOutcome;
  }

  return `${visibleResponseText.trim()}\n\n${expectedOutcome}`;
}

function canRecoverFactoryTaskResponse(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  appliedWorkspacePlanChangedFiles: string[];
  runtimeWorkspacePlanSource:
    | "embedded_response"
    | "structured_output"
    | "bootstrap_fallback"
    | "none";
}) {
  if (
    input.runtimeWorkspacePlanSource !== "structured_output" &&
    input.runtimeWorkspacePlanSource !== "bootstrap_fallback"
  ) {
    return false;
  }

  if (input.task?.id === "task-repository-bootstrap") {
    return true;
  }

  if (input.run.phaseExecution?.current.phaseId !== "factory-implementation") {
    return false;
  }

  return hasSubstantiveImplementationChanges(input.task, input.appliedWorkspacePlanChangedFiles);
}

function describeRejectedFactoryRuntimeWorkspacePlan(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  plan: RuntimeWorkspacePlan | null;
}) {
  if (!input.plan || input.run.phaseExecution?.current.phaseId !== "factory-implementation") {
    return null;
  }

  const changedFiles = collectRuntimeWorkspacePlanChangedFiles(input.plan);

  if (changedFiles.length === 0) {
    return "Structured workspace plan did not change any files for the current implementation task.";
  }

  if (!hasSubstantiveImplementationChanges(input.task, changedFiles)) {
    return "Structured workspace plan only changed placeholder, note, or non-implementation files for the current implementation task.";
  }

  return null;
}

function collectRuntimeWorkspacePlanChangedFiles(plan: RuntimeWorkspacePlan) {
  return uniqueNormalizedPaths(
    plan.operations
      .filter((operation) => operation.kind !== "mkdir")
      .map((operation) => operation.path)
  );
}

function hasSubstantiveImplementationChanges(
  task: ReturnType<typeof resolveCurrentPhaseTask>,
  changedFiles: string[]
) {
  const normalizedChangedFiles = uniqueNormalizedPaths(changedFiles);
  const codeLikeFiles = normalizedChangedFiles.filter(isImplementationCodePath);

  if (codeLikeFiles.length === 0) {
    return false;
  }

  switch (task?.id) {
    case "task-nextjs-shell":
    case "task-frontend-shell":
      return codeLikeFiles.some((path) => isShellImplementationPath(path));
    case "task-supabase-flow":
    case "task-railway-data-flow":
    case "task-api-flow":
      return codeLikeFiles.some((path) => isProductFlowImplementationPath(path));
    default:
      return true;
  }
}

function isImplementationCodePath(path: string) {
  const normalized = normalizePlanPath(path);

  if (!normalized) {
    return false;
  }

  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".txt") ||
    normalized === "readme.md" ||
    normalized === "shipyard.factory.json" ||
    normalized.startsWith("docs/") ||
    normalized.includes("todo") ||
    normalized.includes("task-needs-implementation")
  ) {
    return false;
  }

  return (
    normalized.startsWith("app/") ||
    normalized.startsWith("src/") ||
    normalized.startsWith("components/") ||
    normalized.startsWith("lib/") ||
    normalized.startsWith("pages/") ||
    normalized.startsWith("client/src/") ||
    normalized.startsWith("server/src/") ||
    normalized.startsWith("app/api/") ||
    normalized === "middleware.ts" ||
    normalized === "middleware.js"
  );
}

function isShellImplementationPath(path: string) {
  const normalized = normalizePlanPath(path);

  return (
    normalized.startsWith("app/") ||
    normalized.startsWith("src/app/") ||
    normalized.startsWith("components/") ||
    normalized.startsWith("src/components/") ||
    normalized.startsWith("pages/") ||
    normalized.endsWith(".css")
  );
}

function isProductFlowImplementationPath(path: string) {
  const normalized = normalizePlanPath(path);

  return (
    normalized.startsWith("app/") ||
    normalized.startsWith("src/app/") ||
    normalized.startsWith("components/") ||
    normalized.startsWith("src/components/") ||
    normalized.startsWith("lib/") ||
    normalized.startsWith("src/lib/") ||
    normalized.startsWith("app/api/") ||
    normalized.startsWith("server/src/") ||
    normalized.startsWith("client/src/")
  );
}

function normalizePlanPath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();
}

function buildRecoveredFactoryTaskResponse(input: {
  run: AgentRunRecord;
  task: ReturnType<typeof resolveCurrentPhaseTask>;
  visibleResponseText: string;
  appliedWorkspacePlanSummary: string | null;
  appliedWorkspacePlanOperationCount: number;
  appliedWorkspacePlanChangedFiles: string[];
  runtimeWorkspacePlanSource:
    | "embedded_response"
    | "structured_output"
    | "bootstrap_fallback"
    | "none";
  expectedOutcome: string | null;
}) {
  if (
    input.appliedWorkspacePlanOperationCount <= 0 ||
    !input.expectedOutcome ||
    !responseIndicatesIncompleteTask(input.visibleResponseText) ||
    !canRecoverFactoryTaskResponse(input)
  ) {
    return null;
  }

  const appName = input.run.factory?.appName?.trim() || "the application";
  const stackLabel = input.run.factory?.stack.label?.trim() || "the selected stack";

  switch (input.task?.id) {
    case "task-repository-bootstrap":
      return [
        `Scaffolded the initial repository foundation for ${appName} in the connected runtime workspace using ${stackLabel}.`,
        input.appliedWorkspacePlanSummary
          ? `Applied workspace plan: ${input.appliedWorkspacePlanSummary}.`
          : null,
        "The repository bootstrap is now ready for the first implementation slice.",
        input.expectedOutcome
      ]
        .filter(Boolean)
        .join("\n\n");
    case "task-nextjs-shell":
    case "task-frontend-shell":
      return [
        `Built the application shell for ${appName} in the connected runtime workspace using ${stackLabel}.`,
        input.appliedWorkspacePlanSummary
          ? `Applied workspace plan: ${input.appliedWorkspacePlanSummary}.`
          : null,
        input.expectedOutcome
      ]
        .filter(Boolean)
        .join("\n\n");
    case "task-supabase-flow":
    case "task-railway-data-flow":
    case "task-api-flow":
      return [
        `Implemented the first interactive product flow for ${appName} in the connected runtime workspace using local-first application seams for ${stackLabel}.`,
        input.appliedWorkspacePlanSummary
          ? `Applied workspace plan: ${input.appliedWorkspacePlanSummary}.`
          : null,
        input.expectedOutcome
      ]
        .filter(Boolean)
        .join("\n\n");
    default:
      return [
        `Completed the current factory task for ${appName} in the connected runtime workspace using ${stackLabel}.`,
        input.appliedWorkspacePlanSummary
          ? `Applied workspace plan: ${input.appliedWorkspacePlanSummary}.`
          : null,
        input.expectedOutcome
      ]
        .filter(Boolean)
        .join("\n\n");
  }
}

function hasLocalFilePlanBlock(text: string) {
  return LOCAL_FILE_PLAN_BLOCK_PATTERN.test(text);
}

function shouldRequireRuntimeWorkspacePlan(
  run: AgentRunRecord,
  task: ReturnType<typeof resolveCurrentPhaseTask>
) {
  return (
    resolveRuntimeWorkspaceRoot(run) != null &&
    (run.phaseExecution?.current.phaseId === "factory-bootstrap" ||
      run.phaseExecution?.current.phaseId === "factory-implementation") &&
    Boolean(task?.expectedOutcome?.trim())
  );
}

function resolveCurrentPhaseTask(run: AgentRunRecord) {
  const phaseExecution = run.phaseExecution;

  if (!phaseExecution) {
    return null;
  }

  const phase = phaseExecution.phases.find((candidate) => candidate.id === phaseExecution.current.phaseId);
  const story = phase?.userStories.find((candidate) => candidate.id === phaseExecution.current.storyId);

  return story?.tasks.find((candidate) => candidate.id === phaseExecution.current.taskId) ?? null;
}

function resolveRuntimeWorkspaceRoot(run: AgentRunRecord) {
  if (
    run.project?.folder?.provider !== "runtime" ||
    !run.project.folder.displayPath?.trim()
  ) {
    return null;
  }

  return run.project.folder.displayPath.trim();
}

function resolveWorkspaceFilePlanProvider(run: AgentRunRecord) {
  const provider = run.project?.folder?.provider;

  if (
    provider !== "browser-file-system-access" &&
    provider !== "runtime"
  ) {
    return null;
  }

  return provider;
}

function responseIndicatesIncompleteTask(text: string) {
  const normalized = normalizeText(text);
  const incompleteSignals = [
    "incomplete",
    "not complete",
    "blocked",
    "unable to complete",
    "cannot complete",
    "could not complete",
    "is not complete",
    "isn't complete"
  ];

  return incompleteSignals.some((signal) => normalized.includes(signal));
}

function includesNormalized(source: string, target: string) {
  if (!target.trim()) {
    return true;
  }

  return normalizeText(source).includes(normalizeText(target));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueNormalizedPaths(values: string[]) {
  return [...new Set(values.map(normalizePlanPath).filter(Boolean))];
}

function validateGeneratedRuntimeWorkspacePlanOperation(
  value: {
    kind: "mkdir" | "write_file" | "delete_file";
    path: string;
    content?: string;
  },
  index: number
): RuntimeWorkspacePlan["operations"][number] {
  if (value.kind === "write_file") {
    if (typeof value.content !== "string") {
      throw new Error(`Operation ${index + 1} requires string content for write_file.`);
    }

    return {
      kind: "write_file",
      path: value.path,
      content: value.content
    };
  }

  if (value.kind === "mkdir") {
    return {
      kind: "mkdir",
      path: value.path
    };
  }

  return {
    kind: "delete_file",
    path: value.path
  };
}

async function generateStructuredRuntimeWorkspacePlan(input: {
  generateTextImpl: typeof generateText;
  openai: ReturnType<typeof createOpenAI>;
  modelId: string;
  systemPrompt: string;
  prompt: string;
  factoryExecution: boolean;
  onUsage: (generatedWorkspacePlan: UsageCarrier & { output?: unknown }) => void;
}) {
  const generatedWorkspacePlan = await input.generateTextImpl(
    withOptionalMaxOutputTokens(
      {
        model: input.openai(input.modelId),
        system: input.systemPrompt,
        prompt: input.prompt,
        output: Output.object({
          schema: runtimeWorkspaceStructuredOutputSchema
        })
      },
      input.factoryExecution ? null : 900
    )
  );

  input.onUsage(generatedWorkspacePlan);

  return normalizeGeneratedRuntimeWorkspacePlan(generatedWorkspacePlan.output);
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
