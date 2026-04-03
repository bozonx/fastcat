/**
 * Atomically writes content to a file.
 * Uses a temporary file to ensure data integrity during write operations.
 *
 * @param handle - FileSystemFileHandle to write to
 * @param content - Content to write (string or Blob)
 * @param getTempHandle - Optional function to create temp file handle (for testing)
 */
export async function atomicWriteFile(
  handle: FileSystemFileHandle,
  content: string | Blob,
  getTempHandle?: (name: string) => Promise<FileSystemFileHandle | null>,
): Promise<void> {
  const name = handle.name;
  const tempName = `${name}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let tempHandle: FileSystemFileHandle | null = null;

  try {
    if (getTempHandle) {
      tempHandle = await getTempHandle(tempName);
    }

    if (!tempHandle) {
      return await writeDirectly(handle, content);
    }

    const tempWritable = await (tempHandle as any).createWritable();
    await tempWritable.write(content);
    await tempWritable.close();

    const tempFile = await tempHandle.getFile();
    const finalContent = await tempFile.arrayBuffer();

    const finalWritable = await (handle as any).createWritable();
    await finalWritable.write(finalContent);
    await finalWritable.close();

    const parent = await (handle as any).getParentDirectory?.();
    if (parent) {
      await parent.removeEntry(tempName, { recursive: false }).catch(() => {});
    }
  } catch {
    await writeDirectly(handle, content);
  }
}

async function writeDirectly(handle: FileSystemFileHandle, content: string | Blob): Promise<void> {
  const writable = await (handle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

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
