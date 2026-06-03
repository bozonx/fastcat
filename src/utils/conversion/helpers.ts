import { randomToken } from '~/utils/ids';

export function resolveAudioChannelsFromMeta(channels?: number): number {
  if (!channels) return 2;
  return channels;
}

export function resolveAudioOnlyContainerFormat(codec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'): string {
  if (codec === 'opus') return 'webm';
  if (codec === 'aac') return 'mp4';
  if (codec === 'flac') return 'flac';
  if (codec === 'pcm') return 'wav';
  if (codec === 'mp3') return 'mp3';
  return 'mp4';
}

export function resolveAudioOnlyFileExtension(codec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'): string {
  if (codec === 'opus') return 'opus';
  if (codec === 'aac') return 'm4a';
  if (codec === 'flac') return 'flac';
  if (codec === 'pcm') return 'wav';
  if (codec === 'mp3') return 'mp3';
  return 'm4a';
}

export function clampPositiveNumber(value: number, fallback: number) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

export function createConversionTaskId() {
  return `file-conversion-${Date.now()}-${randomToken()}`;
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
