import { readDir, stat, remove } from '@tauri-apps/plugin-fs';
import { joinTauriFsPath } from '~/utils/path';

/**
 * Sweeps orphaned atomic-write temp files left under app-managed directories.
 *
 * Both Tauri write paths stage bytes to a sibling temp file and `rename()` it
 * into place (`TauriFileSystemAdapter.writeFile`, `TauriFileHandle.createWritable`).
 * A hard process kill *between* the temp write and the rename leaves the temp
 * behind — the runtime cleans up on its own error path, but not on a crash.
 * Over many sessions these accumulate. The names are
 * `.<name>.<ts36>.<rand36>.tmp` (adapter, dotfile) or `<name>.<ts36>.<rand36>.tmp`
 * (handle), where `<ts36>` is `Date.now().toString(36)` and `<rand36>` is a
 * 6-char base36 token.
 */

/**
 * Matches the `.<ts36>.<rand36>.tmp` suffix our writers append. `<rand36>` is
 * always 6 chars; `<ts36>` is the base36 millisecond clock (≥7 chars for any
 * realistic date). Tight enough to avoid nuking an unrelated user `*.tmp`.
 */
const TEMP_NAME_RE = /\.[0-9a-z]{6,}\.[0-9a-z]{6}\.tmp$/i;

/** Skip temps younger than this — they may be an in-flight write by another window. */
const DEFAULT_STALE_MS = 60 * 60 * 1000;
/** Bound the directory walk so a large media tree can't make startup crawl. */
const MAX_DEPTH = 6;
const MAX_ENTRIES = 20_000;

/**
 * Recursively removes stale write temps under `roots`. Best-effort: every
 * filesystem error is swallowed so cleanup never blocks or breaks project open.
 * Returns the number of files removed.
 */
export async function cleanupStaleTauriTempFiles(
  roots: Array<string | null | undefined>,
  options?: { staleMs?: number; now?: number },
): Promise<number> {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const now = options?.now ?? Date.now();

  let removed = 0;
  let scanned = 0;
  const seen = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [];
  for (const root of roots) {
    const trimmed = (root ?? '').trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      queue.push({ path: trimmed, depth: 0 });
    }
  }

  while (queue.length > 0 && scanned < MAX_ENTRIES) {
    const { path, depth } = queue.shift()!;
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_ENTRIES) break;
      const childPath = joinTauriFsPath(path, entry.name);

      if (entry.isDirectory) {
        if (depth < MAX_DEPTH && !seen.has(childPath)) {
          seen.add(childPath);
          queue.push({ path: childPath, depth: depth + 1 });
        }
        continue;
      }

      if (!TEMP_NAME_RE.test(entry.name)) continue;
      try {
        const meta = await stat(childPath);
        const mtime = meta.mtime ? new Date(meta.mtime).getTime() : 0;
        // Treat unknown mtime (0) as stale — these are our temps, and a missing
        // timestamp means we can't prove it's in-flight.
        if (mtime && now - mtime < staleMs) continue;
        await remove(childPath);
        removed += 1;
      } catch {
        // Already gone or locked by a live write — leave it.
      }
    }
  }

  return removed;
}
