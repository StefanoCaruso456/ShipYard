import { loadInstructionFile } from "./loadInstructionFile";
import type { TeamSkillDocument } from "./types";

export async function loadSpecialistSkills(
  skillRefs: {
    id: string;
    title: string;
    relativePath: string;
  }[],
  rootDir = process.cwd()
): Promise<Record<string, TeamSkillDocument>> {
  const documents = await Promise.all(
    skillRefs.map(async (skillRef) => {
      const { resolvedPath, source } = await loadInstructionFile(skillRef.relativePath, rootDir);

      return [
        skillRef.id,
        {
          id: skillRef.id,
          title: deriveTitle(source, skillRef.title),
          sourcePath: resolvedPath,
          content: source
        } satisfies TeamSkillDocument
      ] as const;
    })
  );

  return Object.fromEntries(documents);
}

function deriveTitle(source: string, fallback: string) {
  const heading = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}
