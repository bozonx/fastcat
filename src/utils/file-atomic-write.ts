// NOTE: There is intentionally no `atomicWriteFile` helper here. Atomic
// replacement is already guaranteed by every backend we write through, so a
// JS-level temp-file dance would be redundant (and the previous implementation
// was not actually atomic — it copied the temp back into the real file):
//   - Tauri: `TauriFileHandle.createWritable()` writes a `.tmp` and `rename()`s
//     it into place on close (see provider/tauri-handle.ts).
//   - Browser project files (user-picked dir, File System Access): Chromium's
//     `createWritable()` streams to a swap file and atomically replaces the
//     target only on `close()`.
//   - Browser OPFS (file-manager VFS): opfs.adapter stages a temp file and
//     `move()`s it into place, because OPFS handles truncate on open.

/**
 * Validates that serialized content is not corrupted.
 * Returns true if content appears valid, false otherwise.
 */
export function validateSerializedContent(serialized: string): { valid: boolean; error?: string } {
  if (!serialized || serialized.length < 10) {
    return { valid: false, error: 'Content is empty or too small' };
  }

  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, error: 'Content is not a valid object' };
    }

    return { valid: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown parsing error';
    return { valid: false, error: `JSON parsing failed: ${error}` };
  }
}
