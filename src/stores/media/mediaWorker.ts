import { getExportWorkerClient } from '~/utils/video-editor/worker-client';

export interface MediaWorkerModule {
  extractMetadata: (file: File | FileSystemFileHandle) => Promise<unknown>;
}

export function createMediaWorkerModule() {
  async function extractMetadata(file: File | FileSystemFileHandle) {
    const { client } = getExportWorkerClient();
    return await client.extractMetadata(file);
  }

  return {
    extractMetadata,
  } satisfies MediaWorkerModule;
}
