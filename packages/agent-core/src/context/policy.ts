import { countTokens, decode, encode } from "gpt-tokenizer";

import type { AgentRole } from "../instructions/types";

export type RoleContextPolicy = {
  maxPromptChars: number;
  maxPromptTokens: number;
  maxOutputTokens: number;
};

const roleContextPolicies: Record<AgentRole, RoleContextPolicy> = {
  planner: {
    maxPromptChars: 16_000,
    maxPromptTokens: 3_200,
    maxOutputTokens: 800
  },
  executor: {
    maxPromptChars: 20_000,
    maxPromptTokens: 4_200,
    maxOutputTokens: 1_400
  },
  verifier: {
    maxPromptChars: 18_000,
    maxPromptTokens: 3_600,
    maxOutputTokens: 900
  }
};

const sectionTokenLimits: Record<string, number> = {
  "runtime-contract": 160,
  "task-objective": 140,
  "task-input": 360,
  "task-constraints": 220,
  "project-rules": 720,
  "skill-guidance": 1_100,
  "specialist-skill-guidance": 540,
  "current-run-state": 700,
  "relevant-files": 650,
  "recent-tool-results": 650,
  "validation-targets": 320,
  "known-failures": 320,
  "rolling-summary": 360
};

export function getRoleContextPolicy(role: AgentRole): RoleContextPolicy {
  return roleContextPolicies[role];
}

export function getSectionTokenLimit(role: AgentRole, sectionId: string) {
  if (sectionId.startsWith("external-context:")) {
    if (role === "executor") {
      return 700;
    }

    if (role === "verifier") {
      return 560;
    }

    return 480;
  }

  return sectionTokenLimits[sectionId] ?? 420;
}

export function countTextTokens(text: string) {
  return countTokens(text);
}

export function truncateTextToTokenLimit(input: {
  text: string;
  maxTokens: number;
  suffix: string;
}) {
  const originalTokenCount = countTextTokens(input.text);

  if (originalTokenCount <= input.maxTokens) {
    return {
      text: input.text,
      originalTokenCount,
      retainedTokenCount: originalTokenCount,
      truncated: false
    };
  }

  const suffixTokens = encode(input.suffix);
  const retainedTokenCount = Math.max(0, input.maxTokens - suffixTokens.length);
  const textTokens = encode(input.text);
  const retainedText = decode(textTokens.slice(0, retainedTokenCount)).trimEnd();

  return {
    text: `${retainedText}${input.suffix}`,
    originalTokenCount,
    retainedTokenCount,
    truncated: true
  };
}
