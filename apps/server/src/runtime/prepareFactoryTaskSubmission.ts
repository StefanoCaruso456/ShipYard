import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compileFactoryTaskSubmission,
  getFactoryStackSummary,
  normalizeFactoryRunInput,
  type SubmitTaskInput
} from "@shipyard/agent-core";

type PrepareFactoryTaskSubmissionOptions = {
  workspaceRoot: string;
  now?: Date;
};

export async function prepareFactoryTaskSubmission(
  submission: SubmitTaskInput,
  options: PrepareFactoryTaskSubmissionOptions
): Promise<SubmitTaskInput> {
  const factory = normalizeFactoryRunInput(submission.factory);

  if (!factory) {
    throw new Error("Factory mode requires a valid factory input.");
  }

  const now = options.now ?? new Date();
  const workspacePath = path.resolve(
    options.workspaceRoot,
    ".shipyard",
    "factory-workspaces",
    `${sanitizePathSegment(factory.repository.name)}-${formatWorkspaceSuffix(now)}`
  );

  await mkdir(workspacePath, { recursive: true });
  await seedFactoryWorkspace(workspacePath, factory, submission.instruction);

  return compileFactoryTaskSubmission({
    input: submission,
    workspacePath,
    projectId: submission.project?.kind === "live" ? submission.project.id : "shipyard-runtime"
  });
}

async function seedFactoryWorkspace(
  workspacePath: string,
  factory: NonNullable<SubmitTaskInput["factory"]>,
  productBrief: string
) {
  const normalizedFactory = normalizeFactoryRunInput(factory);

  if (!normalizedFactory) {
    throw new Error("Factory workspace seed failed because the factory input was invalid.");
  }

  const stack = getFactoryStackSummary(normalizedFactory.stackTemplateId);

  await Promise.all([
    writeFile(
      path.join(workspacePath, "README.md"),
      buildFactoryReadme(normalizedFactory, productBrief, stack),
      "utf8"
    ),
    writeFile(
      path.join(workspacePath, "shipyard.factory.json"),
      `${JSON.stringify(
        {
          version: 1,
          mode: "factory",
          appName: normalizedFactory.appName,
          stack,
          repository: normalizedFactory.repository,
          deployment: normalizedFactory.deployment,
          productBrief
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    writeFile(path.join(workspacePath, ".gitignore"), buildFactoryGitignore(stack.templateId), "utf8")
  ]);
}

function buildFactoryReadme(
  factory: NonNullable<SubmitTaskInput["factory"]>,
  productBrief: string,
  stack: ReturnType<typeof getFactoryStackSummary>
) {
  return [
    `# ${factory.appName}`,
    "",
    "This workspace was created by Shipyard Factory Mode.",
    "",
    "## Product Brief",
    "",
    productBrief.trim(),
    "",
    "## Stack",
    "",
    `- Template: ${stack.label}`,
    `- Frontend: ${stack.frontend}`,
    `- Backend: ${stack.backend}`,
    `- Data: ${stack.data}`,
    `- Deployment: ${stack.deployment}`,
    "",
    "## Repository Target",
    "",
    `- Provider: ${factory.repository.provider ?? "github"}`,
    `- Owner: ${factory.repository.owner ?? "(not set yet)"}`,
    `- Name: ${factory.repository.name}`,
    `- Visibility: ${factory.repository.visibility ?? "private"}`,
    `- Base branch: ${factory.repository.baseBranch ?? "main"}`,
    "",
    "## Deployment Target",
    "",
    `- Provider: ${factory.deployment.provider}`,
    factory.deployment.projectName?.trim()
      ? `- Project: ${factory.deployment.projectName.trim()}`
      : "- Project: (not set yet)",
    factory.deployment.environment?.trim()
      ? `- Environment: ${factory.deployment.environment.trim()}`
      : "- Environment: (not set yet)",
    "",
    "## Notes",
    "",
    "- Treat this folder as the isolated greenfield application workspace.",
    "- Do not edit the Shipyard control repository from this workspace."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFactoryGitignore(templateId: string) {
  const lines = [
    "node_modules",
    ".DS_Store",
    ".env",
    ".env.local",
    ".env.*.local",
    "dist",
    "coverage",
    ".vercel",
    ".railway"
  ];

  if (templateId.startsWith("nextjs_")) {
    lines.push(".next");
  }

  return `${lines.join("\n")}\n`;
}

function sanitizePathSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "factory-app";
}

function formatWorkspaceSuffix(now: Date) {
  return [
    now.getUTCFullYear(),
    `${now.getUTCMonth() + 1}`.padStart(2, "0"),
    `${now.getUTCDate()}`.padStart(2, "0"),
    `${now.getUTCHours()}`.padStart(2, "0"),
    `${now.getUTCMinutes()}`.padStart(2, "0"),
    `${now.getUTCSeconds()}`.padStart(2, "0")
  ].join("");
}
