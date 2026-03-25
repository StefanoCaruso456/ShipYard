import type {
  ComposerAttachment,
  RuntimeAudioTranscriptionResponse,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeStatusResponse,
  RuntimeTraceResponse,
  RuntimeTaskListResponse,
  RuntimeTaskResponse
} from "./types";

const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "");
const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: isFormData
      ? init?.headers
      : {
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

export function fetchRuntimeTrace(taskId: string) {
  return requestJson<RuntimeTraceResponse>(`/api/runtime/traces/${taskId}`);
}

export function submitRuntimeTask(input: {
  instruction: string;
  title?: string;
  threadId?: string;
  parentRunId?: string | null;
  simulateFailure?: boolean;
  attachments?: ComposerAttachment[];
}) {
  const attachments = input.attachments ?? [];

  if (attachments.length > 0) {
    const formData = new FormData();

    formData.append("instruction", input.instruction);

    if (input.title) {
      formData.append("title", input.title);
    }

    if (input.threadId) {
      formData.append("threadId", input.threadId);
    }

    if (input.parentRunId) {
      formData.append("parentRunId", input.parentRunId);
    }

    if (input.simulateFailure !== undefined) {
      formData.append("simulateFailure", String(input.simulateFailure));
    }

    for (const attachment of attachments) {
      formData.append("attachments", attachment.file, attachment.name);
    }

    return requestJson<RuntimeTaskResponse>("/api/runtime/tasks", {
      method: "POST",
      body: formData
    });
  }

  return requestJson<RuntimeTaskResponse>("/api/runtime/tasks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function transcribeRuntimeAudio(input: {
  file: File;
  prompt?: string;
  language?: string;
}) {
  const formData = new FormData();

  formData.append("audio", input.file, input.file.name);

  if (input.prompt?.trim()) {
    formData.append("prompt", input.prompt.trim());
  }

  if (input.language?.trim()) {
    formData.append("language", input.language.trim());
  }

  return requestJson<RuntimeAudioTranscriptionResponse>("/api/runtime/audio/transcriptions", {
    method: "POST",
    body: formData
  });
}
