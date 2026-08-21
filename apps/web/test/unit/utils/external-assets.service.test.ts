/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveAssetPlacement } from '~/utils/external-assets.service';

describe('resolveAssetPlacement', () => {
  it('honours an explicitly declared type over everything else', () => {
    const placement = resolveAssetPlacement(
      { url: 'https://example.com/clip.mp4', type: 'audio' },
      'video/mp4',
    );
    expect(placement.type).toBe('audio');
    expect(placement.relativePath).toBe('_audio/clip.mp4');
  });

  it('falls back to the served content type', () => {
    const placement = resolveAssetPlacement({ url: 'https://example.com/asset' }, 'video/mp4');
    expect(placement.type).toBe('video');
    expect(placement.relativePath).toBe('_video/asset');
  });

  it('falls back to the file extension when no content type is served', () => {
    expect(resolveAssetPlacement({ url: 'https://example.com/track.mp3' }).type).toBe('audio');
    expect(resolveAssetPlacement({ url: 'https://example.com/movie.mov' }).type).toBe('video');
    expect(resolveAssetPlacement({ url: 'https://example.com/photo.png' }).type).toBe('image');
  });

  it('strips the query string off a signed URL when deriving the filename', () => {
    const placement = resolveAssetPlacement({
      url: 'https://cdn.example.com/media/clip.mp4?signature=abc&expires=123',
    });
    expect(placement.filename).toBe('clip.mp4');
    expect(placement.relativePath).toBe('_video/clip.mp4');
  });

  it('prefers the host-supplied filename', () => {
    const placement = resolveAssetPlacement({
      url: 'https://cdn.example.com/9f8a7b6c',
      filename: 'interview.mp4',
    });
    expect(placement.relativePath).toBe('_video/interview.mp4');
  });

  it('uses the asset id for storage while preserving its display filename', () => {
    const placement = resolveAssetPlacement(
      {
        id: 'post/asset-42',
        url: 'https://cdn.example.com/source',
        filename: 'Видео про кота (1)+.mp4',
        type: 'video',
      },
      'video/webm; charset=binary',
    );

    expect(placement.filename).toBe('Видео про кота (1)+.mp4');
    expect(placement.relativePath).toBe('_video/post%2Fasset-42.webm');
  });

  it('keeps equal display names distinct when asset ids differ', () => {
    const first = resolveAssetPlacement({
      id: 'first',
      url: '',
      filename: 'clip.mp4',
      type: 'video',
    });
    const second = resolveAssetPlacement({
      id: 'second',
      url: '',
      filename: 'clip.mp4',
      type: 'video',
    });

    expect(first.relativePath).toBe('_video/first.mp4');
    expect(second.relativePath).toBe('_video/second.mp4');
  });

  it('invents a unique filename when the URL carries none', () => {
    const placement = resolveAssetPlacement({ url: 'https://example.com/', type: 'video' });
    expect(placement.filename).toMatch(/^asset-\d+-[a-z0-9]+\.mp4$/i);
    expect(placement.relativePath.startsWith('_video/')).toBe(true);
  });
});
