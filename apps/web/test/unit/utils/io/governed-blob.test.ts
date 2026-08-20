// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { governedBlob } from '~/utils/io/governed-blob';
import * as ioGovernor from '~/utils/io/io-governor';

describe('governedBlob', () => {
  it('preserves File type when wrapping a File', () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const wrapped = governedBlob(file);
    expect(wrapped).toBeInstanceOf(File);
    expect(wrapped.name).toBe('test.txt');
    expect(wrapped.size).toBe(5);
  });

  it('preserves Blob type when wrapping a Blob', () => {
    const blob = new Blob(['world']);
    const wrapped = governedBlob(blob);
    expect(wrapped).toBeInstanceOf(Blob);
    expect(wrapped.size).toBe(5);
  });

  it('routes arrayBuffer through the I/O governor', async () => {
    const acquireSpy = vi
      .spyOn(ioGovernor, 'withFileIoSlot')
      .mockImplementation((task: () => Promise<unknown>) => task());
    const blob = new Blob(['abc']);
    const wrapped = governedBlob(blob);
    const buffer = await wrapped.arrayBuffer();
    expect(acquireSpy).toHaveBeenCalledOnce();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([97, 98, 99]));
    acquireSpy.mockRestore();
  });

  it('routes text through the I/O governor', async () => {
    const acquireSpy = vi
      .spyOn(ioGovernor, 'withFileIoSlot')
      .mockImplementation((task: () => Promise<unknown>) => task());
    const blob = new Blob(['hello']);
    const wrapped = governedBlob(blob);
    const text = await wrapped.text();
    expect(acquireSpy).toHaveBeenCalledOnce();
    expect(text).toBe('hello');
    acquireSpy.mockRestore();
  });

  it('wraps slices recursively', () => {
    const file = new File(['0123456789'], 'data.bin');
    const wrapped = governedBlob(file);
    const slice = wrapped.slice(2, 5);
    expect(slice.size).toBe(3);
    expect(slice).toBeInstanceOf(Blob);
  });

  it('keeps native Blob methods bound to the original Blob', async () => {
    const wrapped = governedBlob(new Blob(['abc']));
    const reader = wrapped.stream().getReader();
    const chunk = await reader.read();

    expect(chunk.done).toBe(false);
    expect(chunk.value).toEqual(new Uint8Array([97, 98, 99]));
  });

  it('hides stream from feature detection so BlobSource uses governed random reads', () => {
    const wrapped = governedBlob(new Blob(['abc']));

    expect('stream' in wrapped).toBe(false);
    expect(typeof wrapped.stream).toBe('function');
  });

  it('routes sliced arrayBuffer reads through the I/O governor', async () => {
    const acquireSpy = vi
      .spyOn(ioGovernor, 'withFileIoSlot')
      .mockImplementation((task: () => Promise<unknown>) => task());
    const wrapped = governedBlob(new Blob(['0123456789']));
    const buffer = await wrapped.slice(2, 5).arrayBuffer();

    expect(acquireSpy).toHaveBeenCalledOnce();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([50, 51, 52]));
    acquireSpy.mockRestore();
  });

  it('uses the same proxy behavior for worker-side blobs', async () => {
    vi.resetModules();
    const withWorkerFileIoSlot = vi.fn((task: () => Promise<unknown>) => task());
    vi.doMock('~/workers/core/io-governor', () => ({ withWorkerFileIoSlot }));
    const { governedBlobWorker } = await import('~/utils/io/governed-blob-worker');

    const wrapped = governedBlobWorker(new Blob(['worker']));
    const buffer = await wrapped.slice(1, 4).arrayBuffer();

    expect('stream' in wrapped).toBe(false);
    expect(withWorkerFileIoSlot).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(buffer)).toBe('ork');
    vi.doUnmock('~/workers/core/io-governor');
  });
});
