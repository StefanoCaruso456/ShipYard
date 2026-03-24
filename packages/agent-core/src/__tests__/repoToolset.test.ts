import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRepoToolset } from "../tools/repo/createRepoToolset";

test("listFiles returns repo-relative matches and respects limits", async () => {
  const tempDir = await createTempRepo();

  try {
    const toolset = createRepoToolset({
      rootDir: tempDir,
      defaultListLimit: 1
    });
    const result = await toolset.listFiles({
      glob: "src/*.ts"
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.data.files, ["src/example.ts"]);
    assert.equal(result.data.totalCount, 1);
    assert.equal(result.data.truncated, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readFile blocks paths outside the repo root", async () => {
  const tempDir = await createTempRepo();

  try {
    const toolset = createRepoToolset({
      rootDir: tempDir
    });
    const result = await toolset.readFile({
      path: "../outside.txt"
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, "outside_root");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readFileRange returns only the requested lines", async () => {
  const tempDir = await createTempRepo();

  try {
    const toolset = createRepoToolset({
      rootDir: tempDir
    });
    const result = await toolset.readFileRange({
      path: "src/example.ts",
      startLine: 2,
      endLine: 3
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.data.content, "export function greet(name: string) {\n  return `Hello ${name}`;");
    assert.deepEqual(
      result.data.lines.map((line) => line.lineNumber),
      [2, 3]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("searchRepo returns line matches with line and column details", async () => {
  const tempDir = await createTempRepo();

  try {
    const toolset = createRepoToolset({
      rootDir: tempDir
    });
    const result = await toolset.searchRepo({
      query: "greet",
      limit: 5
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    const readmeMatch = result.data.matches.find((match) => match.path === "README.md");

    assert.ok(result.data.matches.length >= 2);
    assert.deepEqual(readmeMatch, {
      path: "README.md",
      lineNumber: 1,
      column: 5,
      lineText: "Use greet() from the example module."
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempRepo() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-repo-tools-"));

  await mkdir(path.join(tempDir, "src/nested"), { recursive: true });
  await writeFile(
    path.join(tempDir, "src/example.ts"),
    [
      "const greeting = 'hello';",
      "export function greet(name: string) {",
      "  return `Hello ${name}`;",
      "}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "src/nested/helper.ts"),
    "export const helper = () => greet('Shipyard');\n",
    "utf8"
  );
  await writeFile(path.join(tempDir, "README.md"), "Use greet() from the example module.\n", "utf8");

  return tempDir;
}
