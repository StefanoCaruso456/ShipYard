import type {
  SpecialistAgentDefinition,
  SpecialistAgentRegistry,
  SpecialistAgentSkillRef,
  SpecialistAgentTypeId,
  Task,
  TeamSkillId,
  UserStory
} from "./types";
import type { RepoToolName } from "../tools/repo/types";

const TEAM_SKILL_REFS: Record<TeamSkillId, SpecialistAgentSkillRef> = {
  production_lead: {
    id: "production_lead",
    title: "Production Lead",
    relativePath: "instructions/skills/production-lead.md"
  },
  execution_subagent: {
    id: "execution_subagent",
    title: "Execution Subagent",
    relativePath: "instructions/skills/execution-subagent.md"
  },
  frontend_dev: {
    id: "frontend_dev",
    title: "Frontend Dev",
    relativePath: "instructions/skills/frontend-dev.md"
  },
  backend_dev: {
    id: "backend_dev",
    title: "Backend Dev",
    relativePath: "instructions/skills/backend-dev.md"
  },
  repo_tools_dev: {
    id: "repo_tools_dev",
    title: "Repo Tools Dev",
    relativePath: "instructions/skills/repo-tools-dev.md"
  },
  observability_dev: {
    id: "observability_dev",
    title: "Observability Dev",
    relativePath: "instructions/skills/observability-dev.md"
  },
  rebuild_dev: {
    id: "rebuild_dev",
    title: "Rebuild Dev",
    relativePath: "instructions/skills/rebuild-dev.md"
  }
};

const READ_ONLY_TOOLS: RepoToolName[] = ["list_files", "read_file", "read_file_range", "search_repo"];
const MUTATION_TOOLS: RepoToolName[] = ["edit_file_region", "create_file", "delete_file"];

export const DEFAULT_SPECIALIST_AGENT_REGISTRY: SpecialistAgentRegistry = {
  version: 1,
  definitions: [
    {
      agentTypeId: "frontend_dev",
      label: "Frontend Dev",
      description: "Owns client-side UI behavior, layout, state, and interaction work.",
      domainTags: ["frontend", "ui", "client", "react", "css"],
      skillRefs: [TEAM_SKILL_REFS.frontend_dev],
      toolScope: {
        allowedToolNames: [...READ_ONLY_TOOLS, ...MUTATION_TOOLS]
      },
      allowedHandoffTargets: ["execution_subagent", "production_lead"],
      canSpawnExecutionSubagents: true,
      defaultValidationFocus: ["client typecheck", "client build", "UI behavior"]
    },
    {
      agentTypeId: "backend_dev",
      label: "Backend Dev",
      description: "Owns runtime, APIs, persistence, and server-side execution behavior.",
      domainTags: ["backend", "runtime", "server", "api", "database"],
      skillRefs: [TEAM_SKILL_REFS.backend_dev],
      toolScope: {
        allowedToolNames: [...READ_ONLY_TOOLS, ...MUTATION_TOOLS]
      },
      allowedHandoffTargets: ["execution_subagent", "production_lead"],
      canSpawnExecutionSubagents: true,
      defaultValidationFocus: ["server typecheck", "server tests", "runtime behavior"]
    },
    {
      agentTypeId: "repo_tools_dev",
      label: "Repo Tools Dev",
      description: "Owns repository search, read, edit, and validation tool behavior.",
      domainTags: ["repo", "tools", "editing", "search", "validation"],
      skillRefs: [TEAM_SKILL_REFS.repo_tools_dev],
      toolScope: {
        allowedToolNames: [...READ_ONLY_TOOLS, ...MUTATION_TOOLS]
      },
      allowedHandoffTargets: ["execution_subagent", "production_lead"],
      canSpawnExecutionSubagents: true,
      defaultValidationFocus: ["tool result", "edit validation", "rollback safety"]
    },
    {
      agentTypeId: "observability_dev",
      label: "Observability Dev",
      description: "Owns tracing, logging, metrics, run summaries, and debugging surfaces.",
      domainTags: ["observability", "tracing", "langsmith", "logging", "metrics"],
      skillRefs: [TEAM_SKILL_REFS.observability_dev],
      toolScope: {
        allowedToolNames: [...READ_ONLY_TOOLS, ...MUTATION_TOOLS]
      },
      allowedHandoffTargets: ["execution_subagent", "production_lead"],
      canSpawnExecutionSubagents: true,
      defaultValidationFocus: ["trace integrity", "log shape", "debug routes"]
    },
    {
      agentTypeId: "rebuild_dev",
      label: "Rebuild Dev",
      description: "Owns directed rebuild runs, integration scope, and intervention capture.",
      domainTags: ["rebuild", "integration", "migration", "ship"],
      skillRefs: [TEAM_SKILL_REFS.rebuild_dev],
      toolScope: {
        allowedToolNames: [...READ_ONLY_TOOLS, ...MUTATION_TOOLS]
      },
      allowedHandoffTargets: ["execution_subagent", "production_lead"],
      canSpawnExecutionSubagents: true,
      defaultValidationFocus: ["integration behavior", "intervention log", "rebuild artifact quality"]
    }
  ]
};

