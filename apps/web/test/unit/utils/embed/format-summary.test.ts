import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMELINE_FORMAT } from '~/timeline/format';
import { summarizeEmbedFormat } from '~/utils/embed/format-summary';

describe('summarizeEmbedFormat', () => {
  it('reports an auto format that no video has set yet as unresolved', () => {
    expect(summarizeEmbedFormat(DEFAULT_TIMELINE_FORMAT)).toEqual({
      width: 1920,
      height: 1080,
      fps: 25,
      source: 'unresolved',
    });
  });

  it('reports a format detected from footage as taken from the first clip', () => {
    const summary = summarizeEmbedFormat({
      ...DEFAULT_TIMELINE_FORMAT,
      width: 1080,
      height: 1920,
      fps: 30,
      geometryResolved: true,
      settingsSource: 'firstClip',
    });

    expect(summary).toEqual({ width: 1080, height: 1920, fps: 30, source: 'firstClip' });
  });

  it('reports a format the host set up front', () => {
    const summary = summarizeEmbedFormat({
      ...DEFAULT_TIMELINE_FORMAT,
      isAutoSettings: false,
      geometryResolved: true,
      settingsSource: 'projectDefaults',
    });

    expect(summary.source).toBe('projectDefaults');
  });

  it('reports a format the user picked', () => {
    const summary = summarizeEmbedFormat({
      ...DEFAULT_TIMELINE_FORMAT,
      isAutoSettings: false,
      geometryResolved: true,
      settingsSource: 'manual',
    });

    expect(summary.source).toBe('manual');
  });
});
