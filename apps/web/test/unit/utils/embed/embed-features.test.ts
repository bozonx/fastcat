/** @vitest-environment node */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isEmbedFeatureEnabled,
  isFeatureAvailable,
  setEmbedFeatures,
} from '~/utils/embed-features';
import { isEmbedRuntime } from '~/utils/embed-runtime';

vi.mock('~/utils/embed-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/utils/embed-runtime')>()),
  isEmbedRuntime: vi.fn(() => false),
}));

afterEach(() => {
  setEmbedFeatures(undefined);
  vi.mocked(isEmbedRuntime).mockReturnValue(false);
});

describe('embed feature profile', () => {
  it('offers only the timeline and an export by default', () => {
    setEmbedFeatures(undefined);
    expect(isEmbedFeatureEnabled('export')).toBe(true);
    expect(isEmbedFeatureEnabled('files')).toBe(false);
    expect(isEmbedFeatureEnabled('settings')).toBe(false);
  });

  it('switches on exactly what the host asked for', () => {
    setEmbedFeatures(['files', 'sound']);
    expect(isEmbedFeatureEnabled('files')).toBe(true);
    expect(isEmbedFeatureEnabled('sound')).toBe(true);
    // Defaults do not survive an explicit list.
    expect(isEmbedFeatureEnabled('export')).toBe(false);
  });

  it('drops names it does not recognise rather than failing the handshake', () => {
    setEmbedFeatures(['export', 'time-travel', 42, null]);
    expect(isEmbedFeatureEnabled('export')).toBe(true);
    expect(isEmbedFeatureEnabled('files')).toBe(false);
  });

  it('treats an empty list as "nothing beyond the timeline"', () => {
    setEmbedFeatures([]);
    expect(isEmbedFeatureEnabled('export')).toBe(false);
  });
});

describe('feature availability', () => {
  it('offers every view outside an embed, whatever the profile says', () => {
    setEmbedFeatures([]);
    expect(isFeatureAvailable('files')).toBe(true);
  });

  it('offers inside an embed only what the host switched on', () => {
    vi.mocked(isEmbedRuntime).mockReturnValue(true);
    setEmbedFeatures(['sound']);
    expect(isFeatureAvailable('sound')).toBe(true);
    expect(isFeatureAvailable('files')).toBe(false);
  });
});
