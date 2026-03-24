import type { RoleContextPayload } from "../../context/types";
import type { AgentInstructionRuntime } from "../../instructions/types";
import type {
  AgentRunRecord,
  AgentRunResult,
  ExecuteRun,
  ExecutorStepResult,
  PlannerStep,
  PlannerStepResult,
  Task,
  VerifierStepResult
} from "../types";

export type OrchestrationAgentRole = "planner" | "executor" | "verifier";

export type AgentExecutionStatus = "success" | "failure";

export type AgentInvocation<Input = unknown> = {
  runId: string;
  stepId: string | null;
  role: OrchestrationAgentRole;
  input: Input;
  correlationId: string;
};

export type AgentResult<Output = unknown> = {
  role: OrchestrationAgentRole;
  stepId: string | null;
  status: AgentExecutionStatus;
  output: Output | null;
  correlationId: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export type PlannerAgentInput = {
  run: AgentRunRecord;
  task: Task | null;
  payload: RoleContextPayload | null;
  iteration: number;
};

export type ExecutorAgentInput = {
  run: AgentRunRecord;
  plannerStep: PlannerStep;
  payload: RoleContextPayload | null;
  executeRun: ExecuteRun;
  instructionRuntime: AgentInstructionRuntime;
};

export type ExecutorAgentOutput = {
  executorResult: ExecutorStepResult;
  result: AgentRunResult | null;
};

export type VerifierAgentInput = {
  run: AgentRunRecord;
  task: Task | null;
  plannerResult: PlannerStepResult;
  executorResult: ExecutorStepResult;
  executionResult: AgentRunResult | null;
  payload: RoleContextPayload | null;
};
