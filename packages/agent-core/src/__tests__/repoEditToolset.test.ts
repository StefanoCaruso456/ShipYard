import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRepoToolset } from "../tools/repo/createRepoToolset";
import { commitTextFileMutation } from "../tools/repo/editing/commitTextFileMutation";

test("editFileRegion updates only the anchored block", async () => {
  const tempDir = await createTempRepo({
    "src/example.ts": [
      "export function greet(name: string) {",
      "  return `Hello ${name}`;",
      "}",
      "",
      "export function farewell(name: string) {",
      "  return `Bye ${name}`;",
      "}"
    ].join("\n")
  });

  try {
    const toolset = createRepoToolset({ rootDir: tempDir });
    const result = await toolset.editFileRegion({
      path: "src/example.ts",
      anchor: "export function greet",
      currentText: [
        "export function greet(name: string) {",
        "  return `Hello ${name}`;",
        "}"
      ].join("\n"),
      replacementText: [
        "export function greet(name: string) {",
        "  return `Hi ${name}`;",
        "}"
      ].join("\n")
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    const updated = await readFile(path.join(tempDir, "src/example.ts"), "utf8");

    assert.equal(
      updated,
      [
        "export function greet(name: string) {",
        "  return `Hi ${name}`;",
        "}",
        "",
        "export function farewell(name: string) {",
        "  return `Bye ${name}`;",
        "}"
      ].join("\n")
    );
    assert.equal(result.data.validation.changeApplied, true);
    assert.equal(result.data.validation.unchangedOutsideRegion, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("editFileRegion returns anchor_not_found when the anchor is missing", async () => {
  const tempDir = await createTempRepo({
    "src/example.ts": "export const value = 1;\n"
  });

  try {
    const toolset = createRepoToolset({ rootDir: tempDir });
    const result = await toolset.editFileRegion({
      path: "src/example.ts",
      anchor: "missing anchor",
      currentText: "export const value = 1;",
      replacementText: "export const value = 2;"
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, "anchor_not_found");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("editFileRegion returns ambiguous_match when the anchor is not unique", async () => {
  const tempDir = await createTempRepo({
    "src/example.ts": [
      "export function duplicate() {",
      "  return 'first';",
      "}",
      "",
      "export function duplicate() {",
      "  return 'second';",
      "}"
    ].join("\n")
  });

  try {
    const toolset = createRepoToolset({ rootDir: tempDir });
    const result = await toolset.editFileRegion({
      path: "src/example.ts",
      anchor: "export function duplicate",
      currentText: [
        "export function duplicate() {",
        "  return 'first';",
        "}"
      ].join("\n"),
      replacementText: [
        "export function duplicate() {",
        "  return 'updated';",
        "}"
      ].join("\n")
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, "ambiguous_match");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("editFileRegion returns location_mismatch when the expected block does not contain the anchor", async () => {
  const tempDir = await createTempRepo({
    "src/example.ts": [
      "export function greet(name: string) {",
      "  return `Hello ${name}`;",
      "}",
      "",
      "export function farewell(name: string) {",
      "  return `Bye ${name}`;",
      "}"
    ].join("\n")
  });

  try {
    const toolset = createRepoToolset({ rootDir: tempDir });
    const result = await toolset.editFileRegion({
      path: "src/example.ts",
      anchor: "export function greet",
      currentText: [
        "export function farewell(name: string) {",
        "  return `Bye ${name}`;",
        "}"
      ].join("\n"),
      replacementText: [
        "export function farewell(name: string) {",
        "  return `Later ${name}`;",
        "}"
      ].join("\n")
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, "location_mismatch");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("commitTextFileMutation restores the original file when validation fails", async () => {
  const tempDir = await createTempRepo({
    "src/example.ts": "export const greeting = 'hello';\n"
  });
  const filePath = path.join(tempDir, "src/example.ts");
  const originalContent = await readFile(filePath, "utf8");

  try {
    const result = await commitTextFileMutation({
      resolvedPath: filePath,
      originalContent,
      nextContent: "export const greeting = 'changed';\n",
      validate() {
        return {
          ok: false,
          error: {
            code: "validation_failed",
            message: "Forced validation failure."
          }
        };
      }
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.equal(result.error.code, "validation_failed");
    assert.equal(await readFile(filePath, "utf8"), originalContent);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempRepo(files: Record<string, string>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-repo-edit-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const resolvedPath = path.join(tempDir, relativePath);

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content, "utf8");
  }

  return tempDir;
}
