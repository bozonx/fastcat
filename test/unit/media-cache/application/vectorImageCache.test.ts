/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureVectorImageRaster } from '~/media-cache/application/vectorImageCache';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

const rasterizeSvgToBlobMock = vi.fn();

vi.mock('~/utils/svg', () => ({
  rasterizeSvgToBlob: (...args: unknown[]) => rasterizeSvgToBlobMock(...args),
}));

function createFileHandle(file: File): FileSystemFileHandle {
  return {
    getFile: vi.fn(async () => file),
  } as unknown as FileSystemFileHandle;
}

describe('vectorImageCache', () => {
  beforeEach(() => {
    rasterizeSvgToBlobMock.mockReset();
    rasterizeSvgToBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  });

  it('normalizes project paths before resolving raster cache directory', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const sourceFile = new File(['<svg />'], 'icon.svg', {
      type: 'image/svg+xml',
      lastModified: 100,
    });
    const sourceFileHandle = createFileHandle(sourceFile);

    await ensureVectorImageRaster({
      projectId: 'project-1',
      projectRelativePath: './_images/./icon.svg',
      width: 64,
      height: 64,
      sourceFileHandle,
      vfs,
    });

    await ensureVectorImageRaster({
      projectId: 'project-1',
      projectRelativePath: '_images/icon.svg',
      width: 64,
      height: 64,
      sourceFileHandle,
      vfs,
    });

    expect(rasterizeSvgToBlobMock).toHaveBeenCalledTimes(1);
  });
});
