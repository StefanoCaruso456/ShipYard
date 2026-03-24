export type ValidationType = "file" | "lint" | "typecheck" | "custom";

export type ValidationStatus =
  | "not_run"
  | "passed"
  | "failed"
  | "rolled_back"
  | "rollback_failed";

export type ValidationResult = {
  success: boolean;
  type: ValidationType;
  errors?: string[];
  warnings?: string[];
  path?: string | null;
  checks?: Record<string, boolean>;
};

export type RollbackResult = {
  attempted: boolean;
  success: boolean;
  path?: string | null;
  message: string;
};

export type RunEventType =
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "story_started"
  | "story_completed"
  | "story_failed"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "validation_gate_passed"
  | "validation_gate_failed"
  | "validation_succeeded"
  | "validation_failed"
  | "rollback_succeeded"
  | "rollback_failed"
  | "planner_step_proposed"
  | "executor_step_completed"
  | "verifier_decision_made"
  | "coordination_conflict_detected"
  | "replan_requested"
  | "retry_scheduled"
  | "execution_failed";

export type RunEvent = {
  at: string;
  type: RunEventType;
  message: string;
  stepId?: string | null;
  phaseId?: string | null;
  storyId?: string | null;
  taskId?: string | null;
  gateId?: string | null;
  path?: string | null;
  toolName?: string | null;
  retryCount?: number;
  validationResult?: ValidationResult | null;
  rollback?: RollbackResult | null;
};
