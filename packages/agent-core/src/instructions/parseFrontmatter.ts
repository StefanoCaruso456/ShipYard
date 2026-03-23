import type { AgentRole, SkillMeta } from "./types";

const SUPPORTED_ROLES = new Set<AgentRole>(["planner", "executor", "verifier"]);

type ParsedFrontmatter = {
  meta: SkillMeta;
  body: string;
};

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);

  if (!match) {
    throw new Error("Expected YAML frontmatter at the top of the skill file.");
  }

  const [, frontmatterBlock] = match;
  const body = source.slice(match[0].length);
  const parsed = parseFrontmatterBlock(frontmatterBlock);

  const meta: SkillMeta = {
    id: readRequiredString(parsed, "id"),
    kind: readLiteral(parsed, "kind", "skill"),
    name: readRequiredString(parsed, "name"),
    version: readRequiredNumber(parsed, "version"),
    target: readLiteral(parsed, "target", "product-agent"),
    appliesTo: readRoles(parsed, "applies_to"),
    format: readLiteral(parsed, "format", "markdown-sectioned")
  };

  return {
    meta,
    body
  };
}

function parseFrontmatterBlock(block: string): Record<string, string | string[]> {
  const parsed: Record<string, string | string[]> = {};
  let activeArrayKey: string | null = null;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      continue;
    }

    const arrayItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (arrayItemMatch) {
      if (!activeArrayKey) {
        throw new Error(`Unexpected list item in frontmatter: "${rawLine}"`);
      }

      const currentValue = parsed[activeArrayKey];
      if (!Array.isArray(currentValue)) {
        throw new Error(`Frontmatter key "${activeArrayKey}" is not an array.`);
      }

      currentValue.push(stripQuotes(arrayItemMatch[1].trim()));
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyValueMatch) {
      throw new Error(`Invalid frontmatter line: "${rawLine}"`);
    }

    const [, key, value] = keyValueMatch;
    if (key in parsed) {
      throw new Error(`Duplicate frontmatter key "${key}".`);
    }

    if (!value) {
      parsed[key] = [];
      activeArrayKey = key;
      continue;
    }

    parsed[key] = stripQuotes(value);
    activeArrayKey = null;
  }

  return parsed;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readRequiredString(
  parsed: Record<string, string | string[]>,
  key: string
): string {
  const value = parsed[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Frontmatter key "${key}" must be a non-empty string.`);
  }

  return value;
}

function readRequiredNumber(
  parsed: Record<string, string | string[]>,
  key: string
): number {
  const value = readRequiredString(parsed, key);
  const parsedNumber = Number(value);

  if (!Number.isInteger(parsedNumber)) {
    throw new Error(`Frontmatter key "${key}" must be an integer.`);
  }

  return parsedNumber;
}

function readLiteral<T extends string>(
  parsed: Record<string, string | string[]>,
  key: string,
  expected: T
): T {
  const value = readRequiredString(parsed, key);

  if (value !== expected) {
    throw new Error(`Frontmatter key "${key}" must equal "${expected}".`);
  }

  return expected;
}

function readRoles(
  parsed: Record<string, string | string[]>,
  key: string
): AgentRole[] {
  const value = parsed[key];

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Frontmatter key "${key}" must be a non-empty array.`);
  }

  const roles = value.map((entry) => {
    if (!SUPPORTED_ROLES.has(entry as AgentRole)) {
      throw new Error(`Unsupported role "${entry}" in frontmatter key "${key}".`);
    }

    return entry as AgentRole;
  });

  return [...new Set(roles)];
}

