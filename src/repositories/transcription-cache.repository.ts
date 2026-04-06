import {
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './app-fs.repository';
import { resolveStorageRootHandle } from '~/utils/storage-handles';
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
  load: (params: { key: string; sourcePath: string }) => Promise<TranscriptionCacheRecord | null>;
  list: (params: { sourcePath: string }) => Promise<TranscriptionCacheRecord[]>;
  save: (record: TranscriptionCacheRecord) => Promise<void>;
}



/**
 * Transcription Cache Repository
 * Handles persistence of transcription results using a sidecar file pattern.
 * All transcription files (*.stt.json) are saved in the same directory as the source media file.
 */
function getPathInfo(sourcePath: string) {
  const normalized = sourcePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() ?? '';
  const dirPath = normalized.substring(0, normalized.lastIndexOf('/') + 1);
  return { dirPath, fileName };
}

function getTranscriptionFileName(sourceName: string, _key: string) {
  // Simplified naming for portability as requested by user
  return `${sourceName}.stt.json`;
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
}): TranscriptionCacheRepository {
  async function getFileDir(sourcePath: string, create: boolean = false): Promise<DirectoryHandleLike | null> {
    const { dirPath } = getPathInfo(sourcePath);
    try {
      return await resolveStorageRootHandle({
        workspaceHandle: params.workspaceDir,
        rootPath: dirPath,
        create,
      });
    } catch (error) {
      console.warn(`[TranscriptionCache] Failed to resolve directory for ${sourcePath}`, error);
      return null;
    }
  }

  return {
    async load({ key, sourcePath }) {
      const dir = await getFileDir(sourcePath);
      if (!dir) return null;

      const { fileName: sourceName } = getPathInfo(sourcePath);
      const cacheFileName = getTranscriptionFileName(sourceName, key);

      try {
        const handle = await dir.getFileHandle(cacheFileName, { create: false });
        const raw = await readJsonFromFileHandle<unknown>(handle);
        if (!raw) return null;

        const parsed = TranscriptionCacheRecordSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`[TranscriptionCache] Invalid cache record in file ${cacheFileName}`, parsed.error);
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

    async list({ sourcePath }) {
      const dir = await getFileDir(sourcePath);
      if (!dir?.values) return [];

      const { fileName: sourceName } = getPathInfo(sourcePath);
      const records: TranscriptionCacheRecord[] = [];
      
      for await (const handle of dir.values()) {
        if (handle.kind !== 'file' || !handle.name.endsWith('.stt.json')) continue;
        if (!handle.name.startsWith(sourceName)) continue;

        try {
          const fileHandle = await dir.getFileHandle(handle.name, { create: false });
          const raw = await readJsonFromFileHandle<unknown>(fileHandle);
          if (raw) {
            const parsed = TranscriptionCacheRecordSchema.safeParse(raw);
            if (parsed.success) {
              records.push(parsed.data);
            }
          }
        } catch (error: unknown) {
          if ((error as { name?: unknown }).name === 'NotFoundError') continue;
          throw error;
        }
      }

      return sortRecordsByCreatedAtDesc(records);
    },

    async save(record) {
      const dir = await getFileDir(record.sourcePath, true);
      if (!dir) {
         throw new Error(`Failed to access directory for transcription: ${record.sourcePath}`);
      }

      const cacheFileName = getTranscriptionFileName(record.sourceName, record.key);
      const handle = await dir.getFileHandle(cacheFileName, { create: true });
      await writeJsonToFileHandle({ handle, data: record });
    },
  };
}
