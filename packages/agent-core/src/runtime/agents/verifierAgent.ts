import { getActiveTraceScope, runWithTraceScope } from "../../observability/traceScope";

import type { VerifierStepResult } from "../types";
import type { AgentInvocation, AgentResult, VerifierAgentInput } from "./types";

export async function invokeVerifierAgent(input: {
  invocation: AgentInvocation<VerifierAgentInput>;
  execute: (input: VerifierAgentInput) => VerifierStepResult | Promise<VerifierStepResult>;
}): Promise<AgentResult<VerifierStepResult>> {
  const traceScope = getActiveTraceScope();
  const span = traceScope
    ? await traceScope.activeSpan.startChild({
        name: "verifier",
        spanType: "role",
        inputSummary: `Verifier agent invocation for ${input.invocation.stepId ?? input.invocation.runId}.`,
        metadata: {
          role: input.invocation.role,
          correlationId: input.invocation.correlationId,
          stepId: input.invocation.stepId
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
            () => Promise.resolve(input.execute(input.invocation.input))
          )
        : await Promise.resolve(input.execute(input.invocation.input));
    const metadata = {
      decision: output.decision,
      intentMatched: output.intentMatched,
      targetMatched: output.targetMatched,
      validationPassed: output.validationPassed,
      sideEffectsDetected: output.sideEffectsDetected,
      consumedContextSectionIds: output.consumedContextSectionIds
    };

    span?.annotate(metadata);
    await span?.end({
      status: output.decision === "fail" ? "failed" : "completed",
      outputSummary: output.summary
    });

    return {
      role: "verifier",
      stepId: output.stepId,
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
      role: "verifier",
      stepId: input.invocation.stepId,
      status: "failure",
      output: null,
      correlationId: input.invocation.correlationId,
      error: message
    };
  }
}
