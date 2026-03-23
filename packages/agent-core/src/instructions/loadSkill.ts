import { loadInstructionFile } from "./loadInstructionFile";
import { parseFrontmatter } from "./parseFrontmatter";
import { parseMarkdownSections } from "./parseMarkdownSections";
import type { ParsedSkill } from "./types";

export async function loadSkill(
  filePath = "skill.md",
  rootDir = process.cwd()
): Promise<ParsedSkill> {
  const { resolvedPath, source } = await loadInstructionFile(filePath, rootDir);
  const { meta, body } = parseFrontmatter(source);
  const sections = parseMarkdownSections(body);

  if (!hasRelativePath(sections, ["Core Principle"])) {
    throw new Error('Skill file must include a "Core Principle" section.');
  }

  return {
    meta,
    sourcePath: resolvedPath,
    rawText: source,
    sections,
    sectionIndex: Object.fromEntries(sections.map((section) => [section.id, section]))
  };
}

function hasRelativePath(
  sections: ParsedSkill["sections"],
  relativePath: string[]
): boolean {
  return sections.some((section) => matchesRelativePath(section.path, relativePath));
}

function matchesRelativePath(sectionPath: string[], relativePath: string[]): boolean {
  return (
    sectionPath.length === relativePath.length + 1 &&
    relativePath.every((segment, index) => sectionPath[index + 1] === segment)
  );
}

