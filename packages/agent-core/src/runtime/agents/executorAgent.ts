import { getActiveTraceScope, runWithTraceScope } from "../../observability/traceScope";

import type { AgentInvocation, AgentResult, ExecutorAgentInput, ExecutorAgentOutput } from "./types";

export async function invokeExecutorAgent(input: {
  invocation: AgentInvocation<ExecutorAgentInput>;
  execute: (input: ExecutorAgentInput) => Promise<ExecutorAgentOutput>;
}): Promise<AgentResult<ExecutorAgentOutput>> {
  const traceScope = getActiveTraceScope();
  const span = traceScope
    ? await traceScope.activeSpan.startChild({
        name: `agent:executor:${input.invocation.stepId ?? input.invocation.runId}`,
        spanType: "role",
        inputSummary: input.invocation.input.plannerStep.summary,
        metadata: {
          role: input.invocation.role,
          correlationId: input.invocation.correlationId,
          stepId: input.invocation.stepId,
          toolName: input.invocation.input.plannerStep.requiredTool ?? null
        }
      })
    : null;

  try {
    const output =
      span && traceScope
        ? await runWithTraceScope(
            {
              ...traceScope,
              activeSpan: span
            },
            () => input.execute(input.invocation.input)
          )
        : await input.execute(input.invocation.input);
    const metadata = {
      consumedContextSectionIds: output.executorResult.consumedContextSectionIds,
      changedFiles: output.executorResult.changedFiles,
      executionSuccess: output.executorResult.success,
      mode: output.executorResult.mode ?? null
    };

    span?.annotate(metadata);
    await span?.end({
      status: output.executorResult.success ? "completed" : "failed",
      outputSummary: output.executorResult.summary,
      error: output.executorResult.error?.message ?? null
    });

    return {
      role: "executor",
      stepId: output.executorResult.stepId,
      status: "success",
      output,
      correlationId: input.invocation.correlationId,
      metadata
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await span?.end({
      status: "failed",
      error: message
    });

    return {
      role: "executor",
      stepId: input.invocation.stepId,
      status: "failure",
      output: null,
      correlationId: input.invocation.correlationId,
      error: message
    };
  }
}
