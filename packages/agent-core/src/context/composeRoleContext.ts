import type { AgentRole } from "../instructions/types";
import type { ExternalContextInput } from "../runtime/types";
import {
  countTextTokens,
  getRoleContextPolicy,
  getSectionTokenLimit,
  truncateTextToTokenLimit
} from "./policy";
import type {
  ContextPayloadSection,
  OmittedContextSection,
  RoleContextPayload
} from "./types";

const nonDroppableSectionIds = new Set([
  "runtime-contract",
  "task-objective",
  "task-input",
  "project-rules",
  "skill-guidance",
  "specialist-skill-guidance",
  "current-run-state"
]);

const externalContextPriorities: Record<AgentRole, Record<ExternalContextInput["kind"], number>> = {
  planner: {
    spec: 0,
    schema: 1,
    prior_output: 2,
    test_result: 3,
    diff_summary: 4,
    validation_target: 5
  },
  executor: {
    spec: 0,
    schema: 1,
    prior_output: 2,
    diff_summary: 3,
    test_result: 4,
    validation_target: 5
  },
  verifier: {
    test_result: 0,
    validation_target: 1,
    diff_summary: 2,
    schema: 3,
    prior_output: 4,
    spec: 5
  }
};

export function buildExternalContextSections(input: {
  role: AgentRole;
  externalContext: ExternalContextInput[];
}): {
  sections: ContextPayloadSection[];
  omittedSections: OmittedContextSection[];
} {
  if (input.externalContext.length === 0) {
    return {
      sections: [],
      omittedSections: [
        {
          id: "external-context",
          title: "External context",
          precedence: "live execution context",
          source: "run.context.externalContext",
          reason: "No external context items were provided."
        }
      ]
    };
  }

  const ordered = input.externalContext
    .slice()
    .sort((left, right) => {
      const priority =
        externalContextPriorities[input.role][left.kind] -
        externalContextPriorities[input.role][right.kind];

      if (priority !== 0) {
        return priority;
      }

      return left.id.localeCompare(right.id);
    });

  return {
    sections: ordered.map((item, index) => ({
      id: `external-context:${item.id}`,
      title: `External ${formatExternalContextKind(item.kind)}: ${item.title}`,
      precedence: "live execution context",
      source: item.source?.trim() ? item.source.trim() : `run.context.externalContext[${index}]`,
      format: item.format ?? "text",
      content: item.content,
      metadata: {
        contextKind: item.kind,
        contextItemId: item.id,
        contextTitle: item.title,
        contextSource: item.source?.trim() ? item.source.trim() : null
      }
    })),
    omittedSections: []
  };
}

export function finalizeRoleContextPayload(input: {
  role: AgentRole;
  runId: string;
  assembledAt: string;
  sections: ContextPayloadSection[];
  omittedSections: OmittedContextSection[];
}): RoleContextPayload {
  const policy = getRoleContextPolicy(input.role);
  const maxPromptChars = policy.maxPromptChars;
  const maxPromptTokens = policy.maxPromptTokens;
  const workingSections = input.sections.map((section) => applySectionLimit(input.role, section));
  const omittedSections = [...input.omittedSections];

  let prompt = renderPrompt(input.role, workingSections);
  let usedPromptTokens = countTextTokens(prompt);
  const omittedForBudgetSectionIds: string[] = [];

  while (prompt.length > maxPromptChars || usedPromptTokens > maxPromptTokens) {
    const droppableIndex = findLastDroppableSectionIndex(workingSections);

    if (droppableIndex < 0) {
      break;
    }

    const [removed] = workingSections.splice(droppableIndex, 1);

    omittedForBudgetSectionIds.push(removed.id);
    omittedSections.push({
      id: removed.id,
      title: removed.title,
      precedence: removed.precedence,
      source: removed.source,
      reason: `Omitted to stay within the ${input.role} context budget of ${maxPromptTokens} tokens and ${maxPromptChars} characters.`
    });
    prompt = renderPrompt(input.role, workingSections);
    usedPromptTokens = countTextTokens(prompt);
  }

  return {
    role: input.role,
    runId: input.runId,
    assembledAt: input.assembledAt,
    precedence: [
      "runtime/system contract",
      "task objective and current task input",
      "project rules",
      "skill/runtime behavior guidance",
      "live execution context",
      "rolling summary / prior step state"
    ],
    sections: workingSections,
    omittedSections,
    budget: {
      maxPromptChars,
      maxPromptTokens,
      maxOutputTokens: policy.maxOutputTokens,
      usedPromptChars: prompt.length,
      usedPromptTokens,
      truncatedSectionIds: workingSections
        .filter((section) => section.metadata?.truncated === true)
        .map((section) => section.id),
      omittedForBudgetSectionIds
    },
    prompt
  };
}

function renderPrompt(role: AgentRole, sections: ContextPayloadSection[]) {
  return [
    `# ${role[0]?.toUpperCase()}${role.slice(1)} Context Payload`,
    ...sections.map(
      (section) =>
        `## ${section.title}\nSource: ${section.source}\nPrecedence: ${section.precedence}\n\n${section.content}`
    )
  ].join("\n\n");
}

function applySectionLimit(role: AgentRole, section: ContextPayloadSection): ContextPayloadSection {
  const maxTokens = getSectionTokenLimit(role, section.id);
  const truncated = truncateTextToTokenLimit({
    text: section.content,
    maxTokens,
    suffix: `\n\n[Truncated for ${role} context budget. Original length: ${section.content.length} chars.]`
  });

  if (!truncated.truncated) {
    return section;
  }

  return {
    ...section,
    content: truncated.text,
    metadata: {
      ...(section.metadata ?? {}),
      truncated: true,
      originalLength: section.content.length,
      retainedLength: truncated.text.length,
      originalTokenCount: truncated.originalTokenCount,
      retainedTokenCount: truncated.retainedTokenCount,
      budgetLimitTokens: maxTokens
    }
  };
}

function findLastDroppableSectionIndex(sections: ContextPayloadSection[]) {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    if (!nonDroppableSectionIds.has(sections[index]?.id ?? "")) {
      return index;
    }
  }

  return -1;
}

function formatExternalContextKind(kind: ExternalContextInput["kind"]) {
  switch (kind) {
    case "spec":
      return "spec";
    case "schema":
      return "schema";
    case "prior_output":
      return "prior output";
    case "test_result":
      return "test result";
    case "diff_summary":
      return "diff summary";
    case "validation_target":
      return "validation target";
  }
}
