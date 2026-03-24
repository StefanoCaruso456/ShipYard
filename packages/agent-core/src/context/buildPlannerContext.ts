import type { RoleContextPayload, SharedRoleContext } from "./types";

export function buildPlannerContext(shared: SharedRoleContext): RoleContextPayload {
  return buildRolePayload("planner", shared, {
    includeRelevantFiles: true,
    includeRecentToolResults: false,
    includeValidationTargets: true,
    includeKnownFailures: true
  });
}

function buildRolePayload(
  role: "planner",
  shared: SharedRoleContext,
  options: {
    includeRelevantFiles: boolean;
    includeRecentToolResults: boolean;
    includeValidationTargets: boolean;
    includeKnownFailures: boolean;
  }
): RoleContextPayload {
  const assembledAt = new Date().toISOString();
  const sections: RoleContextPayload["sections"] = [];
  const omittedSections: RoleContextPayload["omittedSections"] = [];

  sections.push({
    id: "runtime-contract",
    title: "Runtime contract",
    precedence: "runtime/system contract" as const,
    source: "shipyard-runtime",
    format: "text" as const,
    content: shared.runtimeContract
  });

  sections.push({
    id: "task-objective",
    title: "Task objective",
    precedence: "task objective and current task input" as const,
    source: "run.context.objective | run.title | run.instruction",
    format: "text" as const,
    content: shared.taskObjective
  });

  sections.push({
    id: "task-input",
    title: "Current task input",
    precedence: "task objective and current task input" as const,
    source: "run.instruction",
    format: "text" as const,
    content: shared.run.instruction
  });

  if (shared.constraints.length > 0) {
    sections.push({
      id: "task-constraints",
      title: "Constraints",
      precedence: "task objective and current task input",
      source: "run.context.constraints",
      format: "text",
      content: shared.constraints.map((constraint) => `- ${constraint}`).join("\n")
    });
  } else {
    omittedSections.push({
      id: "task-constraints",
      title: "Constraints",
      precedence: "task objective and current task input",
      source: "run.context.constraints",
      reason: "No task-specific constraints were provided."
    });
  }

  sections.push({
    id: "project-rules",
    title: "Project rules",
    precedence: "project rules",
    source: shared.projectRules.sourcePath,
    format: "markdown",
    content: shared.projectRules.content
  });

  sections.push({
    id: "skill-guidance",
    title: "Planner skill guidance",
    precedence: "skill/runtime behavior guidance",
    source: `${shared.roleSkillView.role} skill view`,
    format: "markdown",
    content: shared.roleSkillView.renderedText
  });

  sections.push({
    id: "current-run-state",
    title: "Current run state",
    precedence: "live execution context",
    source: "runtimeService.getRun + runtimeService.getStatus",
    format: "json",
    content: JSON.stringify(
      {
        runId: shared.run.id,
        status: shared.run.status,
        retryCount: shared.run.retryCount,
        validationStatus: shared.run.validationStatus,
        phaseExecution: shared.run.phaseExecution
          ? {
              status: shared.run.phaseExecution.status,
              current: shared.run.phaseExecution.current,
              progress: shared.run.phaseExecution.progress
            }
          : null,
        workerState: shared.runtimeStatus.workerState,
        queuedRuns: shared.runtimeStatus.queuedRuns
      },
      null,
      2
    )
  });

  if (options.includeRelevantFiles && shared.relevantFiles.length > 0) {
    sections.push({
      id: "relevant-files",
      title: "Relevant files",
      precedence: "live execution context",
      source: "run.context.relevantFiles | derived tool path",
      format: "text",
      content: shared.relevantFiles
        .map((file) => {
          const range =
            typeof file.startLine === "number" && typeof file.endLine === "number"
              ? `:${file.startLine}-${file.endLine}`
              : "";
          const reason = file.reason ? ` — ${file.reason}` : "";
          return `${file.path}${range}${reason}`;
        })
        .join("\n")
    });
  } else {
    omittedSections.push({
      id: "relevant-files",
      title: "Relevant files",
      precedence: "live execution context",
      source: "run.context.relevantFiles | derived tool path",
      reason: "No relevant files were attached to this planner payload."
    });
  }

  if (options.includeValidationTargets && shared.validationTargets.length > 0) {
    sections.push({
      id: "validation-targets",
      title: "Validation targets",
      precedence: "live execution context",
      source: "run.context.validationTargets | derived validation path",
      format: "text",
      content: shared.validationTargets.map((target) => `- ${target}`).join("\n")
    });
  } else {
    omittedSections.push({
      id: "validation-targets",
      title: "Validation targets",
      precedence: "live execution context",
      source: "run.context.validationTargets | derived validation path",
      reason: "No validation targets are known yet."
    });
  }

  if (options.includeKnownFailures && shared.knownFailures.length > 0) {
    sections.push({
      id: "known-failures",
      title: "Known failures",
      precedence: "live execution context",
      source: "run.error | run.events",
      format: "text",
      content: shared.knownFailures.map((failure) => `- ${failure}`).join("\n")
    });
  } else {
    omittedSections.push({
      id: "known-failures",
      title: "Known failures",
      precedence: "live execution context",
      source: "run.error | run.events",
      reason: "No known failures are attached to this run."
    });
  }

  omittedSections.push({
    id: "recent-tool-results",
    title: "Recent tool results",
    precedence: "live execution context",
    source: "run.result.toolResult",
    reason: "Planner payloads omit raw tool results to stay scoped to planning."
  });

  if (shared.rollingSummary) {
    sections.push({
      id: "rolling-summary",
      title: "Rolling summary",
      precedence: "rolling summary / prior step state",
      source: "run.rollingSummary",
      format: "text",
      content: shared.rollingSummary
    });
  } else {
    omittedSections.push({
      id: "rolling-summary",
      title: "Rolling summary",
      precedence: "rolling summary / prior step state",
      source: "run.rollingSummary",
      reason: "No rolling summary exists for this run yet."
    });
  }

  return {
    role,
    runId: shared.run.id,
    assembledAt,
    precedence: [
      "runtime/system contract",
      "task objective and current task input",
      "project rules",
      "skill/runtime behavior guidance",
      "live execution context",
      "rolling summary / prior step state"
    ],
    sections,
    omittedSections,
    prompt: renderPrompt(role, sections)
  };
}

function renderPrompt(role: string, sections: RoleContextPayload["sections"]) {
  return [
    `# ${role[0]?.toUpperCase()}${role.slice(1)} Context Payload`,
    ...sections.map(
      (section) =>
        `## ${section.title}\nSource: ${section.source}\nPrecedence: ${section.precedence}\n\n${section.content}`
    )
  ].join("\n\n");
}
