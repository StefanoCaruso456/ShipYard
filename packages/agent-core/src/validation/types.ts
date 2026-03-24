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
  | "validation_succeeded"
  | "validation_failed"
  | "rollback_succeeded"
  | "rollback_failed"
  | "retry_scheduled"
  | "execution_failed";

export type RunEvent = {
  at: string;
  type: RunEventType;
  message: string;
  path?: string | null;
  toolName?: string | null;
  retryCount?: number;
  validationResult?: ValidationResult | null;
  rollback?: RollbackResult | null;
};
