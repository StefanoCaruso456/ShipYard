import { z } from "zod";

import type {
  ControlPlaneArtifact,
  ControlPlaneArtifactKind,
  ControlPlaneEntityKind,
  ControlPlaneHandoff,
  ControlPlaneHandoffStatus,
  ControlPlaneRole,
  ExternalContextFormat,
  ExternalContextInput,
  ExternalContextKind,
  RelevantFileContext,
  RunContextInput,
  SpecialistAgentTypeId,
  TeamSkillId
} from "./types";

const specialistAgentTypeIds = [
  "frontend_dev",
  "backend_dev",
  "repo_tools_dev",
  "observability_dev",
  "rebuild_dev"
] as const satisfies readonly SpecialistAgentTypeId[];

const teamSkillIds = [
  "production_lead",
  "execution_subagent",
  ...specialistAgentTypeIds
] as const satisfies readonly TeamSkillId[];

const controlPlaneRoles = [
  "orchestrator",
  "production_lead",
  "specialist_dev",
  "execution_subagent"
] as const satisfies readonly ControlPlaneRole[];

const controlPlaneEntityKinds = [
  "phase",
  "story",
  "task"
] as const satisfies readonly ControlPlaneEntityKind[];

const controlPlaneArtifactKinds = [
  "plan",
  "requirements",
  "architecture_decision",
  "subtask_breakdown",
  "delegation_brief",
  "task_result",
  "validation_report",
  "delivery_summary",
  "failure_report"
] as const satisfies readonly ControlPlaneArtifactKind[];

const controlPlaneHandoffStatuses = [
  "created",
  "accepted",
  "completed"
] as const satisfies readonly ControlPlaneHandoffStatus[];

const externalContextKinds = [
  "spec",
  "schema",
  "prior_output",
  "test_result",
  "diff_summary",
  "validation_target"
] as const satisfies readonly ExternalContextKind[];

const externalContextFormats = [
  "text",
  "markdown",
  "json"
] as const satisfies readonly ExternalContextFormat[];

const trimmedStringSchema = z.string().transform((value) => value.trim());
const nonEmptyTrimmedStringSchema = trimmedStringSchema.refine(
  (value) => value.length > 0,
  "Must be a non-empty string."
);
const positiveLineSchema = z.number().int().positive();

export const specialistAgentTypeIdSchema = z.enum(specialistAgentTypeIds);
export const teamSkillIdSchema = z.enum(teamSkillIds);
export const controlPlaneRoleSchema = z.enum(controlPlaneRoles);
export const controlPlaneEntityKindSchema = z.enum(controlPlaneEntityKinds);
export const controlPlaneArtifactKindSchema = z.enum(controlPlaneArtifactKinds);
export const controlPlaneHandoffStatusSchema = z.enum(controlPlaneHandoffStatuses);
export const externalContextKindSchema = z.enum(externalContextKinds);
export const externalContextFormatSchema = z.enum(externalContextFormats);

export const relevantFileContextSchema = z
  .object({
    path: nonEmptyTrimmedStringSchema,
    excerpt: z.union([z.string(), z.null(), z.undefined()]).optional(),
    startLine: z.union([positiveLineSchema, z.null(), z.undefined()]).optional(),
    endLine: z.union([positiveLineSchema, z.null(), z.undefined()]).optional(),
    source: z.union([z.string(), z.null(), z.undefined()]).optional(),
    reason: z.union([z.string(), z.null(), z.undefined()]).optional()
  })
  .transform(
    (value): RelevantFileContext => ({
      path: value.path,
      excerpt: normalizeOptionalTrimmedString(value.excerpt),
      startLine: typeof value.startLine === "number" ? value.startLine : null,
      endLine: typeof value.endLine === "number" ? value.endLine : null,
      source: normalizeOptionalTrimmedString(value.source),
      reason: normalizeOptionalTrimmedString(value.reason)
    })
  );

export const externalContextInputSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    kind: externalContextKindSchema,
    title: nonEmptyTrimmedStringSchema,
    content: nonEmptyTrimmedStringSchema,
    source: z.union([z.string(), z.null(), z.undefined()]).optional(),
    format: z.union([externalContextFormatSchema, z.null(), z.undefined()]).optional()
  })
  .transform(
    (value): ExternalContextInput => ({
      id: value.id,
      kind: value.kind,
      title: value.title,
      content: value.content,
      source: normalizeOptionalTrimmedString(value.source),
      format: value.format ?? "text"
    })
  );

export const runContextInputSchema = z
  .object({
    objective: z.union([z.string(), z.null(), z.undefined()]).optional(),
    constraints: z.array(z.string()).optional().default([]),
    relevantFiles: z.array(relevantFileContextSchema).optional().default([]),
    externalContext: z.array(externalContextInputSchema).optional().default([]),
    validationTargets: z.array(z.string()).optional().default([]),
    specialistAgentTypeId: z.union([specialistAgentTypeIdSchema, z.null(), z.undefined()]).optional()
  })
  .transform(
    (value): RunContextInput => ({
      objective: normalizeOptionalTrimmedString(value.objective),
      constraints: normalizeStringArray(value.constraints),
      relevantFiles: value.relevantFiles,
      externalContext: value.externalContext,
      validationTargets: normalizeStringArray(value.validationTargets),
      specialistAgentTypeId: value.specialistAgentTypeId ?? null
    })
  );

