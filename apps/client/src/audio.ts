const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg"
];

export function pickPreferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  for (const mimeType of PREFERRED_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

export function createRecordedAudioFile(blob: Blob, recordedAt = new Date()) {
  const mimeType = blob.type || "audio/webm";
  const extension = extensionForMimeType(mimeType);
  const stamp = [
    recordedAt.getFullYear(),
    String(recordedAt.getMonth() + 1).padStart(2, "0"),
    String(recordedAt.getDate()).padStart(2, "0"),
    String(recordedAt.getHours()).padStart(2, "0"),
    String(recordedAt.getMinutes()).padStart(2, "0"),
    String(recordedAt.getSeconds()).padStart(2, "0")
  ].join("");

  return new File([blob], `voice-note-${stamp}.${extension}`, {
    type: mimeType,
    lastModified: recordedAt.getTime()
  });
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "m4a";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }

  return "webm";
}
