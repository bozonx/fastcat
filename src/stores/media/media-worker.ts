import { getExportWorkerClient } from '~/utils/video-editor/worker-client';
import type { MediaMetadata } from '../media.store';

export interface MediaWorkerModule {
  extractMetadata: (file: File | FileSystemFileHandle) => Promise<MediaMetadata>;
}

export function createMediaWorkerModule() {
  async function extractMetadata(file: File | FileSystemFileHandle): Promise<MediaMetadata> {
    const { client } = getExportWorkerClient();
    return await client.extractMetadata(file);
  }

  return {
    extractMetadata,
  } satisfies MediaWorkerModule;
}
