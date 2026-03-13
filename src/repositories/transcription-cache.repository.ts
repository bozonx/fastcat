import { getProjectTranscriptionsSegments } from '~/utils/vardata-paths';
import { readJsonFromFileHandle, writeJsonToFileHandle, type DirectoryHandleLike } from './fastcat-fs';

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
  list: () => Promise<TranscriptionCacheRecord[]>;
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

function sortRecordsByCreatedAtDesc(
  records: TranscriptionCacheRecord[],
): TranscriptionCacheRecord[] {
  return [...records].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return safeBTime - safeATime;
  });
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

    async list() {
      const cacheDir = await getCacheDir();
      if (!cacheDir?.values) return [];

      const records: TranscriptionCacheRecord[] = [];
      for await (const handle of cacheDir.values()) {
        if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;

        try {
          const fileHandle = await cacheDir.getFileHandle(handle.name, { create: false });
          const record = await readJsonFromFileHandle<TranscriptionCacheRecord>(fileHandle);
          if (record) {
            records.push(record);
          }
        } catch (error: unknown) {
          if ((error as { name?: unknown }).name === 'NotFoundError') {
            continue;
          }

          throw error;
        }
      }

      return sortRecordsByCreatedAtDesc(records);
    },

    async save(record) {
      const cacheDir = await getCacheDir();
      if (!cacheDir) return;

      const handle = await cacheDir.getFileHandle(`${record.key}.json`, { create: true });
      await writeJsonToFileHandle({ handle, data: record });
    },
  };
}
