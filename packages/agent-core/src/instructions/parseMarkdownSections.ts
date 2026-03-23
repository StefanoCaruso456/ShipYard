import type { InstructionSection } from "./types";

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/gm;

type HeadingMatch = {
  depth: number;
  title: string;
  start: number;
  bodyStart: number;
};

export function parseMarkdownSections(markdown: string): InstructionSection[] {
  const headings = [...collectHeadings(markdown)];

  if (headings.length === 0) {
    throw new Error("Skill body must contain markdown headings.");
  }

  const sections: InstructionSection[] = [];
  const sectionIds = new Set<string>();
  const pathStack: string[] = [];

  for (const [index, heading] of headings.entries()) {
    pathStack[heading.depth - 1] = heading.title;
    pathStack.length = heading.depth;

    const nextHeadingStart = headings[index + 1]?.start ?? markdown.length;
    const content = markdown.slice(heading.bodyStart, nextHeadingStart).trim();
    const path = [...pathStack];
    const id = path.map(slugify).join("/");

    if (sectionIds.has(id)) {
      throw new Error(`Duplicate markdown section id "${id}".`);
    }

    sectionIds.add(id);
    sections.push({
      id,
      title: heading.title,
      depth: heading.depth,
      path,
      content
    });
  }

  return sections;
}

function* collectHeadings(markdown: string): Generator<HeadingMatch> {
  let match: RegExpExecArray | null;

  while ((match = HEADING_PATTERN.exec(markdown)) !== null) {
    const [fullMatch, hashes, rawTitle] = match;

    yield {
      depth: hashes.length,
      title: rawTitle.trim(),
      start: match.index,
      bodyStart: match.index + fullMatch.length
    };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

