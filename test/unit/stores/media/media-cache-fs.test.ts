/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createMediaCacheFsModule } from '~/stores/media/media-cache-fs';

describe('createMediaCacheFsModule', () => {
  it('getCacheFileName encodes the path', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => 'proj-1' });
    expect(mod.getCacheFileName('videos/clip.mp4')).toBe('videos%2Fclip.mp4.json');
  });

  it('getFilesMetaFilePath returns null when no project is open', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => null });
    expect(mod.getFilesMetaFilePath('videos/clip.mp4')).toBeNull();
  });

  it('getWaveformsFilePath returns null when no project is open', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => null });
    expect(mod.getWaveformsFilePath('videos/clip.mp4')).toBeNull();
  });

  it('getFilesMetaFilePath returns path with project id and meta dir', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => 'proj-1' });
    const path = mod.getFilesMetaFilePath('videos/clip.mp4');
    expect(path).not.toBeNull();
    expect(path).toContain('proj-1');
    expect(path).toContain('files-meta');
    expect(path).toContain('videos%2Fclip.mp4.json');
  });

  it('getWaveformsFilePath returns path with project id and waveforms dir', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => 'proj-1' });
    const path = mod.getWaveformsFilePath('videos/clip.mp4');
    expect(path).not.toBeNull();
    expect(path).toContain('proj-1');
    expect(path).toContain('waveforms');
    expect(path).toContain('videos%2Fclip.mp4.json');
  });

  it('handles special characters in path', () => {
    const mod = createMediaCacheFsModule({ getProjectId: () => 'proj-1' });
    const fileName = mod.getCacheFileName('path with spaces/clip (1).mp4');
    expect(fileName).toBe('path%20with%20spaces%2Fclip%20(1).mp4.json');
  });
});
