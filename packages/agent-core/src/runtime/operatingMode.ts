import type {
  OperatingMode,
  RequestedOperatingMode,
  RepoToolRequest
} from "./types";

export type OperatingModePolicy = {
  mode: OperatingMode;
  label: string;
  shortLabel: string;
  traceTag: string;
  description: string;
  plannerDirective: string;
  executorDirective: string;
  verifierDirective: string;
  defaultResponseLead: string;
  allowRepoMutations: boolean;
  emphasizeReadOnly: boolean;
  emphasizeDiagnosis: boolean;
  preserveBehavior: boolean;
  defaultMaxOutputTokens: number | null;
};

export const requestedOperatingModes = [
  "auto",
  "build",
  "review",
  "debug",
  "refactor",
  "factory"
] as const satisfies readonly RequestedOperatingMode[];

export const operatingModes = [
  "build",
  "review",
  "debug",
  "refactor",
  "factory"
] as const satisfies readonly OperatingMode[];

const operatingModePolicies: Record<OperatingMode, OperatingModePolicy> = {
  build: {
    mode: "build",
    label: "Build mode",
    shortLabel: "Build",
    traceTag: "mode:build",
    description: "Implement the scoped request and move the work forward concretely.",
    plannerDirective: "Bound the implementation to the requested scope and keep the next step shippable.",
    executorDirective:
      "Prefer producing the implementation outcome directly. When code changes are needed, keep them concrete and scoped.",
    verifierDirective:
      "Approve only when the requested build outcome is materially addressed and the scope stayed controlled.",
    defaultResponseLead: "Start with the implementation outcome or next concrete build step.",
    allowRepoMutations: true,
    emphasizeReadOnly: false,
    emphasizeDiagnosis: false,
    preserveBehavior: false,
    defaultMaxOutputTokens: null
  },
  review: {
    mode: "review",
    label: "Review mode",
    shortLabel: "Review",
    traceTag: "mode:review",
    description: "Review the current state read-only, prioritize risks, and do not silently edit.",
    plannerDirective:
      "Stay read-only, inspect the current request conservatively, and prioritize concrete findings over speculative advice.",
    executorDirective:
      "Do not claim code was changed. Lead with findings ordered by severity, cite concrete risks, and state clearly when no findings are present.",
    verifierDirective:
      "Approve only when the response stayed review-focused, findings-first, and read-only unless an explicit edit request existed.",
    defaultResponseLead: "Lead with review findings, risks, and concrete evidence from the current request.",
    allowRepoMutations: false,
    emphasizeReadOnly: true,
    emphasizeDiagnosis: false,
    preserveBehavior: true,
    defaultMaxOutputTokens: 1200
  },
  debug: {
    mode: "debug",
    label: "Debug mode",
    shortLabel: "Debug",
    traceTag: "mode:debug",
    description: "Diagnose the failure first, then move to the narrowest safe fix.",
    plannerDirective:
      "Prioritize reproducing, isolating, or explaining the failure before expanding into broader implementation work.",
    executorDirective:
      "Lead with the likeliest root cause, observed failure evidence, or next concrete diagnostic step before proposing a fix.",
    verifierDirective:
      "Approve only when the response clearly addresses failure evidence, likely cause, and the safest next debugging move.",
    defaultResponseLead: "Start with the root cause, the strongest evidence, or the next diagnostic step.",
    allowRepoMutations: true,
    emphasizeReadOnly: false,
    emphasizeDiagnosis: true,
    preserveBehavior: false,
    defaultMaxOutputTokens: 1300
  },
  refactor: {
    mode: "refactor",
    label: "Refactor mode",
    shortLabel: "Refactor",
    traceTag: "mode:refactor",
    description: "Improve structure and maintainability while preserving behavior.",
    plannerDirective:
      "Keep the refactor bounded, behavior-preserving, and explicit about any validation expectations.",
    executorDirective:
      "Explain the structural improvement clearly, keep behavior stable, and call out any validation or regression considerations.",
    verifierDirective:
      "Approve only when the response preserved intended behavior while improving structure or maintainability.",
    defaultResponseLead:
      "Start with the structural change and confirm how behavior is being preserved.",
    allowRepoMutations: true,
    emphasizeReadOnly: false,
    emphasizeDiagnosis: false,
    preserveBehavior: true,
    defaultMaxOutputTokens: 1250
  },
  factory: {
    mode: "factory",
    label: "Factory mode",
    shortLabel: "Factory",
    traceTag: "mode:factory",
    description: "Advance the factory delivery pipeline with stage-aware execution.",
    plannerDirective:
      "Keep the work aligned to the current factory stage, repository target, and delivery milestones.",
    executorDirective:
      "Treat the request as part of a staged factory build. Keep execution aligned to the current factory milestone and delivery path.",
    verifierDirective:
      "Approve only when the response advances the current factory stage without drifting outside the build pipeline.",
    defaultResponseLead: "Start with the current factory outcome, stage progress, or next delivery step.",
    allowRepoMutations: true,
    emphasizeReadOnly: false,
    emphasizeDiagnosis: false,
    preserveBehavior: false,
    defaultMaxOutputTokens: 1500
  }
};

export function isRequestedOperatingMode(value: unknown): value is RequestedOperatingMode {
  return typeof value === "string" && requestedOperatingModes.includes(value as RequestedOperatingMode);
}

export function isOperatingMode(value: unknown): value is OperatingMode {
  return typeof value === "string" && operatingModes.includes(value as OperatingMode);
}

export function normalizeRequestedOperatingMode(
  value: RequestedOperatingMode | null | undefined
): RequestedOperatingMode {
  return isRequestedOperatingMode(value) ? value : "auto";
}

export function resolveOperatingMode(input: {
  requestedOperatingMode?: RequestedOperatingMode | null;
  instruction: string;
  toolRequest?: RepoToolRequest | null;
  factory?: unknown;
}): OperatingMode {
  const requestedOperatingMode = normalizeRequestedOperatingMode(input.requestedOperatingMode);

  if (requestedOperatingMode !== "auto") {
    return requestedOperatingMode;
  }

  if (input.factory) {
    return "factory";
  }

  const normalizedInstruction = input.instruction.toLowerCase();

  if (/\b(review|audit|code review|inspect|look for bugs|look for risks|find issues|find risks)\b/.test(normalizedInstruction)) {
    return "review";
  }

  if (
    /\b(debug|bug|fix|error|failing|failure|stack trace|trace|crash|broken|not working|investigate)\b/.test(
      normalizedInstruction
    )
  ) {
    return "debug";
  }

  if (
    /\b(refactor|cleanup|clean up|restructure|rename|extract|simplify|dedupe|reorganize)\b/.test(
      normalizedInstruction
    )
  ) {
    return "refactor";
  }

  return "build";
}

export function getOperatingModePolicy(mode: OperatingMode): OperatingModePolicy {
  return operatingModePolicies[mode];
}
