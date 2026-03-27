import type {
  ComposerAttachment,
  RuntimeAudioTranscriptionResponse,
  RuntimeFactoryRunInput,
  ProjectPayload,
  RuntimeHealthResponse,
  RuntimeInstructionResponse,
  RuntimeRepoBranchResponse,
  RuntimeOperatorApprovalDecision,
  RuntimeStatusResponse,
  RuntimeTaskToolRequest,
  RuntimeTaskSubmitContext,
  RuntimeTraceResponse,
  RuntimeTaskListResponse,
  RuntimeTaskResponse,
  WorkspaceProject
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
    let message = `Request to ${path} failed with ${response.status}.`;

    try {
      const payload = (await response.clone().json()) as {
        error?: unknown;
      };

      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      // Fall back to the generic error message when the response body is not JSON.
    }

    throw new Error(message);
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

export function fetchRuntimeBranches() {
  return requestJson<RuntimeRepoBranchResponse>("/api/runtime/repo/branches");
}

export function switchRuntimeBranch(branchName: string) {
  return requestJson<RuntimeRepoBranchResponse>("/api/runtime/repo/checkout", {
    method: "POST",
    body: JSON.stringify({
      branchName
    })
  });
}

export function submitRuntimeTask(input: {
  instruction: string;
  title?: string;
  threadId?: string;
  parentRunId?: string | null;
  simulateFailure?: boolean;
  toolRequest?: RuntimeTaskToolRequest | null;
  attachments?: ComposerAttachment[];
  project?: WorkspaceProject;
  context?: RuntimeTaskSubmitContext;
  factory?: RuntimeFactoryRunInput | null;
}) {
  const attachments = input.attachments ?? [];
  const project = input.project ? serializeRuntimeProject(input.project) : undefined;

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

    if (input.toolRequest) {
      formData.append("toolRequest", JSON.stringify(input.toolRequest));
    }

    if (project) {
      formData.append("project", JSON.stringify(project));
    }

    if (input.context) {
      formData.append("context", JSON.stringify(input.context));
    }

    if (input.factory) {
      formData.append("factory", JSON.stringify(input.factory));
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
    body: JSON.stringify({
      ...input,
      project
    })
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

export function submitRuntimeApprovalDecision(
  taskId: string,
  input: {
    gateId: string;
    decision: RuntimeOperatorApprovalDecision;
    comment?: string;
  }
) {
  return requestJson<RuntimeTaskResponse>(`/api/runtime/tasks/${taskId}/approval`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

function serializeRuntimeProject(project: WorkspaceProject) {
  const repositoryLink =
    project.repository?.url && project.repository.url.trim()
      ? [
          {
            kind: "repository" as const,
            url: project.repository.url.trim(),
            title: project.repository.label,
            provider: project.repository.provider
          }
        ]
      : [];

  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    environment: project.environment,
    description: project.description,
    links: repositoryLink,
    folder: project.folder
      ? {
          name: project.folder.name,
          displayPath: project.folder.displayPath,
          status: project.folder.status,
          provider: project.folder.provider
        }
      : null
  };
}
