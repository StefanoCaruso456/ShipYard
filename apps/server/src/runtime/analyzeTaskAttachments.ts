import { randomUUID } from "node:crypto";
import path from "node:path";

import type { RunAttachment, RunAttachmentKind } from "@shipyard/agent-core";

export type UploadedTaskAttachment = {
  name: string;
  mimeType: string | null;
  size: number;
  buffer: Buffer;
};

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".env",
  ".csv",
  ".tsv",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sh",
  ".zsh",
  ".bash",
  ".log"
]);

export function analyzeTaskAttachments(files: UploadedTaskAttachment[]): RunAttachment[] {
  return files.map((file) => analyzeTaskAttachment(file));
}

export function analyzeTaskAttachment(file: UploadedTaskAttachment): RunAttachment {
  const kind = inferAttachmentKind(file.name, file.mimeType);
  const analysis = analyzeAttachmentByKind(file, kind);

  return {
    id: randomUUID(),
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    kind,
    analysis
  };
}

function analyzeAttachmentByKind(
  file: UploadedTaskAttachment,
  kind: RunAttachmentKind
): RunAttachment["analysis"] {
  switch (kind) {
    case "text":
    case "code":
      return analyzeTextAttachment(file, kind);
    case "json":
      return analyzeJsonAttachment(file);
    case "csv":
      return analyzeDelimitedAttachment(file);
    case "image":
      return {
        status: "metadata_only",
        summary: `Image attachment ready for visual review (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: []
      };
    case "pdf":
      return {
        status: "metadata_only",
        summary: `PDF document captured for runtime review (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["Text extraction for PDFs is not wired yet, so analysis is metadata-only."]
      };
    case "document":
      return {
        status: "metadata_only",
        summary: `Document attachment captured (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["This document type is stored and described, but deep extraction is not available yet."]
      };
    case "audio":
      return {
        status: "metadata_only",
        summary: `Audio attachment captured (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["Audio transcription is not wired yet, so this file is available as metadata-only context."]
      };
    case "video":
      return {
        status: "metadata_only",
        summary: `Video attachment captured (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["Video transcription and frame analysis are not wired yet."]
      };
    case "archive":
      return {
        status: "metadata_only",
        summary: `Archive attachment captured (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["Archive expansion is not wired yet, so the runtime only records metadata."]
      };
    case "binary":
    case "unknown":
    default:
      return {
        status: "metadata_only",
        summary: `Binary attachment captured (${formatBytes(file.size)}).`,
        excerpt: null,
        warnings: ["The runtime could not safely extract text from this file type."]
      };
  }
}

function analyzeTextAttachment(
  file: UploadedTaskAttachment,
  kind: Extract<RunAttachmentKind, "text" | "code">
): RunAttachment["analysis"] {
  if (looksBinary(file.buffer)) {
    return {
      status: "metadata_only",
      summary: `The ${kind} attachment looks binary, so only metadata was captured.`,
      excerpt: null,
      warnings: ["Binary bytes were detected while trying to decode this attachment."]
    };
  }

  const decoded = decodeText(file.buffer);
  const normalized = decoded.trim();

  return {
    status: "analyzed",
    summary:
      kind === "code"
        ? `Code attachment scanned (${countLines(decoded)} lines, ${formatBytes(file.size)}).`
        : `Text attachment scanned (${countLines(decoded)} lines, ${formatBytes(file.size)}).`,
    excerpt: takeExcerpt(normalized),
    warnings: normalized.length > 1600 ? ["Excerpt truncated to keep runtime context compact."] : []
  };
}

function analyzeJsonAttachment(file: UploadedTaskAttachment): RunAttachment["analysis"] {
  if (looksBinary(file.buffer)) {
    return {
      status: "metadata_only",
      summary: "JSON attachment could not be decoded safely, so only metadata was captured.",
      excerpt: null,
      warnings: ["Binary bytes were detected while decoding this JSON attachment."]
    };
  }

  const decoded = decodeText(file.buffer);

  try {
    const parsed = JSON.parse(decoded) as unknown;
    const topLevelKeys =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 8) : [];

    return {
      status: "analyzed",
      summary: topLevelKeys.length
        ? `JSON attachment scanned with top-level keys: ${topLevelKeys.join(", ")}.`
        : "JSON attachment scanned successfully.",
      excerpt: takeExcerpt(decoded.trim()),
      warnings: decoded.trim().length > 1600 ? ["Excerpt truncated to keep runtime context compact."] : []
    };
  } catch {
    return {
      status: "metadata_only",
      summary: "JSON attachment was uploaded, but parsing failed.",
      excerpt: takeExcerpt(decoded.trim()),
      warnings: ["The file extension or MIME type suggested JSON, but parsing failed."]
    };
  }
}

function analyzeDelimitedAttachment(file: UploadedTaskAttachment): RunAttachment["analysis"] {
  if (looksBinary(file.buffer)) {
    return {
      status: "metadata_only",
      summary: "Delimited data attachment looks binary, so only metadata was captured.",
      excerpt: null,
      warnings: ["Binary bytes were detected while decoding this attachment."]
    };
  }

  const decoded = decodeText(file.buffer);
  const rows = decoded.split(/\r?\n/).filter(Boolean);
  const delimiter = decoded.includes("\t") ? "\t" : ",";
  const headerColumns = rows[0]?.split(delimiter).map((value) => value.trim()).filter(Boolean) ?? [];

  return {
    status: "analyzed",
    summary: headerColumns.length
      ? `Table attachment scanned with ${headerColumns.length} column(s): ${headerColumns.slice(0, 6).join(", ")}.`
      : `Table attachment scanned (${rows.length} populated row(s)).`,
    excerpt: takeExcerpt(rows.slice(0, 6).join("\n")),
    warnings: rows.length > 6 ? ["Only the first rows are included in the runtime excerpt."] : []
  };
}

function inferAttachmentKind(name: string, mimeType: string | null): RunAttachmentKind {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";
  const extension = path.extname(name).toLowerCase();

  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }

  if (normalizedMimeType === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }

  if (normalizedMimeType === "application/json" || extension === ".json") {
    return "json";
  }

  if (
    normalizedMimeType === "text/csv" ||
    normalizedMimeType === "text/tab-separated-values" ||
    extension === ".csv" ||
    extension === ".tsv"
  ) {
    return "csv";
  }

  if (normalizedMimeType.startsWith("text/")) {
    return extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx"
      ? "code"
      : "text";
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return extension === ".csv" || extension === ".tsv"
      ? "csv"
      : extension === ".json"
        ? "json"
        : [".ts", ".tsx", ".js", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".sql", ".sh", ".zsh", ".bash"].includes(extension)
          ? "code"
          : "text";
  }

  if ([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".pages", ".numbers", ".key"].includes(extension)) {
    return "document";
  }

  if ([".zip", ".tar", ".gz", ".tgz", ".rar", ".7z"].includes(extension)) {
    return "archive";
  }

  if (normalizedMimeType.startsWith("application/")) {
    return "binary";
  }

  return "unknown";
}

function looksBinary(buffer: Buffer) {
  if (buffer.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;

  for (const byte of buffer.subarray(0, Math.min(buffer.length, 4096))) {
    if (byte === 0) {
      return true;
    }

    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / Math.min(buffer.length, 4096) > 0.1;
}

function decodeText(buffer: Buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function takeExcerpt(value: string) {
  if (!value) {
    return null;
  }

  return value.length > 1600 ? `${value.slice(0, 1597).trimEnd()}...` : value;
}

function countLines(value: string) {
  return value === "" ? 0 : value.split(/\r?\n/).length;
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
