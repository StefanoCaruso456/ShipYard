import { spawn } from "node:child_process";
import path from "node:path";

import {
  getActiveTraceScope,
  runWithTraceScope,
  type AgentRunRecord,
  type RepoToolResult,
  type RunTerminalCommandInput,
  type TerminalCommandCategory,
  type TraceMetadata
} from "@shipyard/agent-core";

type ExecuteTerminalToolInput = {
  run: AgentRunRecord;
  input: RunTerminalCommandInput;
  rootDir: string;
  plannedStepId?: string | null;
};

type CommandExecution = {
  status: "completed" | "failed" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: {
    stdout: boolean;
    stderr: boolean;
    combined: boolean;
  };
  durationMs: number;
  errorMessage?: string;
};

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 16_000;
const MAX_COMBINED_OUTPUT_CHARS = 24_000;
const ALLOWED_COMMANDS = new Set([
  "cat",
  "env",
  "find",
  "gh",
  "git",
  "go",
  "head",
  "jest",
  "ls",
  "node",
  "npm",
  "npx",
  "pnpm",
  "printenv",
  "pwd",
  "pyright",
  "pytest",
  "python",
  "python3",
  "rg",
  "sed",
  "tail",
  "tsc",
  "tsx",
  "uv",
  "vitest",
  "wc",
  "yarn"
]);

