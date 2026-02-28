// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readJsonFromFileHandle, writeJsonToFileHandle } from '../../../src/repositories/gran-fs';

function createFileHandleMock(initialText: string) {
  let text = initialText;

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
        async write(data: string) {
          text = data;
        },
        async close() {
          // no-op
        },
      };
    },
  };
}

describe('gran-fs', () => {
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
});
