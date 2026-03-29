import {
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs.repository';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';
import { z } from 'zod';

export const TranscriptionCacheRecordSchema = z.object({
  key: z.string(),
  createdAt: z.string(),
  sourcePath: z.string(),
  sourceName: z.string(),
  sourceSize: z.number(),
  sourceLastModified: z.number(),
  language: z.string(),
  provider: z.string(),
  models: z.array(z.string()),
  response: z.unknown(),
});

export type TranscriptionCacheRecord = z.infer<typeof TranscriptionCacheRecordSchema>;

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
  topology: ResolvedStorageTopology;
  projectId: string;
}): TranscriptionCacheRepository {
  async function getCacheDir(): Promise<DirectoryHandleLike | null> {
    if (!params.projectId.trim()) return null;
    try {
      return await ensureResolvedProjectTempDir({
        workspaceHandle: params.workspaceDir,
        topology: params.topology,
        projectId: params.projectId,
        leafSegments: ['frame-cache', 'transcriptions'],
        create: true,
      });
    } catch {
      return null;
    }
  }

  return {
    async load(key) {
      const cacheDir = await getCacheDir();
      if (!cacheDir) return null;

      try {
        const handle = await cacheDir.getFileHandle(`${key}.json`, { create: false });
        const raw = await readJsonFromFileHandle<unknown>(handle);
        if (!raw) return null;

        const parsed = TranscriptionCacheRecordSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`[TranscriptionCache] Invalid cache record for key ${key}`, parsed.error);
          return null;
        }
        return parsed.data;
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
          const raw = await readJsonFromFileHandle<unknown>(fileHandle);
          if (raw) {
            const parsed = TranscriptionCacheRecordSchema.safeParse(raw);
            if (parsed.success) {
              records.push(parsed.data);
            } else {
              console.warn(
                `[TranscriptionCache] Invalid cache record in file ${handle.name}`,
                parsed.error,
              );
            }
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