export async function executeTerminalTool(
  input: ExecuteTerminalToolInput
): Promise<Extract<RepoToolResult, { toolName: "run_terminal_command" }>> {
  const parsed = parseTerminalCommand(input.input.commandLine);

  if (!parsed.ok) {
    return failTerminalTool(input.rootDir, input.input, {
      code: "invalid_input",
      message: parsed.error
    });
  }

  if (!ALLOWED_COMMANDS.has(parsed.command)) {
    return failTerminalTool(input.rootDir, input.input, {
      code: "invalid_input",
      message: `${parsed.command} is not an allowed runtime command.`,
      command: parsed.command
    });
  }

  const cwd = resolveCommandCwd(input.rootDir, input.input.cwd);

  if (!cwd.ok) {
    return failTerminalTool(input.rootDir, input.input, {
      code: cwd.error.code,
      message: cwd.error.message,
      command: parsed.command
    });
  }

  const timeoutMs = normalizeTimeout(input.input.timeoutMs);
  const category = inferCategory(input.input.category, parsed.command, parsed.args);
  const traceScope = getActiveTraceScope();
  const metadata: TraceMetadata = {
    toolName: "run_terminal_command",
    toolCategory: category,
    toolTags: [
      "runtime-tool",
      "tool:run_terminal_command",
      `tool-category:${category}`
    ],
    commandLine: input.input.commandLine.trim(),
    command: parsed.command,
    args: parsed.args,
    cwd: toDisplayPath(input.rootDir, cwd.value),
    timeoutMs,
    plannedStepId: input.plannedStepId ?? null
  };
  const ownsSpan = Boolean(traceScope && traceScope.activeSpan.spanType !== "tool");
  const toolSpan =
    ownsSpan && traceScope
      ? await traceScope.activeSpan.startChild({
          name: `tool:run_terminal_command`,
          spanType: "tool",
          inputSummary: `Run ${input.input.commandLine.trim()}.`,
          metadata,
          tags: ["runtime-tool", "tool:run_terminal_command", `tool-category:${category}`]
        })
      : traceScope?.activeSpan ?? null;

  const executeWithinScope = async () =>
    executeCommand({
      command: parsed.command,
      args: parsed.args,
      cwd: cwd.value,
      timeoutMs
    });

  try {
    toolSpan?.addEvent("terminal_command_started", {
      message: `Running ${input.input.commandLine.trim()}`,
      metadata
    });

    const execution =
      ownsSpan && traceScope && toolSpan
        ? await runWithTraceScope(
            {
              ...traceScope,
              activeSpan: toolSpan
            },
            executeWithinScope
          )
        : await executeWithinScope();

    const combinedOutput = createCombinedOutput(execution.stdout, execution.stderr);
    const truncatedCombined =
      combinedOutput.length > MAX_COMBINED_OUTPUT_CHARS
        ? `${combinedOutput.slice(0, MAX_COMBINED_OUTPUT_CHARS)}\n\n[output truncated]`
        : combinedOutput;
    const baseData = {
      rootDir: input.rootDir,
      cwd: toDisplayPath(input.rootDir, cwd.value),
      commandLine: input.input.commandLine.trim(),
      command: parsed.command,
      args: parsed.args,
      category,
      exitCode: execution.exitCode ?? (execution.status === "completed" ? 0 : 1),
      stdout: execution.stdout,
      stderr: execution.stderr,
      combinedOutput: truncatedCombined,
      truncated: {
        stdout: execution.truncated.stdout,
        stderr: execution.truncated.stderr,
        combined: combinedOutput.length > MAX_COMBINED_OUTPUT_CHARS
      },
      durationMs: execution.durationMs
    } as const;

    if (execution.status !== "completed") {
      const failure = failTerminalTool(input.rootDir, input.input, {
        code: execution.status === "timed_out" ? "timeout_exceeded" : "command_failed",
        message:
          execution.errorMessage ??
          (execution.status === "timed_out"
            ? `${input.input.commandLine.trim()} timed out after ${timeoutMs} ms.`
            : `${input.input.commandLine.trim()} exited with code ${execution.exitCode ?? "unknown"}.`),
        command: input.input.commandLine.trim()
      });
      const failureMessage = !failure.ok ? failure.error.message : execution.errorMessage ?? "Command failed.";

      toolSpan?.addEvent("terminal_command_failed", {
        message: failureMessage,
        metadata: {
          ...metadata,
          exitCode: execution.exitCode,
          stdout: execution.stdout,
          stderr: execution.stderr,
          combinedOutput: truncatedCombined,
          truncated: baseData.truncated
        }
      });

      if (ownsSpan && toolSpan) {
        await toolSpan.end({
          status: "failed",
          outputSummary: summarizeTerminalExecution(baseData),
          error: failureMessage,
          metadata: {
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
            combinedOutput: truncatedCombined,
            truncated: baseData.truncated
          }
        });
      }

      return failure;
    }

    const result: Extract<RepoToolResult, { toolName: "run_terminal_command" }> = {
      ok: true,
      toolName: "run_terminal_command",
      data: baseData
    };

    toolSpan?.addEvent("terminal_command_completed", {
      message: summarizeTerminalExecution(baseData),
      metadata: {
        ...metadata,
        exitCode: baseData.exitCode,
        stdout: baseData.stdout,
        stderr: baseData.stderr,
        combinedOutput: baseData.combinedOutput,
        truncated: baseData.truncated,
        durationMs: baseData.durationMs
      }
    });

    if (ownsSpan && toolSpan) {
      await toolSpan.end({
        status: "completed",
        outputSummary: summarizeTerminalExecution(baseData),
        metadata: {
          exitCode: baseData.exitCode,
          stdout: baseData.stdout,
          stderr: baseData.stderr,
          combinedOutput: baseData.combinedOutput,
          truncated: baseData.truncated,
          durationMs: baseData.durationMs
        }
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    toolSpan?.addEvent("terminal_command_failed", {
      message,
      metadata
    });

    if (ownsSpan && toolSpan) {
      await toolSpan.end({
        status: "failed",
        error: message
      });
    }

    return failTerminalTool(input.rootDir, input.input, {
      code: "command_failed",
      message,
      command: input.input.commandLine.trim()
    });
  }
}

function parseTerminalCommand(commandLine: string):
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string } {
  const trimmed = commandLine.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: "run_terminal_command requires a non-empty commandLine."
    };
  }

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index] ?? "";

    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping || quote) {
    return {
      ok: false,
      error: "commandLine contains an unfinished quote or escape sequence."
    };
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;

  if (!command) {
    return {
      ok: false,
      error: "run_terminal_command requires a command to execute."
    };
  }

  return {
    ok: true,
    command,
    args
  };
}

function normalizeTimeout(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.max(Math.round(value as number), 1_000), MAX_TIMEOUT_MS);
}

function inferCategory(
  requested: TerminalCommandCategory | null | undefined,
  command: string,
  args: string[]
): TerminalCommandCategory {
  if (requested) {
    return requested;
  }

  if (command === "git" || command === "gh") {
    return "git";
  }

  if (
    command === "playwright" ||
    command === "cypress" ||
    args.includes("playwright") ||
    args.includes("cypress")
  ) {
    return "browser";
  }

  if (
    [
      "pnpm",
      "npm",
      "npx",
      "yarn",
      "vitest",
      "jest",
      "pytest",
      "tsc",
      "pyright",
      "go",
      "uv"
    ].includes(command)
  ) {
    return "ci";
  }

  return "shell";
}

