import { getActiveTraceScope, runWithTraceScope } from "../../observability/traceScope";

import type { PlannerStepResult } from "../types";
import type { AgentInvocation, AgentResult, PlannerAgentInput } from "./types";

export async function invokePlannerAgent(input: {
  invocation: AgentInvocation<PlannerAgentInput>;
  execute: (input: PlannerAgentInput) => PlannerStepResult | Promise<PlannerStepResult>;
}): Promise<AgentResult<PlannerStepResult>> {
  const traceScope = getActiveTraceScope();
  const span = traceScope
      ? await traceScope.activeSpan.startChild({
        name: "planner",
        spanType: "role",
        inputSummary: "Planner agent invocation.",
        metadata: {
          role: input.invocation.role,
          correlationId: input.invocation.correlationId,
          iteration: input.invocation.input.iteration
        },
        tags: ["role", "role:planner"]
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
            () => Promise.resolve(input.execute(input.invocation.input))
          )
        : await Promise.resolve(input.execute(input.invocation.input));
    const metadata = {
      consumedContextSectionIds: output.consumedContextSectionIds,
      validationTargetCount: output.step.validationTargets.length,
      toolName: output.step.requiredTool ?? null
    };

    span?.annotate(metadata);
    await span?.end({
      status: "completed",
      outputSummary: output.summary
    });

    return {
      role: "planner",
      stepId: output.step.id,
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
      role: "planner",
      stepId: input.invocation.stepId,
      status: "failure",
      output: null,
      correlationId: input.invocation.correlationId,
      error: message
    };
  }
}
