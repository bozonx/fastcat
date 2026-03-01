import { getExportWorkerClient } from '~/utils/video-editor/worker-client';

export interface MediaWorkerModule {
  extractMetadata: (fileHandle: FileSystemFileHandle) => Promise<unknown>;
}

export function createMediaWorkerModule() {
  async function extractMetadata(fileHandle: FileSystemFileHandle) {
    const { client } = getExportWorkerClient();
    return await client.extractMetadata(fileHandle);
  }

  return {
    extractMetadata,
  } satisfies MediaWorkerModule;
}