function resolveCommandCwd(rootDir: string, cwd: string | undefined):
  | { ok: true; value: string }
  | { ok: false; error: { code: "invalid_input" | "outside_root"; message: string } } {
  if (!cwd || !cwd.trim()) {
    return {
      ok: true,
      value: rootDir
    };
  }

  const resolved = path.resolve(rootDir, cwd.trim());
  const relative = path.relative(rootDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      error: {
        code: "outside_root",
        message: `${cwd.trim()} resolves outside the runtime workspace root.`
      }
    };
  }

  return {
    ok: true,
    value: resolved
  };
}

async function executeCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CommandExecution> {
  const startedAt = Date.now();

  return await new Promise<CommandExecution>((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        status: "timed_out",
        exitCode: null,
        stdout,
        stderr,
        truncated: {
          stdout: stdoutTruncated,
          stderr: stderrTruncated,
          combined: false
        },
        durationMs: Date.now() - startedAt,
        errorMessage: `${input.command} timed out after ${input.timeoutMs} ms.`
      });
    }, input.timeoutMs);

    function appendOutput(
      current: string,
      chunk: Buffer | string,
      maxChars: number
    ): { value: string; truncated: boolean } {
      const next = `${current}${typeof chunk === "string" ? chunk : chunk.toString("utf8")}`;

      if (next.length <= maxChars) {
        return {
          value: next,
          truncated: false
        };
      }

      return {
        value: `${next.slice(0, maxChars)}\n[output truncated]`,
        truncated: true
      };
    }

    function settle(result: CommandExecution) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      const next = appendOutput(stdout, chunk, MAX_OUTPUT_CHARS);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });

    child.stderr.on("data", (chunk) => {
      const next = appendOutput(stderr, chunk, MAX_OUTPUT_CHARS);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
    });

    child.on("error", (error) => {
      settle({
        status: "failed",
        exitCode: null,
        stdout,
        stderr,
        truncated: {
          stdout: stdoutTruncated,
          stderr: stderrTruncated,
          combined: false
        },
        durationMs: Date.now() - startedAt,
        errorMessage: error.message
      });
    });

    child.on("close", (code) => {
      settle({
        status: code === 0 ? "completed" : "failed",
        exitCode: code,
        stdout,
        stderr,
        truncated: {
          stdout: stdoutTruncated,
          stderr: stderrTruncated,
          combined: false
        },
        durationMs: Date.now() - startedAt,
        errorMessage:
          code === 0 ? undefined : `${input.command} exited with code ${code ?? "unknown"}.`
      });
    });
  });
}

function createCombinedOutput(stdout: string, stderr: string) {
  if (stdout.trim() && stderr.trim()) {
    return [`$ stdout`, stdout.trimEnd(), "", `$ stderr`, stderr.trimEnd()].join("\n");
  }

  if (stdout.trim()) {
    return stdout.trimEnd();
  }

  if (stderr.trim()) {
    return [`$ stderr`, stderr.trimEnd()].join("\n");
  }

  return "(no output)";
}

function summarizeTerminalExecution(data: {
  commandLine: string;
  exitCode: number;
  category: TerminalCommandCategory;
}) {
  return `Ran ${data.commandLine} (${data.category}) with exit code ${data.exitCode}.`;
}

function failTerminalTool(
  rootDir: string,
  input: RunTerminalCommandInput,
  error: {
    code: "command_failed" | "invalid_input" | "outside_root" | "timeout_exceeded";
    message: string;
    command?: string;
  }
): Extract<RepoToolResult, { toolName: "run_terminal_command" }> {
  return {
    ok: false,
    toolName: "run_terminal_command",
      error: {
        code: error.code,
        message: error.message,
        command: error.command ?? (input.commandLine.trim() || undefined),
        path: rootDir
      }
  };
}

function toDisplayPath(rootDir: string, resolvedPath: string) {
  const relative = path.relative(rootDir, resolvedPath);
  return relative && !relative.startsWith("..") ? relative : ".";
}
