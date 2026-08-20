import { describe, it, expect } from 'vitest';
import { LazyTauriFile } from '~/stores/workspace/provider/tauri-handle';

describe('LazyTauriFile', () => {
  it('reports correct size for a full file', () => {
    const file = new LazyTauriFile({
      path: '/tmp/test.mp4',
      name: 'test.mp4',
      size: 1000,
    });
    expect(file.size).toBe(1000);
    expect(file.name).toBe('test.mp4');
    expect(file.path).toBe('/tmp/test.mp4');
  });

  it('slice returns a sub-range with correct size', () => {
    const file = new LazyTauriFile({
      path: '/tmp/test.mp4',
      name: 'test.mp4',
      size: 1000,
    });
    const slice = file.slice(100, 400);
    expect(slice.size).toBe(300);
    expect((slice as LazyTauriFile).path).toBe('/tmp/test.mp4');
  });

  it('nested slices accumulate offsets', () => {
    const file = new LazyTauriFile({
      path: '/tmp/test.mp4',
      name: 'test.mp4',
      size: 1000,
    });
    const slice1 = file.slice(100, 500) as LazyTauriFile;
    const slice2 = slice1.slice(50, 150) as LazyTauriFile;
    expect(slice2.size).toBe(100);
    expect(slice2.path).toBe('/tmp/test.mp4');
  });

  it('slice clamps to file bounds', () => {
    const file = new LazyTauriFile({
      path: '/tmp/test.mp4',
      name: 'test.mp4',
      size: 200,
    });
    const slice = file.slice(100, 500) as LazyTauriFile;
    expect(slice.size).toBe(100);
  });
});
