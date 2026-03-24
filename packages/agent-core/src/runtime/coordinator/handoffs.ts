import { randomUUID } from "node:crypto";

import type { AgentInvocation, OrchestrationAgentRole } from "../agents/types";

export type AgentHandoff<Payload = unknown> = {
  runId: string;
  stepId: string | null;
  source: "coordinator" | OrchestrationAgentRole;
  target: OrchestrationAgentRole;
  purpose: string;
  payload: Payload;
  createdAt: number;
  correlationId: string;
};

export function createAgentHandoff<Payload>(input: {
  runId: string;
  stepId: string | null;
  source: AgentHandoff["source"];
  target: AgentHandoff["target"];
  purpose: string;
  payload: Payload;
  correlationId?: string;
}): AgentHandoff<Payload> {
  return {
    ...input,
    createdAt: Date.now(),
    correlationId: input.correlationId ?? randomUUID()
  };
}

export function createAgentInvocation<Payload>(
  handoff: AgentHandoff<Payload>
): AgentInvocation<Payload> {
  return {
    runId: handoff.runId,
    stepId: handoff.stepId,
    role: handoff.target,
    input: handoff.payload,
    correlationId: handoff.correlationId
  };
}
