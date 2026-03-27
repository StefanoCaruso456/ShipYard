import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { AgentRunRecord, RelevantFileContext } from "./types";

export type RepoIntelligenceSymbolKind =
  | "class"
  | "component"
  | "enum"
  | "function"
  | "interface"
  | "type"
  | "variable";

export type RepoIntelligenceSymbol = {
  name: string;
  kind: RepoIntelligenceSymbolKind;
  line: number;
  signatureText: string | null;
};

export type RepoIntelligenceIndexedFile = {
  path: string;
  extension: string;
  basename: string;
  pathTokens: string[];
  symbols: RepoIntelligenceSymbol[];
};

export type RepoIntelligenceSnapshot = {
  rootDir: string;
  builtAt: string;
  fileCount: number;
  symbolCount: number;
  files: RepoIntelligenceIndexedFile[];
};

export type RepoRelevantFileSuggestion = RelevantFileContext & {
  score: number;
  matchedTerms: string[];
  matchedSymbols: string[];
};

type RankedFileCandidate = {
  file: RepoIntelligenceIndexedFile;
  score: number;
  matchedTerms: Set<string>;
  matchedSymbols: Set<string>;
  bestSymbol: RepoIntelligenceSymbol | null;
  bestSymbolScore: number;
};

const CACHE_TTL_MS = 5_000;
const MAX_INDEXED_FILE_BYTES = 256 * 1024;
const DEFAULT_RELEVANT_FILE_LIMIT = 5;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".shipyard",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules"
]);
const INDEXED_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);
const SYMBOL_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "build",
  "by",
  "do",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "make",
  "need",
  "of",
  "on",
  "or",
  "please",
  "ship",
  "should",
  "start",
  "task",
  "that",
  "the",
  "this",
  "to",
  "update",
  "use",
  "using",
  "we",
  "with",
  "work"
]);

const repoIndexCache = new Map<
  string,
  {
    expiresAt: number;
    snapshot: RepoIntelligenceSnapshot;
  }
>();

export function clearRepoIntelligenceCache(rootDir?: string) {
  if (rootDir) {
    repoIndexCache.delete(path.resolve(rootDir));
    return;
  }

  repoIndexCache.clear();
}

export function buildRepoIntelligenceIndex(rootDir: string): RepoIntelligenceSnapshot {
  const normalizedRoot = path.resolve(rootDir);
  const cached = repoIndexCache.get(normalizedRoot);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  const files = collectIndexedFiles(normalizedRoot);
  const snapshot: RepoIntelligenceSnapshot = {
    rootDir: normalizedRoot,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    symbolCount: files.reduce((sum, file) => sum + file.symbols.length, 0),
    files
  };

  repoIndexCache.set(normalizedRoot, {
    expiresAt: now + CACHE_TTL_MS,
    snapshot
  });

  return snapshot;
}

export function suggestRelevantFilesFromRepo(input: {
  rootDir: string;
  instruction: string;
  objective?: string | null;
  limit?: number;
}): RepoRelevantFileSuggestion[] {
  const queryText = [input.objective, input.instruction].filter(Boolean).join("\n");
  const queryTokens = tokenizeSearchText(queryText);

  if (queryTokens.length === 0) {
    return [];
  }

  const rawQuery = queryText.toLowerCase();
  const snapshot = buildRepoIntelligenceIndex(input.rootDir);
  const ranked = snapshot.files
    .map((file) => scoreIndexedFile(file, rawQuery, queryTokens))
    .filter((candidate): candidate is RankedFileCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.matchedSymbols.size !== left.matchedSymbols.size) {
        return right.matchedSymbols.size - left.matchedSymbols.size;
      }

      if (right.matchedTerms.size !== left.matchedTerms.size) {
        return right.matchedTerms.size - left.matchedTerms.size;
      }

      return left.file.path.localeCompare(right.file.path);
    })
    .slice(0, Math.max(1, input.limit ?? DEFAULT_RELEVANT_FILE_LIMIT));

  return ranked.map((candidate) => ({
    path: candidate.file.path,
    excerpt: candidate.bestSymbol?.signatureText ?? undefined,
    startLine: candidate.bestSymbol?.line,
    endLine: candidate.bestSymbol?.line,
    source: "repo-intelligence",
    reason: buildSuggestionReason(candidate),
    score: candidate.score,
    matchedTerms: [...candidate.matchedTerms],
    matchedSymbols: [...candidate.matchedSymbols]
  }));
}

