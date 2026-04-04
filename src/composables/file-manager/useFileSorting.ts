import { computed, type Ref, toRaw, inject } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useFileManagerStore } from '~/stores/file-manager.store';

export function useFileSorting(entries: Ref<FsEntry[]>) {
  const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();

  const sortedEntries = computed(() => {
    const rawEntries = toRaw(entries.value);
    if (rawEntries.length === 0) return [];

    const arr = [...rawEntries];
    const { field, order } = fileManagerStore.sortOption;
    const modifier = order === 'asc' ? 1 : -1;

    const compare = (a: any, b: any) => {
      if (a === b) return 0;
      return a > b ? modifier : -modifier;
    };

    const getSortValue = (entry: FsEntry): string | number => {
      switch (field) {
        case 'name':
          return entry.name.toLowerCase();
        case 'type':
          const ext = entry.name.split('.').pop()?.toLowerCase() || '';
          return entry.kind === 'directory' ? 'folder' : ext;
        case 'size':
          return entry.size ?? 0;
        case 'modified':
        case 'created':
          return entry.lastModified ?? 0;
        default:
          return entry.name.toLowerCase();
      }
    };

    return arr.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
      }
      const result = compare(getSortValue(a), getSortValue(b));
      if (result !== 0) return result;
      return compare(a.name.toLowerCase(), b.name.toLowerCase());
    });
  });

  return {
    sortedEntries,
  };
}
