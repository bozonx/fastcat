// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readJsonFromFileHandle, writeJsonToFileHandle } from '~/repositories/app-fs.repository';

function createFileHandleMock(initialText: string) {
  let text = initialText;
  let bytes = new TextEncoder().encode(text);
  let writeCount = 0;

  function syncText() {
    text = new TextDecoder().decode(bytes);
  }

  return {
    async getFile() {
      return {
        async text() {
          return text;
        },
      };
    },
    async createWritable() {
      return {
        async write(data: string | { type: 'write'; position?: number; data: Uint8Array }) {
          writeCount += 1;
          if (typeof data === 'string') {
            bytes = new TextEncoder().encode(data);
            syncText();
            return;
          }

          const position = data.position ?? bytes.length;
          const nextLength = Math.max(bytes.length, position + data.data.length);
          const nextBytes = new Uint8Array(nextLength);
          nextBytes.set(bytes);
          nextBytes.set(data.data, position);
          bytes = nextBytes;
          syncText();
        },
        async truncate(size: number) {
          bytes = bytes.slice(0, size);
          syncText();
        },
        async close() {
          // no-op
        },
        async abort() {
          // no-op
        },
      };
    },
    __debug: {
      get writeCount() {
        return writeCount;
      },
    },
  };
}

describe('app-fs.repository', () => {
  it('readJsonFromFileHandle returns null on empty text', async () => {
    const handle = createFileHandleMock('   ');
    const value = await readJsonFromFileHandle(handle as any);
    expect(value).toBeNull();
  });

  it('readJsonFromFileHandle parses JSON', async () => {
    const handle = createFileHandleMock('{"a":1}');
    const value = await readJsonFromFileHandle(handle as any);
    expect(value).toEqual({ a: 1 });
  });

  it('writeJsonToFileHandle writes pretty JSON with newline', async () => {
    const handle = createFileHandleMock('');
    await writeJsonToFileHandle({ handle: handle as any, data: { a: 1 } });
    const value = await readJsonFromFileHandle(handle as any);
    expect(value).toEqual({ a: 1 });
  });

  it('writeJsonToFileHandle writes large JSON in chunks', async () => {
    const handle = createFileHandleMock('');
    await writeJsonToFileHandle({ handle: handle as any, data: { value: 'x'.repeat(600_000) } });

    const value = await readJsonFromFileHandle<{ value: string }>(handle as any);
    expect(value?.value).toHaveLength(600_000);
    expect(handle.__debug.writeCount).toBeGreaterThan(1);
  });
});
