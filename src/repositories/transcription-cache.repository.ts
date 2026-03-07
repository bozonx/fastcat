import { getProjectTranscriptionsSegments } from '~/utils/vardata-paths';
import { readJsonFromFileHandle, writeJsonToFileHandle, type DirectoryHandleLike } from './gran-fs';

export interface TranscriptionCacheRecord {
  key: string;
  createdAt: string;
  sourcePath: string;
  sourceName: string;
  sourceSize: number;
  sourceLastModified: number;
  language: string;
  provider: string;
  models: string[];
  response: unknown;
}

export interface TranscriptionCacheRepository {
  load: (key: string) => Promise<TranscriptionCacheRecord | null>;
  save: (record: TranscriptionCacheRecord) => Promise<void>;
}

async function ensureDirectoryChain(params: {
  baseDir: DirectoryHandleLike;
  segments: string[];
}): Promise<DirectoryHandleLike | null> {
  let current: DirectoryHandleLike | null = params.baseDir;

  for (const segment of params.segments) {
    if (!current) return null;
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

export function createTranscriptionCacheRepository(params: {
  workspaceDir: DirectoryHandleLike;
  projectId: string;
}): TranscriptionCacheRepository {
  async function getCacheDir(): Promise<DirectoryHandleLike | null> {
    if (!params.projectId.trim()) return null;
    return await ensureDirectoryChain({
      baseDir: params.workspaceDir,
      segments: getProjectTranscriptionsSegments(params.projectId),
    });
  }

  return {
    async load(key) {
      const cacheDir = await getCacheDir();
      if (!cacheDir) return null;

      try {
        const handle = await cacheDir.getFileHandle(`${key}.json`, { create: false });
        return await readJsonFromFileHandle<TranscriptionCacheRecord>(handle);
      } catch (error: unknown) {
        if ((error as { name?: unknown }).name === 'NotFoundError') {
          return null;
        }

        throw error;
      }
    },

    async save(record) {
      const cacheDir = await getCacheDir();
      if (!cacheDir) return;

      const handle = await cacheDir.getFileHandle(`${record.key}.json`, { create: true });
      await writeJsonToFileHandle({ handle, data: record });
    },
  };
}
