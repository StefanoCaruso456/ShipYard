import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { selectSkillSections } from "../context/selectSkillSections";
import { loadSkill } from "../instructions/loadSkill";
import { parseFrontmatter } from "../instructions/parseFrontmatter";
import { parseMarkdownSections } from "../instructions/parseMarkdownSections";
import { createAgentRuntime, instructionPrecedence } from "../runtime/createAgentRuntime";

test("parseFrontmatter returns structured metadata and markdown body", () => {
  const source = `---
id: coding-agent
kind: skill
name: Coding Agent Execution Workflow
version: 1
target: product-agent
applies_to:
  - planner
  - executor
  - verifier
format: markdown-sectioned
---

# Skill

## Core Principle

Body.`;

  const parsed = parseFrontmatter(source);

  assert.equal(parsed.meta.id, "coding-agent");
  assert.deepEqual(parsed.meta.appliesTo, ["planner", "executor", "verifier"]);
  assert.match(parsed.body, /^# Skill/m);
});

test("parseMarkdownSections keeps nested paths and stable section ids", () => {
  const sections = parseMarkdownSections(`# Skill

## Core Principle

Body.

## Operating Procedure

### 10. Multi-Agent Role Behavior

#### Planner

Planner details.`);

  const plannerSection = sections.find(
    (section) => section.path.join(" > ") === "Skill > Operating Procedure > 10. Multi-Agent Role Behavior > Planner"
  );

  assert.ok(plannerSection);
  assert.equal(
    plannerSection.id,
    "skill/operating-procedure/10-multi-agent-role-behavior/planner"
  );
  assert.match(plannerSection.content, /Planner details\./);
});

test("loadSkill rejects missing files", async () => {
  await assert.rejects(
    () => loadSkill("missing-skill.md", process.cwd()),
    /Failed to load instruction file/
  );
});

test("loadSkill rejects malformed frontmatter", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-skill-"));
  const malformedPath = path.join(tempDir, "skill.md");

  try {
    await writeFile(
      malformedPath,
      `---
id coding-agent
---

# Skill`,
      "utf8"
    );

    await assert.rejects(() => loadSkill(malformedPath), /Invalid frontmatter line/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("createAgentRuntime loads the current skill and builds role views", async () => {
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../skill.md"
  );
  const runtime = await createAgentRuntime({ skillPath });

  assert.deepEqual(runtime.instructionPrecedence, instructionPrecedence);
  assert.equal(runtime.skill.meta.id, "coding-agent");
  assert.ok(runtime.roleViews.planner.sectionIds.length > 0);
  assert.ok(
    runtime.roleViews.executor.sectionIds.some((id) =>
      id.endsWith("search-before-editing")
    )
  );
  assert.ok(
    runtime.roleViews.verifier.renderedText.includes("Final Response Format")
  );
});

test("selectSkillSections throws when a role-relevant section is missing", () => {
  const sections = parseMarkdownSections(`# Skill

## Core Principle

Body.

## Operating Procedure

### 7. Validation Policy

Validation.`);

  assert.throws(
    () =>
      selectSkillSections(
        {
          meta: {
            id: "coding-agent",
            kind: "skill",
            name: "Coding Agent Execution Workflow",
            version: 1,
            target: "product-agent",
            appliesTo: ["planner", "executor", "verifier"],
            format: "markdown-sectioned"
          },
          sourcePath: "inline-skill.md",
          rawText: "",
          sections,
          sectionIndex: Object.fromEntries(sections.map((section) => [section.id, section]))
        },
        "planner"
      ),
    /Missing skill section/
  );
});

