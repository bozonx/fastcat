import type { FsEntry } from '~/types/fs';
import type { FileManagerContext } from './fileManagerContext';

interface FileManagerCrudApi {
  findEntryByPath: (path: string) => FsEntry | null;
  renameEntry: (target: FsEntry, newName: string) => Promise<void>;
  deleteEntry: (target: FsEntry) => Promise<void>;
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  moveEntry: (params: {
    source: FsEntry;
    targetDirPath: string;
  }) => Promise<string | null | undefined>;
}

export function createFileManagerHistory(ctx: FileManagerContext, crud: FileManagerCrudApi) {
  const { findEntryByPath, renameEntry, deleteEntry, createFolder, moveEntry } = crud;

  async function restoreHistory(snapshot: unknown) {
    const op = snapshot as Record<string, unknown>;
    if (!op || !op.type) return;
    ctx.isRestoringHistory = true;

    await ctx.runWithUiFeedback({
      action: async () => {
        if (op.type === 'rename') {
          const entry = findEntryByPath(op.from as string);
          if (!entry) throw new Error(`Entry to rename not found: ${op.from as string}`);
          await renameEntry(entry, op.to as string);
        } else if (op.type === 'move') {
          const entry = findEntryByPath(op.from as string);
          if (!entry) throw new Error(`Entry to move not found: ${op.from as string}`);
          await moveEntry({ source: entry, targetDirPath: op.to as string });
        } else if (op.type === 'delete') {
          const entry = findEntryByPath(op.path as string);
          if (!entry) throw new Error(`Entry to delete not found: ${op.path as string}`);
          await deleteEntry(entry);
        } else if (op.type === 'createFolder') {
          await createFolder(op.name as string, op.parentPath as string);
        }
      },
      defaultErrorMessage: 'Failed to restore file operation',
      toastTitle: 'History error',
      ignoreError: () => false,
    });
    ctx.isRestoringHistory = false;
  }

  return { restoreHistory };
}
