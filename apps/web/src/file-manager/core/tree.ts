import type { FsEntry } from '~/types/fs';
import { normalizeFsPath } from './path';

const entryIndexCache = new WeakMap<FsEntry[], Map<string, FsEntry>>();

function getEntryIndex(entries: FsEntry[]): Map<string, FsEntry> {
  const cached = entryIndexCache.get(entries);
  if (cached) return cached;

  const index = new Map<string, FsEntry>();
  for (const entry of entries) {
    if (entry.path) {
      index.set(entry.path, entry);
    }
  }
  entryIndexCache.set(entries, index);
  return index;
}

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
    const found = getEntryIndex(currentList).get(currentPath);
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

  const nextPaths = new Set<string>();
  for (const n of next) {
    if (!n.path) continue;
    if (nextPaths.has(n.path)) {
      throw new Error(`Duplicate file manager entry path: ${n.path}`);
    }
    nextPaths.add(n.path);
  }

  return next.map((n) => {
    if (!n.path) return { ...n };
    const p = prevByPath.get(n.path);

    if (p) {
      if (n.kind === 'directory') {
        const shouldKeepChildren =
          p.lastModified === undefined ||
          n.lastModified === undefined ||
          p.lastModified === n.lastModified;

        return {
          ...n,
          expanded: Boolean(p.expanded),
          children: shouldKeepChildren ? p.children : undefined,
        };
      }

      return {
        ...n,
        expanded: Boolean(p.expanded),
        lastModified: n.lastModified ?? p.lastModified,
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
    const targetPath = currentPath ? `${currentPath}/${parts[depth]}` : (parts[depth] ?? '');
    const index = list.findIndex((entry) => entry.path === targetPath);
    if (index === -1) return { next: list, changed: false };

    const entry = list[index];
    if (!entry) return { next: list, changed: false };

    let updatedEntry: FsEntry | null = null;
    if (depth === parts.length - 1) {
      updatedEntry = entry.path === normalized ? updater(entry) : null;
    } else if (entry.kind === 'directory' && Array.isArray(entry.children)) {
      const r = walk(entry.children, depth + 1, targetPath);
      if (r.changed) {
        updatedEntry = { ...entry, children: r.next };
      }
    }

    if (!updatedEntry) return { next: list, changed: false };

    const next = list.slice();
    next[index] = updatedEntry;
    return { next, changed: true };
  }

  return walk(entries, 0, '').next;
}
