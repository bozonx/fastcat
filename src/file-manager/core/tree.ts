import type { FsEntry } from '~/types/fs';
import { normalizeFsPath } from './path';

export function findEntryByPath(entries: FsEntry[], path: string): FsEntry | null {
  const normalized = normalizeFsPath(path);
  if (!normalized) return null;

  function walk(list: FsEntry[]): FsEntry | null {
    for (const entry of list) {
      if (entry.path === normalized) return entry;
      if (
        entry.kind === 'directory' &&
        Array.isArray(entry.children) &&
        entry.children.length > 0
      ) {
        const found = walk(entry.children);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(entries);
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

  function walk(list: FsEntry[]): { next: FsEntry[]; changed: boolean } {
    let changed = false;
    const next = list.map((entry) => {
      if (entry.path === normalized) {
        changed = true;
        return updater(entry);
      }

      if (
        entry.kind === 'directory' &&
        Array.isArray(entry.children) &&
        entry.children.length > 0
      ) {
        const r = walk(entry.children);
        if (r.changed) {
          changed = true;
          return { ...entry, children: r.next };
        }
      }

      return entry;
    });
    return { next: changed ? next : list, changed };
  }

  return walk(entries).next;
}
