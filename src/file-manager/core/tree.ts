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

  for (const n of next) {
    if (!n.path) continue;
    const p = prevByPath.get(n.path);

    if (p) {
      n.expanded = p.expanded;
      if (n.kind === 'directory') {
        n.children = p.children;
      }
      if (n.kind === 'file') {
        n.lastModified = p.lastModified;
      }
      continue;
    }

    const isPersistedExpanded = deps.isPathExpanded(n.path);
    n.expanded = n.kind === 'directory' ? isPersistedExpanded : false;
  }

  return next;
}