export function resolveRepoIntelligenceRoot(
  run: Pick<AgentRunRecord, "factory" | "project">,
  fallbackRootDir?: string | null
) {
  const factoryRoot = run.factory?.repository.localPath?.trim();

  if (factoryRoot) {
    return path.resolve(factoryRoot);
  }

  if (run.project?.folder?.provider === "browser-file-system-access") {
    return null;
  }

  const runtimeProjectRoot = run.project?.folder?.displayPath?.trim();

  if (run.project?.folder?.provider === "runtime" && runtimeProjectRoot) {
    return path.resolve(runtimeProjectRoot);
  }

  if (fallbackRootDir?.trim()) {
    return path.resolve(fallbackRootDir);
  }

  return null;
}

export function resolveRelevantFilesForRun(
  run: AgentRunRecord,
  fallbackRootDir?: string | null,
  limit = DEFAULT_RELEVANT_FILE_LIMIT
): RelevantFileContext[] {
  if ((run.context.relevantFiles ?? []).length > 0) {
    return run.context.relevantFiles;
  }

  const toolPath = extractToolPathFromRun(run);

  if (toolPath) {
    return [
      {
        path: toolPath,
        source: "toolRequest",
        reason: "Derived from the active repo tool request."
      }
    ];
  }

  const repoRoot = resolveRepoIntelligenceRoot(run, fallbackRootDir);

  if (!repoRoot) {
    return [];
  }

  return suggestRelevantFilesFromRepo({
    rootDir: repoRoot,
    instruction: run.instruction,
    objective: run.context.objective ?? run.title ?? null,
    limit
  });
}

function collectIndexedFiles(rootDir: string) {
  const files: RepoIntelligenceIndexedFile[] = [];

  walkDirectory(rootDir, rootDir, files);

  return files;
}

function walkDirectory(rootDir: string, currentDir: string, files: RepoIntelligenceIndexedFile[]) {
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;

  try {
    entries = readdirSync(currentDir, {
      encoding: "utf8",
      withFileTypes: true
    });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        walkDirectory(rootDir, absolutePath, files);
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const indexedFile = indexFile(rootDir, absolutePath);

    if (indexedFile) {
      files.push(indexedFile);
    }
  }
}

function indexFile(rootDir: string, absolutePath: string): RepoIntelligenceIndexedFile | null {
  const relativePath = normalizeRelativePath(rootDir, absolutePath);
  const extension = path.extname(relativePath).toLowerCase();

  if (!extension || !INDEXED_TEXT_EXTENSIONS.has(extension)) {
    return {
      path: relativePath,
      extension,
      basename: path.basename(relativePath, extension),
      pathTokens: tokenizeSearchText(relativePath),
      symbols: []
    };
  }

  let size = 0;

  try {
    size = statSync(absolutePath).size;
  } catch {
    return null;
  }

  if (size > MAX_INDEXED_FILE_BYTES) {
    return {
      path: relativePath,
      extension,
      basename: path.basename(relativePath, extension),
      pathTokens: tokenizeSearchText(relativePath),
      symbols: []
    };
  }

  let content = "";

  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }

  if (content.includes("\u0000")) {
    return null;
  }

  return {
    path: relativePath,
    extension,
    basename: path.basename(relativePath, extension),
    pathTokens: tokenizeSearchText(relativePath),
    symbols: SYMBOL_EXTENSIONS.has(extension) ? extractSymbols(content) : []
  };
}

