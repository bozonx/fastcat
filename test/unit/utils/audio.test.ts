import { describe, it, expect } from 'vitest';
import { formatAudioChannels } from '../../../src/utils/audio';

describe('utils/audio', () => {
  it('formatAudioChannels formats channel count', () => {
    expect(formatAudioChannels(undefined)).toBe('-');
    expect(formatAudioChannels(0)).toBe('-');
    expect(formatAudioChannels(1)).toBe('Mono');
    expect(formatAudioChannels(2)).toBe('Stereo');
    expect(formatAudioChannels(6)).toBe('6 tracks');
  });
});
