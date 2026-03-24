import assert from "node:assert/strict";
import test from "node:test";

import { analyzeTaskAttachment } from "../runtime/analyzeTaskAttachments";

test("analyzeTaskAttachment extracts excerpts from text files", () => {
  const attachment = analyzeTaskAttachment({
    name: "notes.md",
    mimeType: "text/markdown",
    size: 54,
    buffer: Buffer.from("# Shipyard\n\nValidate edits before continuing.\n", "utf8")
  });

  assert.equal(attachment.kind, "text");
  assert.equal(attachment.analysis.status, "analyzed");
  assert.match(attachment.analysis.summary, /Text attachment scanned/);
  assert.match(attachment.analysis.excerpt ?? "", /Validate edits/);
});

test("analyzeTaskAttachment reports JSON keys when possible", () => {
  const attachment = analyzeTaskAttachment({
    name: "task.json",
    mimeType: "application/json",
    size: 48,
    buffer: Buffer.from(JSON.stringify({ title: "Shipyard", status: "ready" }), "utf8")
  });

  assert.equal(attachment.kind, "json");
  assert.equal(attachment.analysis.status, "analyzed");
  assert.match(attachment.analysis.summary, /title, status/);
});

test("analyzeTaskAttachment falls back to metadata for PDFs", () => {
  const attachment = analyzeTaskAttachment({
    name: "brief.pdf",
    mimeType: "application/pdf",
    size: 2048,
    buffer: Buffer.from("%PDF-1.7", "utf8")
  });

  assert.equal(attachment.kind, "pdf");
  assert.equal(attachment.analysis.status, "metadata_only");
  assert.match(attachment.analysis.summary, /PDF document captured/);
  assert.ok(attachment.analysis.warnings.length > 0);
});
