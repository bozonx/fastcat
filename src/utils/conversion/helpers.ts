export function resolveAudioChannelsFromMeta(channels?: number): number {
  if (!channels) return 2;
  return channels;
}

export function resolveAudioOnlyContainerFormat(codec: 'opus' | 'aac'): 'webm' | 'mp4' {
  if (codec === 'opus') return 'webm';
  return 'mp4';
}

export function resolveAudioOnlyFileExtension(codec: 'opus' | 'aac'): 'opus' | 'm4a' {
  if (codec === 'opus') return 'opus';
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

export async function removeCreatedFile(params: {
  dirHandle: FileSystemDirectoryHandle | null;
  fileName: string | null;
}) {
  if (!params.dirHandle || !params.fileName) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await params.dirHandle.removeEntry(params.fileName);
      return;
    } catch {
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}
