export function resolveAudioChannelsFromMeta(channels?: number): 'stereo' | 'mono' {
  if (!channels) return 'stereo';
  if (channels === 1) return 'mono';
  return 'stereo';
}

export function resolveAudioOnlyContainerFormat(codec: 'opus' | 'aac'): 'webm' | 'mp4' {
  if (codec === 'opus') return 'webm';
  return 'mp4';
}

export function resolveAudioOnlyFileExtension(codec: 'opus' | 'aac'): 'weba' | 'm4a' {
  if (codec === 'opus') return 'weba';
  return 'm4a';
}

export function clampPositiveNumber(value: number, fallback: number) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

export function createConversionTaskId() {
  return `file-conversion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function waitForFsSettling() {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export async function removeCreatedFile(params: {
  dirHandle: FileSystemDirectoryHandle | null;
  fileName: string | null;
}) {
  if (!params.dirHandle || !params.fileName) return;
  try {
    await waitForFsSettling();
    await params.dirHandle.removeEntry(params.fileName);
  } catch {
    // ignore
  }
}
