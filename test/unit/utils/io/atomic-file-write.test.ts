// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeFileAtomic } from '~/utils/io/atomic-file-write';

interface FileEntry {
  content: string | null; // null = created but never written (would be a torn write if read)
}

/**
 * Minimal in-memory OPFS-like directory. `supportsMove` toggles whether file
 * handles expose `move()` (Chromium) or not (Safari). `failWriteFor` makes the
 * named file's writable throw mid-write to simulate a crash; `lockOnMove` makes
 * `move()` throw a lock error to exercise the fallback.
 */
function createDirMock(options?: {
  supportsMove?: boolean;
  failWriteFor?: (name: string) => boolean;
  lockOnMove?: boolean;
}) {
  const supportsMove = options?.supportsMove ?? true;
  const files = new Map<string, FileEntry>();

  function makeHandle(name: string) {
    const handle: Record<string, unknown> = {
      name,
      async createWritable() {
        // OPFS semantics: opening the writable truncates the target immediately.
        files.set(name, { content: null });
        return {
          async write(data: string) {
            if (options?.failWriteFor?.(name)) {
              throw new Error('simulated write failure');
            }
            files.set(name, { content: data });
          },
          async close() {},
          async abort() {},
        };
      },
    };
    if (supportsMove) {
      handle.move = async (_destination: unknown, destName: string) => {
        if (options?.lockOnMove) {
          throw Object.assign(new Error('destination is locked'), {
            name: 'NoModificationAllowedError',
          });
        }
        const entry = files.get(name);
        files.delete(name);
        files.set(destName, entry ?? { content: null });
      };
    }
    return handle;
  }

  return {
    files,
    async getFileHandle(name: string, _options?: { create?: boolean }) {
      return makeHandle(name);
    },
    async removeEntry(name: string) {
      files.delete(name);
    },
  };
}

const tempNames = (dir: ReturnType<typeof createDirMock>) =>
  [...dir.files.keys()].filter((k) => k.includes('.tmp_'));

describe('writeFileAtomic', () => {
  it('writes via a temp file and moves it into place (atomic path)', async () => {
    const dir = createDirMock({ supportsMove: true });
    await writeFileAtomic({ dir, fileName: 'peaks.json', data: '[[1,2,3]]' });

    expect(dir.files.get('peaks.json')?.content).toBe('[[1,2,3]]');
    expect(tempNames(dir)).toHaveLength(0); // temp moved, none left behind
  });

  it('falls back to a direct write when move() is unavailable', async () => {
    const dir = createDirMock({ supportsMove: false });
    await writeFileAtomic({ dir, fileName: 'meta.json', data: '{"ok":true}' });

    expect(dir.files.get('meta.json')?.content).toBe('{"ok":true}');
    expect(tempNames(dir)).toHaveLength(0); // staging file cleaned up
  });

  it('falls back to a direct write when the destination is locked', async () => {
    const dir = createDirMock({ supportsMove: true, lockOnMove: true });
    await writeFileAtomic({ dir, fileName: 'meta.json', data: '{"v":1}' });

    expect(dir.files.get('meta.json')?.content).toBe('{"v":1}');
    expect(tempNames(dir)).toHaveLength(0);
  });

  it('never leaves a torn destination file when the write fails mid-stream', async () => {
    const dir = createDirMock({
      supportsMove: true,
      failWriteFor: (name) => name.includes('.tmp_'),
    });

    await expect(
      writeFileAtomic({ dir, fileName: 'important.json', data: 'data' }),
    ).rejects.toThrow('simulated write failure');

    // The real file was never opened/truncated; only the temp was, and it is gone.
    expect(dir.files.has('important.json')).toBe(false);
    expect(tempNames(dir)).toHaveLength(0);
  });
});
