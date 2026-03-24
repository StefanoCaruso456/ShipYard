type OpenAIApiKeySource = "OPENAI_KEY" | "OPENAI_API_KEY" | null;

export type AudioTranscriptionConfig = {
  provider: "openai";
  configured: boolean;
  apiKey: string | null;
  apiKeySource: OpenAIApiKeySource;
  modelId: string;
  baseUrl: string;
};

export type AudioTranscriptionInput = {
  fileName: string;
  mimeType: string | null;
  buffer: Buffer;
  language?: string;
  prompt?: string;
};

export type AudioTranscriptionResult = {
  text: string;
  summary: string;
  excerpt: string | null;
  provider: "openai";
  modelId: string;
  language: string | null;
};

export class AudioTranscriptionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "AudioTranscriptionError";
    this.statusCode = statusCode;
  }
}

type CreateAudioTranscriberOptions = {
  config: AudioTranscriptionConfig;
  fetchImpl?: typeof fetch;
};

export function resolveAudioTranscriptionConfig(
  env: NodeJS.ProcessEnv = process.env
): AudioTranscriptionConfig {
  const openAIKey = env.OPENAI_KEY?.trim();
  const openAIApiKey = env.OPENAI_API_KEY?.trim();

  return {
    provider: "openai",
    configured: Boolean(openAIKey || openAIApiKey),
    apiKey: openAIKey || openAIApiKey || null,
    apiKeySource: openAIKey ? "OPENAI_KEY" : openAIApiKey ? "OPENAI_API_KEY" : null,
    modelId: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
    baseUrl: env.OPENAI_API_BASE_URL?.trim().replace(/\/$/, "") || "https://api.openai.com/v1"
  };
}

export function createAudioTranscriber(options: CreateAudioTranscriberOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    config: options.config,
    async transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
      if (!options.config.configured || !options.config.apiKey) {
        throw new AudioTranscriptionError(
          "OPENAI_KEY is not configured on the runtime host.",
          503
        );
      }

      const formData = new FormData();

      formData.append(
        "file",
        new Blob([new Uint8Array(input.buffer)], {
          type: input.mimeType || "application/octet-stream"
        }),
        input.fileName
      );
      formData.append("model", options.config.modelId);

      if (input.language?.trim()) {
        formData.append("language", input.language.trim());
      }

      if (input.prompt?.trim()) {
        formData.append("prompt", input.prompt.trim());
      }

      const response = await fetchImpl(`${options.config.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.config.apiKey}`
        },
        body: formData
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            text?: unknown;
            language?: unknown;
            error?: {
              message?: unknown;
            };
          }
        | null;

      if (!response.ok) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : `OpenAI audio transcription failed with ${response.status}.`;
        throw new AudioTranscriptionError(message, 502);
      }

      const text = typeof payload?.text === "string" ? payload.text.trim() : "";

      if (!text) {
        throw new AudioTranscriptionError("OpenAI returned an empty transcript.", 502);
      }

      return {
        text,
        summary: "Voice note transcribed on the backend with OpenAI.",
        excerpt: takeExcerpt(text),
        provider: options.config.provider,
        modelId: options.config.modelId,
        language: typeof payload?.language === "string" ? payload.language : null
      };
    }
  };
}

function takeExcerpt(text: string) {
  if (!text) {
    return null;
  }

  if (text.length <= 240) {
    return text;
  }

  return `${text.slice(0, 237).trimEnd()}...`;
}
