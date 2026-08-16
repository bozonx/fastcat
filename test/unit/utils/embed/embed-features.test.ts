/** @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { isEmbedFeatureEnabled, setEmbedFeatures } from '~/utils/embed-features';

afterEach(() => setEmbedFeatures(undefined));

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