function extractSymbols(content: string): RepoIntelligenceSymbol[] {
  const symbols: RepoIntelligenceSymbol[] = [];
  const lines = content.split(/\r?\n/);
  const symbolPatterns: Array<{
    kind: RepoIntelligenceSymbolKind;
    pattern: RegExp;
  }> = [
    {
      kind: "function",
      pattern: /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "function",
      pattern: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "function",
      pattern: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "class",
      pattern: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "class",
      pattern: /^\s*class\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "interface",
      pattern: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "interface",
      pattern: /^\s*interface\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "type",
      pattern: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "type",
      pattern: /^\s*type\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "enum",
      pattern: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "enum",
      pattern: /^\s*enum\s+([A-Za-z_$][\w$]*)\b/
    },
    {
      kind: "component",
      pattern: /^\s*export\s+const\s+([A-Z][\w$]*)\s*=\s*(?:async\s*)?(?:\(|<)/
    },
    {
      kind: "component",
      pattern: /^\s*const\s+([A-Z][\w$]*)\s*=\s*(?:async\s*)?(?:\(|<)/
    },
    {
      kind: "variable",
      pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/
    },
    {
      kind: "variable",
      pattern: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/
    }
  ];

  for (const [index, line] of lines.entries()) {
    for (const candidate of symbolPatterns) {
      const match = line.match(candidate.pattern);
      const name = match?.[1]?.trim();

      if (!name) {
        continue;
      }

      if (symbols.some((symbol) => symbol.name === name && symbol.line === index + 1)) {
        continue;
      }

      symbols.push({
        name,
        kind: candidate.kind,
        line: index + 1,
        signatureText: line.trim().slice(0, 180) || null
      });
      break;
    }
  }

  return symbols;
}

function scoreIndexedFile(
  file: RepoIntelligenceIndexedFile,
  rawQuery: string,
  queryTokens: string[]
): RankedFileCandidate | null {
  let score = 0;
  const matchedTerms = new Set<string>();
  const matchedSymbols = new Set<string>();
  let bestSymbol: RepoIntelligenceSymbol | null = null;
  let bestSymbolScore = 0;
  const basenameLower = file.basename.toLowerCase();
  const pathLower = file.path.toLowerCase();
  const basenameTokens = tokenizeSearchText(file.basename);
  const prefersTests = queryTokens.includes("test") || queryTokens.includes("tests") || queryTokens.includes("spec");

  if (rawQuery.includes(basenameLower) && basenameLower.length > 2) {
    score += 8;
    matchedTerms.add(file.basename);
  }

  for (const token of queryTokens) {
    if (basenameTokens.includes(token)) {
      score += 7;
      matchedTerms.add(token);
      continue;
    }

    if (file.pathTokens.includes(token)) {
      score += 4;
      matchedTerms.add(token);
      continue;
    }

    if (pathLower.includes(token)) {
      score += 2;
      matchedTerms.add(token);
    }
  }

  const symbolMatches = file.symbols
    .map((symbol) => ({
      symbol,
      score: scoreSymbol(symbol, rawQuery, queryTokens)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (symbolMatches.length > 0) {
    bestSymbol = symbolMatches[0]?.symbol ?? null;
    bestSymbolScore = symbolMatches[0]?.score ?? 0;
    score += bestSymbolScore;

    for (const [index, candidate] of symbolMatches.entries()) {
      matchedSymbols.add(candidate.symbol.name);

      if (index === 0) {
        continue;
      }

      score += Math.max(1, Math.floor(candidate.score * 0.35));
    }
  }

  if (!prefersTests && (pathLower.includes("__tests__/") || pathLower.includes(".test.") || pathLower.includes(".spec."))) {
    score -= 6;
  }

  if (score <= 0) {
    return null;
  }

  return {
    file,
    score,
    matchedTerms,
    matchedSymbols,
    bestSymbol,
    bestSymbolScore
  };
}

function scoreSymbol(
  symbol: RepoIntelligenceSymbol,
  rawQuery: string,
  queryTokens: string[]
) {
  const lowerName = symbol.name.toLowerCase();
  const symbolTokens = tokenizeSearchText(symbol.name);
  let score = 0;

  if (rawQuery.includes(lowerName) && lowerName.length > 2) {
    score += 12;
  }

  for (const token of queryTokens) {
    if (symbolTokens.includes(token)) {
      score += 6;
      continue;
    }

    if (lowerName.includes(token)) {
      score += 3;
    }
  }

  if (score > 0 && symbol.kind === "component") {
    score += 1;
  }

  return score;
}

function buildSuggestionReason(candidate: RankedFileCandidate) {
  const parts: string[] = [];

  if (candidate.matchedTerms.size > 0) {
    parts.push(`matched path terms ${formatList([...candidate.matchedTerms])}`);
  }

  if (candidate.matchedSymbols.size > 0) {
    parts.push(`matched symbols ${formatList([...candidate.matchedSymbols])}`);
  }

  if (parts.length === 0) {
    return "Ranked from the repository path and symbol index.";
  }

  return parts.join("; ");
}

function extractToolPathFromRun(run: AgentRunRecord) {
  if (!run.toolRequest) {
    return null;
  }

  const input = run.toolRequest.input as Record<string, unknown>;
  const candidate = input.path;

  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function tokenizeSearchText(value: string) {
  const prepared = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./\\-]+/g, " ")
    .toLowerCase();

  return [...new Set(
    prepared
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
  )];
}

function formatList(values: string[]) {
  return values.slice(0, 4).join(", ");
}

function normalizeRelativePath(rootDir: string, absolutePath: string) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}
