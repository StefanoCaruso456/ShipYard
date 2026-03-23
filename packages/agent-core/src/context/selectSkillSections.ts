import type { AgentRole, ParsedSkill, RoleSkillView } from "../instructions/types";

const ROLE_SECTION_PATHS: Record<AgentRole, string[][]> = {
  planner: [
    ["Core Principle"],
    ["Operating Procedure", "1. Understand the Request"],
    ["Operating Procedure", "4. Plan Before Editing"],
    ["Operating Procedure", "9. Context Management"],
    ["Operating Procedure", "10. Multi-Agent Role Behavior", "Planner"],
    ["Operating Procedure", "11. Logging / Trace Expectations"]
  ],
  executor: [
    ["Core Principle"],
    ["Operating Procedure", "2. Search Before Editing"],
    ["Operating Procedure", "3. Read Narrowly, Then Expand"],
    ["Operating Procedure", "5. Editing Strategy"],
    ["Operating Procedure", "6. What to Do If the Edit Location Is Wrong"],
    ["Operating Procedure", "7. Validation Policy"],
    ["Operating Procedure", "8. Failure Handling"],
    ["Operating Procedure", "10. Multi-Agent Role Behavior", "Executor"]
  ],
  verifier: [
    ["Core Principle"],
    ["Operating Procedure", "7. Validation Policy"],
    ["Operating Procedure", "8. Failure Handling"],
    ["Operating Procedure", "10. Multi-Agent Role Behavior", "Verifier"],
    ["Operating Procedure", "11. Logging / Trace Expectations"],
    ["Operating Procedure", "12. Final Response Format"]
  ]
};

export function selectSkillSections(
  skill: ParsedSkill,
  role: AgentRole
): RoleSkillView {
  const sections = ROLE_SECTION_PATHS[role].map((relativePath) => {
    const section = skill.sections.find((candidate) =>
      matchesRelativePath(candidate.path, relativePath)
    );

    if (!section) {
      throw new Error(
        `Missing skill section for ${role}: ${relativePath.join(" > ")}`
      );
    }

    return section;
  });

  return {
    role,
    sectionIds: sections.map((section) => section.id),
    sections,
    renderedText: renderSkillView(role, sections)
  };
}

function matchesRelativePath(sectionPath: string[], relativePath: string[]): boolean {
  return (
    sectionPath.length === relativePath.length + 1 &&
    relativePath.every((segment, index) => sectionPath[index + 1] === segment)
  );
}

function renderSkillView(role: AgentRole, sections: RoleSkillView["sections"]): string {
  const blocks = sections.map((section) => {
    const relativePath = section.path.slice(1).join(" > ");
    const content = section.content.trim();

    return content
      ? `## ${relativePath}\n\n${content}`
      : `## ${relativePath}`;
  });

  return [`# ${capitalize(role)} Skill View`, ...blocks].join("\n\n").trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