export const controlPlaneArtifactSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    kind: controlPlaneArtifactKindSchema,
    entityKind: controlPlaneEntityKindSchema,
    entityId: nonEmptyTrimmedStringSchema,
    summary: nonEmptyTrimmedStringSchema,
    createdAt: nonEmptyTrimmedStringSchema,
    producerRole: controlPlaneRoleSchema,
    producerId: nonEmptyTrimmedStringSchema,
    producerAgentTypeId: z.union([teamSkillIdSchema, z.null()]),
    path: z.union([z.string(), z.null()]).optional(),
    payload: z.unknown().optional()
  })
  .transform(
    (value): ControlPlaneArtifact => ({
      id: value.id,
      kind: value.kind,
      entityKind: value.entityKind,
      entityId: value.entityId,
      summary: value.summary,
      createdAt: value.createdAt,
      producerRole: value.producerRole,
      producerId: value.producerId,
      producerAgentTypeId: value.producerAgentTypeId,
      path: normalizeOptionalTrimmedString(value.path),
      payload: (value.payload as ControlPlaneArtifact["payload"] | undefined) ?? null
    })
  );

export const controlPlaneHandoffSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    fromRole: controlPlaneRoleSchema,
    fromId: nonEmptyTrimmedStringSchema,
    fromAgentTypeId: z.union([teamSkillIdSchema, z.null()]),
    toRole: controlPlaneRoleSchema,
    toId: nonEmptyTrimmedStringSchema,
    toAgentTypeId: z.union([teamSkillIdSchema, z.null()]),
    entityKind: controlPlaneEntityKindSchema,
    entityId: nonEmptyTrimmedStringSchema,
    correlationId: nonEmptyTrimmedStringSchema,
    artifactIds: z.array(z.string()).optional().default([]),
    dependencyIds: z.array(z.string()).optional().default([]),
    acceptanceCriteria: z.array(z.string()).optional().default([]),
    validationTargets: z.array(z.string()).optional().default([]),
    purpose: nonEmptyTrimmedStringSchema,
    workPacket: z.unknown().optional(),
    status: controlPlaneHandoffStatusSchema,
    createdAt: nonEmptyTrimmedStringSchema,
    acceptedAt: z.union([z.string(), z.null()]),
    completedAt: z.union([z.string(), z.null()])
  })
  .transform(
    (value): ControlPlaneHandoff => ({
      id: value.id,
      fromRole: value.fromRole,
      fromId: value.fromId,
      fromAgentTypeId: value.fromAgentTypeId,
      toRole: value.toRole,
      toId: value.toId,
      toAgentTypeId: value.toAgentTypeId,
      entityKind: value.entityKind,
      entityId: value.entityId,
      correlationId: value.correlationId,
      artifactIds: normalizeStringArray(value.artifactIds),
      dependencyIds: normalizeStringArray(value.dependencyIds),
      acceptanceCriteria: normalizeStringArray(value.acceptanceCriteria),
      validationTargets: normalizeStringArray(value.validationTargets),
      purpose: value.purpose,
      workPacket: (value.workPacket as ControlPlaneHandoff["workPacket"] | undefined) ?? null,
      status: value.status,
      createdAt: value.createdAt,
      acceptedAt: normalizeOptionalTrimmedString(value.acceptedAt),
      completedAt: normalizeOptionalTrimmedString(value.completedAt)
    })
  );

export function safeParseRunContextInput(
  value: unknown
): { success: true; data: RunContextInput | null } | { success: false; error: string } {
  if (value === undefined || value === null) {
    return {
      success: true,
      data: null
    };
  }

  const result = runContextInputSchema.safeParse(value);

  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }

  return {
    success: false,
    error: formatSchemaIssue("context", result.error.issues[0])
  };
}

export function normalizeRunContextInputValue(value: unknown): RunContextInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyRunContextInput();
  }

  const candidate = value as Record<string, unknown>;
  const specialistAgentTypeIdResult = specialistAgentTypeIdSchema.safeParse(
    candidate.specialistAgentTypeId
  );

  return {
    objective: normalizeOptionalTrimmedString(candidate.objective),
    constraints: normalizeStringArray(candidate.constraints),
    relevantFiles: normalizeSchemaArray(candidate.relevantFiles, relevantFileContextSchema),
    externalContext: normalizeSchemaArray(candidate.externalContext, externalContextInputSchema),
    validationTargets: normalizeStringArray(candidate.validationTargets),
    specialistAgentTypeId: specialistAgentTypeIdResult.success ? specialistAgentTypeIdResult.data : null
  };
}

function createEmptyRunContextInput(): RunContextInput {
  return {
    objective: null,
    constraints: [],
    relevantFiles: [],
    externalContext: [],
    validationTargets: [],
    specialistAgentTypeId: null
  };
}

function normalizeSchemaArray<T>(
  value: unknown,
  schema: z.ZodType<T>
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: T[] = [];

  for (const item of value) {
    const result = schema.safeParse(item);

    if (result.success) {
      normalized.push(result.data);
    }
  }

  return normalized;
}

function normalizeOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function formatSchemaIssue(root: string, issue: z.ZodIssue | undefined) {
  if (!issue) {
    return `${root} is invalid.`;
  }

  const pathSuffix = issue.path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
    .join("");
  const path = `${root}${pathSuffix}`;

  return `${path}: ${issue.message}`;
}
