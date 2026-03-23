import type {
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTaskListResponse,
  RuntimeTaskResponse
} from "./types";

const apiBaseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "") ?? "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function fetchProjectBrief() {
  return requestJson<ProjectPayload>("/api/project");
}

export function fetchRuntimeHealth() {
  return requestJson<RuntimeHealthResponse>("/api/health");
}

export function fetchRuntimeStatus() {
  return requestJson<RuntimeStatusResponse>("/api/runtime/status");
}

export function fetchRuntimeInstructions() {
  return requestJson<RuntimeInstructionResponse>("/api/runtime/instructions/skill");
}

export function fetchRuntimeTasks() {
  return requestJson<RuntimeTaskListResponse>("/api/runtime/tasks");
}

export function submitRuntimeTask(input: {
  instruction: string;
  title?: string;
  simulateFailure?: boolean;
}) {
  return requestJson<RuntimeTaskResponse>("/api/runtime/tasks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
