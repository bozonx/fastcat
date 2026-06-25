/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useMediaPlayerVolume } from '~/composables/preview/useMediaPlayerVolume';

vi.mock('@vueuse/core', () => ({
  useLocalStorage: vi.fn((key: string, defaultValue: unknown) => {
    return { value: defaultValue };
  }),
}));

describe('useMediaPlayerVolume', () => {
  it('returns volume and isMuted refs', () => {
    const { volume, isMuted } = useMediaPlayerVolume();
    expect(volume).toBeDefined();
    expect(volume.value).toBe(1.0);
    expect(isMuted).toBeDefined();
    expect(isMuted.value).toBe(false);
  });

  it('uses correct localStorage keys', async () => {
    const { useLocalStorage } = await import('@vueuse/core');
    // useLocalStorage is called at module-level, so it was already called during import
    expect(useLocalStorage).toHaveBeenCalledWith('fastcat-media-player-volume', 1.0);
    expect(useLocalStorage).toHaveBeenCalledWith('fastcat-media-player-muted', false);
  });
});