export function createSpecialistAgentRegistry(): SpecialistAgentRegistry {
  return {
    version: DEFAULT_SPECIALIST_AGENT_REGISTRY.version,
    definitions: DEFAULT_SPECIALIST_AGENT_REGISTRY.definitions.map((definition) => ({
      ...definition,
      domainTags: [...definition.domainTags],
      skillRefs: definition.skillRefs.map((skillRef) => ({ ...skillRef })),
      toolScope: {
        allowedToolNames: [...definition.toolScope.allowedToolNames]
      },
      allowedHandoffTargets: [...definition.allowedHandoffTargets],
      defaultValidationFocus: [...definition.defaultValidationFocus]
    }))
  };
}

export function listTeamSkillRefs(registry = DEFAULT_SPECIALIST_AGENT_REGISTRY): SpecialistAgentSkillRef[] {
  const refs = [
    TEAM_SKILL_REFS.production_lead,
    TEAM_SKILL_REFS.execution_subagent,
    ...registry.definitions.flatMap((definition) => definition.skillRefs)
  ];

  return uniqueSkillRefs(refs);
}

export function getSpecialistDefinition(
  agentTypeId: SpecialistAgentTypeId,
  registry = DEFAULT_SPECIALIST_AGENT_REGISTRY
): SpecialistAgentDefinition {
  const definition = registry.definitions.find((candidate) => candidate.agentTypeId === agentTypeId);

  if (!definition) {
    throw new Error(`Unknown specialist agent type: ${agentTypeId}`);
  }

  return definition;
}

export function resolveSpecialistAgentType(input: {
  story: UserStory;
  task?: Task | null;
}): SpecialistAgentTypeId {
  if (input.task?.requiredSpecialistAgentTypeId) {
    return input.task.requiredSpecialistAgentTypeId;
  }

  if (input.task?.context?.specialistAgentTypeId) {
    return input.task.context.specialistAgentTypeId;
  }

  if (input.story.preferredSpecialistAgentTypeId) {
    return input.story.preferredSpecialistAgentTypeId;
  }

  const haystack = [
    input.story.title,
    input.story.description,
    ...input.story.acceptanceCriteria,
    input.task?.instruction ?? "",
    input.task?.expectedOutcome ?? ""
  ]
    .join(" ")
    .toLowerCase();

  if (matchesAny(haystack, ["frontend", "ui", "react", "component", "css", "layout"])) {
    return "frontend_dev";
  }

  if (matchesAny(haystack, ["trace", "tracing", "langsmith", "metric", "log", "observability"])) {
    return "observability_dev";
  }

  if (matchesAny(haystack, ["repo tool", "edit", "patch", "search", "read_file", "anchor", "diff"])) {
    return "repo_tools_dev";
  }

  if (matchesAny(haystack, ["rebuild", "ship rebuild", "integration", "migration"])) {
    return "rebuild_dev";
  }

  return "backend_dev";
}

function matchesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function uniqueSkillRefs(refs: SpecialistAgentSkillRef[]) {
  const seen = new Set<string>();
  const unique: SpecialistAgentSkillRef[] = [];

  for (const ref of refs) {
    if (seen.has(ref.id)) {
      continue;
    }

    seen.add(ref.id);
    unique.push({ ...ref });
  }

  return unique;
}
