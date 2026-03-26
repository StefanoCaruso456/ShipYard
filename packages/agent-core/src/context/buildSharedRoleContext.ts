import type {
  AgentInstructionRuntime,
  AgentRole,
  RoleSkillView
} from "../instructions/types";
import type { AgentRunRecord, AgentRuntimeStatus, RepoToolResult } from "../runtime/types";
import type { ProjectRulesDocument, SharedRoleContext } from "./types";

export function buildSharedRoleContext(input: {
  instructionRuntime: AgentInstructionRuntime;
  projectRules: ProjectRulesDocument;
  role: AgentRole;
  run: AgentRunRecord;
  runtimeStatus: AgentRuntimeStatus;
}): SharedRoleContext {
  return {
    runtimeContract: buildRuntimeContract(input.role),
    projectRules: input.projectRules,
    roleSkillView: selectRoleSkillView(input.instructionRuntime.roleViews[input.role]),
    run: input.run,
    runtimeStatus: input.runtimeStatus,
    taskObjective: deriveTaskObjective(input.run),
    constraints: input.run.context.constraints ?? [],
    relevantFiles: deriveRelevantFiles(input.run),
    externalContext: input.run.context.externalContext ?? [],
    recentToolResults: deriveRecentToolResults(input.run),
    validationTargets: deriveValidationTargets(input.run),
    knownFailures: deriveKnownFailures(input.run),
    rollingSummary: input.run.rollingSummary?.text ?? null
  };
}

function buildRuntimeContract(role: AgentRole) {
  const roleDirective =
    role === "planner"
      ? "Plan only. Do not assume execution has already happened."
      : role === "executor"
        ? "Execute the scoped task using only the context provided."
        : "Verify the latest execution output and judge correctness conservatively.";

  return [
    "You are operating inside Shipyard Runtime.",
    `Active role: ${role}.`,
    roleDirective,
    "Follow the provided context precedence order exactly.",
    "Use only the sections included in this payload. Treat omitted sections as unavailable."
  ].join("\n");
}

function selectRoleSkillView(roleSkillView: RoleSkillView) {
  return roleSkillView;
}

function deriveTaskObjective(run: AgentRunRecord) {
  const activeTask = extractActiveTask(run);

  if (activeTask?.expectedOutcome) {
    return activeTask.expectedOutcome;
  }

  if (run.context.objective) {
    return run.context.objective;
  }

  if (run.title) {
    return run.title;
  }

  return summarizeInstruction(run.instruction);
}

function summarizeInstruction(instruction: string) {
  const compact = instruction.replace(/\s+/g, " ").trim();

  if (compact.length <= 120) {
    return compact;
  }

  return `${compact.slice(0, 117).trimEnd()}...`;
}

function deriveRelevantFiles(run: AgentRunRecord) {
  if ((run.context.relevantFiles ?? []).length > 0) {
    return run.context.relevantFiles;
  }

  const toolPath = extractToolPath(run);

  if (!toolPath) {
    return [];
  }

  return [
    {
      path: toolPath,
      source: "toolRequest",
      reason: "Derived from the active repo tool request."
    }
  ];
}

function deriveRecentToolResults(run: AgentRunRecord): RepoToolResult[] {
  if (run.result?.toolResult) {
    return [run.result.toolResult];
  }

  return [];
}

function deriveValidationTargets(run: AgentRunRecord) {
  if ((run.context.validationTargets ?? []).length > 0) {
    return run.context.validationTargets;
  }

  const validationPath =
    run.lastValidationResult?.path ??
    run.error?.path ??
    extractToolPath(run);

  return validationPath ? [validationPath] : [];
}

function deriveKnownFailures(run: AgentRunRecord) {
  const failures: string[] = [];

  if (run.error?.message) {
    failures.push(run.error.message);
  }

  for (const event of run.events) {
    if (event.type === "validation_failed" || event.type === "execution_failed") {
      failures.push(event.message);
    }
  }

  return [...new Set(failures)];
}

function extractToolPath(run: AgentRunRecord) {
  if (!run.toolRequest) {
    return null;
  }

  if ("path" in run.toolRequest.input && typeof run.toolRequest.input.path === "string") {
    return run.toolRequest.input.path;
  }

  return null;
}

function extractActiveTask(run: AgentRunRecord) {
  const phaseId = run.phaseExecution?.current.phaseId;
  const storyId = run.phaseExecution?.current.storyId;
  const taskId = run.phaseExecution?.current.taskId;

  if (!phaseId || !storyId || !taskId) {
    return null;
  }

  const phase = run.phaseExecution?.phases.find((candidate) => candidate.id === phaseId);
  const story = phase?.userStories.find((candidate) => candidate.id === storyId);

  return story?.tasks.find((candidate) => candidate.id === taskId) ?? null;
}
