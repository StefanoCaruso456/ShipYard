import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectRulesDocument } from "@shipyard/agent-core";

export async function loadProjectRules(rootDir: string): Promise<ProjectRulesDocument> {
  const sourcePath = path.resolve(rootDir, "instructions/rules/project-rules.md");
  const content = await readFile(sourcePath, "utf8");

  return {
    sourcePath,
    loadedAt: new Date().toISOString(),
    content: content.trim()
  };
}
