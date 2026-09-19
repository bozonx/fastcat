/** Route owning the embeddable editor. Kept here so non-page code can branch on
 *  it without importing the router. */
export const EMBED_ROUTE_PATH = '/embed';

/**
 * True when the current document is the embeddable build running inside a host
 * page's iframe. Cross-origin isolation is unavailable there (it would require
 * every embedding site to adopt COOP/COEP), so capability gates that treat a
 * missing `SharedArrayBuffer` as fatal must relax in this mode.
 */
export function isEmbedRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === EMBED_ROUTE_PATH || path.endsWith(EMBED_ROUTE_PATH);
}

/**
 * Whether the editor may offer to create or remove whole project documents —
 * another timeline, a version of one, a markdown note.
 *
 * An embedded session hands its host exactly one timeline and deletes the rest
 * of its workspace on close. A second timeline or a note made there is work the
 * user loses without being told, and removing the one timeline leaves nothing
 * to hand back.
 */
export function canManageProjectDocuments(): boolean {
  return !isEmbedRuntime();
}

/**
 * Whether files may be renamed or moved.
 *
 * An embedded session works with the files the host handed over, where the
 * session put them. The draft the host keeps names each clip's file by that
 * path: a renamed or moved file is found nowhere on the next visit, and the
 * host's copy of it is placed on the timeline a second time.
 */
export function canReorganizeFiles(): boolean {
  return !isEmbedRuntime();
}

/**
 * Whether deleting `entry` would take the embedded session's one timeline with
 * it — the file itself or a folder holding it. The host is handed that
 * timeline as its draft; once it is gone there is nothing to hand back.
 */
export function isEmbedSessionTimelineEntry(
  entry: { kind: 'file' | 'directory'; path: string },
  timelinePath: string | null,
): boolean {
  if (!isEmbedRuntime() || !timelinePath) return false;
  if (entry.kind === 'file') return entry.path === timelinePath;
  return entry.path === '' || timelinePath.startsWith(`${entry.path}/`);
}
