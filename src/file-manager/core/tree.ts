import type { FsEntry } from '~/types/fs';
import { normalizeFsPath } from './path';

export function findEntryByPath(entries: FsEntry[], path: string): FsEntry | null {
  const normalized = normalizeFsPath(path);
  if (!normalized) return null;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  let currentList = entries;
  let currentEntry: FsEntry | null = null;
  let currentPath = '';

  for (let i = 0; i < parts.length; i++) {
    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]!;
    const found = currentList.find((e) => e.path === currentPath);
    if (!found) return null;

    currentEntry = found;
    if (i < parts.length - 1) {
      if (found.kind !== 'directory' || !Array.isArray(found.children)) {
        return null;
      }
      currentList = found.children;
    }
  }

  return currentEntry;
}

export function mergeEntries(
  prev: FsEntry[] | undefined,
  next: FsEntry[],
  deps: { isPathExpanded: (path: string) => boolean },
): FsEntry[] {
  const prevByPath = new Map<string, FsEntry>();
  for (const p of prev ?? []) {
    if (p.path) prevByPath.set(p.path, p);
  }

  return next.map((n) => {
    if (!n.path) return { ...n };
    const p = prevByPath.get(n.path);

    if (p) {
      if (n.kind === 'directory') {
        return {
          ...n,
          expanded: Boolean(p.expanded),
          children: p.children,
        };
      }

      return {
        ...n,
        expanded: Boolean(p.expanded),
        lastModified: p.lastModified,
      };
    }

    const isPersistedExpanded = deps.isPathExpanded(n.path);
    return {
      ...n,
      expanded: n.kind === 'directory' ? isPersistedExpanded : false,
    };
  });
}

export function updateEntryByPath(
  entries: FsEntry[],
  path: string,
  updater: (entry: FsEntry) => FsEntry,
): FsEntry[] {
  const normalized = normalizeFsPath(path);
  if (!normalized) return entries;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return entries;

  function walk(
    list: FsEntry[],
    depth: number,
    currentPath: string,
  ): { next: FsEntry[]; changed: boolean } {
    let changed = false;
    const targetPath = currentPath ? `${currentPath}/${parts[depth]}` : (parts[depth] ?? '');

    const next = list.map((entry) => {
      if (entry.path !== targetPath) return entry;

      if (depth === parts.length - 1) {
        if (entry.path === normalized) {
          changed = true;
          return updater(entry);
        }
        return entry;
      }

      if (entry.kind === 'directory' && Array.isArray(entry.children)) {
        const r = walk(entry.children, depth + 1, targetPath);
        if (r.changed) {
          changed = true;
          return { ...entry, children: r.next };
        }
      }

      return entry;
    });

    return { next: changed ? next : list, changed };
  }

  return walk(entries, 0, '').next;
}
