import type { TranscriptionRecord } from './types';

/**
 * Saves the transcription record as a sidecar file (.stt.json) next to the source file.
 */
export async function saveTranscriptionSidecar(
  workspaceHandle: FileSystemDirectoryHandle,
  filePath: string,
  record: TranscriptionRecord,
): Promise<void> {
  const sidecarPath = filePath + '.stt.json';
  const parts = sidecarPath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;

  let currentDir = workspaceHandle;
  for (const dirName of parts) {
    currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
  }

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(JSON.stringify(record, null, 2));
  await writable.close();
}

/**
 * Loads a transcription record from a sidecar file if it exists.
 */
export async function loadTranscriptionSidecar(
  workspaceHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<TranscriptionRecord | null> {
  const sidecarPath = filePath + '.stt.json';
  const parts = sidecarPath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return null;

  try {
    let currentDir = workspaceHandle;
    for (const dirName of parts) {
      currentDir = await currentDir.getDirectoryHandle(dirName, { create: false });
    }

    const fileHandle = await currentDir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as TranscriptionRecord;
  } catch {
    return null;
  }
}
