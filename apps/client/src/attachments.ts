import type {
  AttachmentCard,
  AttachmentKind,
  ComposerAttachment,
  RuntimeAttachment
} from "./types";

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sql",
  ".sh",
  ".zsh",
  ".bash"
]);

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".sass",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".log"
]);

export async function buildComposerAttachments(fileList: FileList | File[]) {
  return Promise.all(Array.from(fileList).map((file) => buildComposerAttachment(file)));
}

export async function buildComposerAttachment(file: File): Promise<ComposerAttachment> {
  const kind = inferAttachmentKind(file.name, file.type);
  const analysis = await analyzeLocalAttachment(file, kind);

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    mimeType: file.type || null,
    kind,
    file,
    previewUrl: analysis.previewUrl,
    summary: analysis.summary,
    excerpt: analysis.excerpt,
    source: "local"
  };
}

export function toAttachmentCard(
  attachment: RuntimeAttachment,
  previewLookup?: Record<string, ComposerAttachment>
): AttachmentCard {
  const preview = previewLookup?.[attachment.name];

  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    summary: attachment.analysis.summary,
    excerpt: attachment.analysis.excerpt,
    previewUrl: preview?.previewUrl ?? null,
    source: preview ? "local" : "runtime"
  };
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentBadge(kind: AttachmentKind, name: string) {
  if (kind === "image") {
    return "IMG";
  }

  if (kind === "pdf") {
    return "PDF";
  }

  if (kind === "json") {
    return "JSON";
  }

  if (kind === "csv") {
    return "CSV";
  }

  if (kind === "code") {
    return "CODE";
  }

  const extension = fileExtension(name);
  return extension ? extension.slice(1).toUpperCase().slice(0, 4) : "FILE";
}

function inferAttachmentKind(name: string, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();
  const extension = fileExtension(name);

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

  if (normalizedMimeType === "text/csv" || extension === ".csv" || extension === ".tsv") {
    return "csv";
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }

  if (normalizedMimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) {
    return "text";
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

async function analyzeLocalAttachment(file: File, kind: AttachmentKind) {
  switch (kind) {
    case "image":
      return analyzeImageAttachment(file);
    case "text":
    case "code":
      return analyzeTextAttachment(file, kind);
    case "json":
      return analyzeJsonAttachment(file);
    case "csv":
      return analyzeDelimitedAttachment(file);
    case "pdf":
      return {
        previewUrl: null,
        summary: `PDF document ready for upload (${formatAttachmentSize(file.size)}).`,
        excerpt: null
      };
    case "audio":
      return {
        previewUrl: null,
        summary: `Audio attachment ready for upload (${formatAttachmentSize(file.size)}).`,
        excerpt: null
      };
    case "video":
      return {
        previewUrl: null,
        summary: `Video attachment ready for upload (${formatAttachmentSize(file.size)}).`,
        excerpt: null
      };
    default:
      return {
        previewUrl: null,
        summary: `${capitalize(kind)} attachment ready for upload (${formatAttachmentSize(file.size)}).`,
        excerpt: null
      };
  }
}

async function analyzeImageAttachment(file: File) {
  const previewUrl = await readFileAsDataUrl(file);
  const dimensions = await measureImage(previewUrl);

  return {
    previewUrl,
    summary: dimensions
      ? `Image scanned locally at ${dimensions.width}×${dimensions.height}.`
      : `Image attachment ready for upload (${formatAttachmentSize(file.size)}).`,
    excerpt: null
  };
}

async function analyzeTextAttachment(file: File, kind: "text" | "code") {
  const text = await file.text();

  return {
    previewUrl: null,
    summary:
      kind === "code"
        ? `Code file scanned locally (${countLines(text)} lines).`
        : `Text file scanned locally (${countLines(text)} lines).`,
    excerpt: takeExcerpt(text.trim())
  };
}

async function analyzeJsonAttachment(file: File) {
  const text = await file.text();

  try {
    const parsed = JSON.parse(text) as unknown;
    const keys =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 6) : [];

    return {
      previewUrl: null,
      summary: keys.length
        ? `JSON scanned locally with keys: ${keys.join(", ")}.`
        : "JSON scanned locally.",
      excerpt: takeExcerpt(text.trim())
    };
  } catch {
    return {
      previewUrl: null,
      summary: "JSON-looking file attached, but local parsing failed.",
      excerpt: takeExcerpt(text.trim())
    };
  }
}

async function analyzeDelimitedAttachment(file: File) {
  const text = await file.text();
  const rows = text.split(/\r?\n/).filter(Boolean);
  const delimiter = text.includes("\t") ? "\t" : ",";
  const headers = rows[0]?.split(delimiter).map((value) => value.trim()).filter(Boolean) ?? [];

  return {
    previewUrl: null,
    summary: headers.length
      ? `Table scanned locally with columns: ${headers.slice(0, 5).join(", ")}.`
      : `Table scanned locally (${rows.length} row(s)).`,
    excerpt: takeExcerpt(rows.slice(0, 5).join("\n"))
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Image preview generation failed."));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Image preview generation failed."));
    reader.readAsDataURL(file);
  });
}

function measureImage(source: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function takeExcerpt(value: string) {
  if (!value) {
    return null;
  }

  return value.length > 280 ? `${value.slice(0, 277).trimEnd()}...` : value;
}

function countLines(value: string) {
  return value === "" ? 0 : value.split(/\r?\n/).length;
}

function fileExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
