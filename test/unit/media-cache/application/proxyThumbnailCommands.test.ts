// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupVideoCachesCommand,
  clearVideoThumbnailsCommand,
  onVideoPathMovedCommand,
  removeProxyCommand,
} from '../../../../src/media-cache/application/proxyThumbnailCommands';

function createServiceMock() {
  return {
    checkExistingProxies: vi.fn(async () => undefined),
    removeProxy: vi.fn(async () => undefined),
    clearExistingProxies: vi.fn(() => undefined),
    clearVideoThumbnails: vi.fn(async () => undefined),
  };
}

describe('proxyThumbnailCommands', () => {
  it('removeProxyCommand calls service.removeProxy', async () => {
    const service = createServiceMock();

    await removeProxyCommand({ service, projectRelativePath: '_video/a.mp4' });

    expect(service.removeProxy).toHaveBeenCalledWith('_video/a.mp4');
  });

  it('clearVideoThumbnailsCommand calls service.clearVideoThumbnails', async () => {
    const service = createServiceMock();

    await clearVideoThumbnailsCommand({
      service,
      projectId: 'p1',
      projectRelativePath: '_video/a.mp4',
    });

    expect(service.clearVideoThumbnails).toHaveBeenCalledWith({
      projectId: 'p1',
      projectRelativePath: '_video/a.mp4',
    });
  });

  it('cleanupVideoCachesCommand removes proxy then clears thumbnails', async () => {
    const service = createServiceMock();

    await cleanupVideoCachesCommand({
      service,
      projectId: 'p1',
      projectRelativePath: '_video/a.mp4',
    });

    expect(service.removeProxy).toHaveBeenCalledWith('_video/a.mp4');
    expect(service.clearVideoThumbnails).toHaveBeenCalledWith({
      projectId: 'p1',
      projectRelativePath: '_video/a.mp4',
    });
  });

  it('onVideoPathMovedCommand removes old proxy, clears cache, clears old thumbnails, rechecks new path', async () => {
    const service = createServiceMock();

    await onVideoPathMovedCommand({
      service,
      projectId: 'p1',
      oldPath: '_video/a.mp4',
      newPath: '_video2/a.mp4',
    });

    expect(service.removeProxy).toHaveBeenCalledWith('_video/a.mp4');
    expect(service.clearExistingProxies).toHaveBeenCalled();
    expect(service.clearVideoThumbnails).toHaveBeenCalledWith({
      projectId: 'p1',
      projectRelativePath: '_video/a.mp4',
    });
    expect(service.checkExistingProxies).toHaveBeenCalledWith(['_video2/a.mp4']);
  });
});
