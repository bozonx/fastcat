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
});
