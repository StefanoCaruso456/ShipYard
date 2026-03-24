import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioTranscriptionError,
  createAudioTranscriber,
  resolveAudioTranscriptionConfig
} from "../runtime/createAudioTranscriber";

test("resolveAudioTranscriptionConfig prefers OPENAI_KEY and supports a model override", () => {
  const config = resolveAudioTranscriptionConfig({
    OPENAI_KEY: "primary-key",
    OPENAI_API_KEY: "fallback-key",
    OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe"
  });

  assert.equal(config.configured, true);
  assert.equal(config.apiKey, "primary-key");
  assert.equal(config.apiKeySource, "OPENAI_KEY");
  assert.equal(config.modelId, "gpt-4o-transcribe");
});

test("audio transcriber returns a transcript from the OpenAI response payload", async () => {
  const transcriber = createAudioTranscriber({
    config: resolveAudioTranscriptionConfig({
      OPENAI_KEY: "test-key"
    }),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          text: "Shipyard should wire this voice note into the task flow.",
          language: "en"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )) as typeof fetch
  });

  const result = await transcriber.transcribe({
    fileName: "voice-note.webm",
    mimeType: "audio/webm",
    buffer: Buffer.from("voice")
  });

  assert.equal(result.modelId, "gpt-4o-mini-transcribe");
  assert.equal(result.language, "en");
  assert.match(result.text, /Shipyard should wire this voice note/);
  assert.match(result.summary, /Voice note transcribed/);
});

test("audio transcriber throws a configuration error when no key is set", async () => {
  const transcriber = createAudioTranscriber({
    config: resolveAudioTranscriptionConfig({})
  });

  await assert.rejects(
    () =>
      transcriber.transcribe({
        fileName: "voice-note.webm",
        mimeType: "audio/webm",
        buffer: Buffer.from("voice")
      }),
    (error: unknown) => {
      assert.ok(error instanceof AudioTranscriptionError);
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
});

test("audio transcriber surfaces upstream OpenAI failures as gateway errors", async () => {
  const transcriber = createAudioTranscriber({
    config: resolveAudioTranscriptionConfig({
      OPENAI_KEY: "test-key"
    }),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Audio format not supported."
          }
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )) as typeof fetch
  });

  await assert.rejects(
    () =>
      transcriber.transcribe({
        fileName: "voice-note.webm",
        mimeType: "audio/webm",
        buffer: Buffer.from("voice")
      }),
    (error: unknown) => {
      assert.ok(error instanceof AudioTranscriptionError);
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Audio format not supported/);
      return true;
    }
  );
});
