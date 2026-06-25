/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadExternalAssets, type ExternalAsset } from '~/utils/external-assets.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('loadExternalAssets', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns empty array for no assets', async () => {
    const writeProjectFile = vi.fn();
    const results = await loadExternalAssets({ assets: [], writeProjectFile });
    expect(results).toEqual([]);
  });

  it('loads an asset successfully', async () => {
    const blob = new Blob(['data'], { type: 'video/mp4' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'video/mp4' }),
      blob: async () => blob,
    });
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/video.mp4' }],
      writeProjectFile,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.path).toContain('video/');
    expect(writeProjectFile).toHaveBeenCalledOnce();
  });

  it('handles fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const writeProjectFile = vi.fn();
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/bad.mp4' }],
      writeProjectFile,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBe('Network error');
  });

  it('handles HTTP error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      blob: async () => new Blob(),
    });
    const writeProjectFile = vi.fn();
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/missing.mp4' }],
      writeProjectFile,
    });
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toContain('404');
  });

  it('resolves type from Content-Type header', async () => {
    const blob = new Blob(['data'], { type: 'audio/mpeg' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
      blob: async () => blob,
    });
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/audio' }],
      writeProjectFile,
    });
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.path).toContain('audio/');
  });

  it('resolves type from file extension when Content-Type is generic', async () => {
    const blob = new Blob(['data']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
      blob: async () => blob,
    });
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/file', filename: 'file.mp3' }],
      writeProjectFile,
    });
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.path).toContain('audio/');
  });

  it('uses explicit type from asset', async () => {
    const blob = new Blob(['data']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
      blob: async () => blob,
    });
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const results = await loadExternalAssets({
      assets: [{ url: 'https://example.com/file', type: 'image' }],
      writeProjectFile,
    });
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.path).toContain('images/');
  });
});
