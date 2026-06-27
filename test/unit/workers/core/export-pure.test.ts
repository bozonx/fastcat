/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  isOpusCodec,
  buildMetadataTags,
  selectOutputFormat,
  isPassthroughCompatibleClip,
} from '~/workers/core/export';
import type { OutputFormatConstructors } from '~/workers/core/export';

function makeCtors(): OutputFormatConstructors {
  return {
    Mp4OutputFormat: class MockMp4 {},
    WebMOutputFormat: class MockWebM {},
    MkvOutputFormat: class MockMkv {},
    AdtsOutputFormat: class MockAdts {},
    OggOutputFormat: class MockOgg {},
    FlacOutputFormat: class MockFlac {},
    WavOutputFormat: class MockWav {},
  };
}

describe('isOpusCodec', () => {
  it('returns true for "opus" codec string', () => {
    expect(isOpusCodec('opus')).toBe(true);
  });

  it('returns true for "Opus" case-insensitive', () => {
    expect(isOpusCodec('Opus')).toBe(true);
  });

  it('returns true for "opus_v1" prefix match', () => {
    expect(isOpusCodec('opus_v1')).toBe(true);
  });

  it('returns false for "mp4a" codec', () => {
    expect(isOpusCodec('mp4a.40.2')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isOpusCodec(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isOpusCodec('')).toBe(false);
  });
});

describe('buildMetadataTags', () => {
  it('returns null when all fields are empty', () => {
    expect(buildMetadataTags({})).toBeNull();
  });

  it('returns null when all fields are whitespace-only', () => {
    expect(buildMetadataTags({ title: '  ', description: '\t' })).toBeNull();
  });

  it('maps title to tags.title', () => {
    const tags = buildMetadataTags({ title: 'My Video' });
    expect(tags).toEqual({ title: 'My Video' });
  });

  it('maps description to tags.description', () => {
    const tags = buildMetadataTags({ description: 'A test video' });
    expect(tags).toEqual({ description: 'A test video' });
  });

  it('maps author to tags.artist (not tags.author)', () => {
    const tags = buildMetadataTags({ author: 'John Doe' });
    expect(tags).toEqual({ artist: 'John Doe' });
    expect(tags).not.toHaveProperty('author');
  });

  it('maps tags string to tags.comment as comma-separated', () => {
    const tags = buildMetadataTags({ tags: 'travel, nature, sunset' });
    expect(tags).toEqual({ comment: 'travel, nature, sunset' });
  });

  it('trims whitespace from all fields', () => {
    const tags = buildMetadataTags({
      title: '  Hello  ',
      description: '  World  ',
      author: '  Author  ',
      tags: '  a, b, c  ',
    });
    expect(tags).toEqual({
      title: 'Hello',
      description: 'World',
      artist: 'Author',
      comment: 'a, b, c',
    });
  });

  it('filters out empty tag entries from comma-separated list', () => {
    const tags = buildMetadataTags({ tags: 'a, , b,  , c' });
    expect(tags).toEqual({ comment: 'a, b, c' });
  });

  it('returns null when tags string has only empty entries', () => {
    const tags = buildMetadataTags({ tags: '  ,  ,  ' });
    expect(tags).toBeNull();
  });

  it('combines all fields together', () => {
    const tags = buildMetadataTags({
      title: 'Title',
      description: 'Desc',
      author: 'Auth',
      tags: 't1, t2',
    });
    expect(tags).toEqual({
      title: 'Title',
      description: 'Desc',
      artist: 'Auth',
      comment: 't1, t2',
    });
  });
});

describe('selectOutputFormat', () => {
  it('returns WebMOutputFormat for "webm"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('webm', ctors);
    expect(result).toBeInstanceOf(ctors.WebMOutputFormat);
  });

  it('returns MkvOutputFormat for "mkv"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('mkv', ctors);
    expect(result).toBeInstanceOf(ctors.MkvOutputFormat);
  });

  it('returns AdtsOutputFormat for "aac"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('aac', ctors);
    expect(result).toBeInstanceOf(ctors.AdtsOutputFormat);
  });

  it('returns OggOutputFormat for "opus"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('opus', ctors);
    expect(result).toBeInstanceOf(ctors.OggOutputFormat);
  });

  it('returns OggOutputFormat for "ogg"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('ogg', ctors);
    expect(result).toBeInstanceOf(ctors.OggOutputFormat);
  });

  it('returns FlacOutputFormat for "flac"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('flac', ctors);
    expect(result).toBeInstanceOf(ctors.FlacOutputFormat);
  });

  it('returns WavOutputFormat for "wav"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('wav', ctors);
    expect(result).toBeInstanceOf(ctors.WavOutputFormat);
  });

  it('returns WavOutputFormat for "pcm"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('pcm', ctors);
    expect(result).toBeInstanceOf(ctors.WavOutputFormat);
  });

  it('throws for "mp3" (not supported in web version)', () => {
    const ctors = makeCtors();
    expect(() => selectOutputFormat('mp3', ctors)).toThrow(
      'MP3 export is not supported in the web version',
    );
  });

  it('returns Mp4OutputFormat as default for "mp4"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('mp4', ctors);
    expect(result).toBeInstanceOf(ctors.Mp4OutputFormat);
  });

  it('returns Mp4OutputFormat as default for unknown format', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('unknown', ctors);
    expect(result).toBeInstanceOf(ctors.Mp4OutputFormat);
  });
});

describe('isPassthroughCompatibleClip - extended edge cases', () => {
  const baseOpts = { audioSampleRate: 48000, audioChannels: 'stereo' as const };

  it('rejects clip with audio transition in', () => {
    const clip = {
      transitionIn: { durationUs: 500_000 },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('transition');
    }
  });

  it('rejects clip with audio transition out', () => {
    const clip = {
      transitionOut: { durationUs: 500_000 },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('transition');
    }
  });

  it('rejects clip with enabled audio effect', () => {
    const clip = {
      effects: [{ target: 'audio', enabled: true }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('audio effects');
    }
  });

  it('allows clip with disabled audio effect', () => {
    const clip = {
      effects: [{ target: 'audio', enabled: false }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('allows clip with video-only effect', () => {
    const clip = {
      effects: [{ target: 'video', enabled: true }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('rejects clip with negative speed (reverse)', () => {
    const clip = { speed: -1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('speed');
    }
  });

  it('allows clip with speed exactly 1', () => {
    const clip = { speed: 1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('rejects clip with gain slightly above 1', () => {
    const clip = { audioGain: 1.001 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('gain');
    }
  });

  it('rejects clip with non-zero balance', () => {
    const clip = { audioBalance: 0.1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('balance');
    }
  });

  it('rejects clip with fade in', () => {
    const clip = { audioFadeInUs: 100_000 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('fade');
    }
  });

  it('rejects clip with fade out', () => {
    const clip = { audioFadeOutUs: 100_000 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('fade');
    }
  });

  it('reads from fastcat nested object when top-level is absent', () => {
    const clip = {
      fastcat: { audioGain: 2.0 },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('gain');
    }
  });

  it('allows an empty clip (all defaults)', () => {
    const clip = {};
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });
});
