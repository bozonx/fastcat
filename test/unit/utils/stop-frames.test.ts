import { describe, expect, it } from 'vitest';

import { buildStopFrameBaseName, formatStopFrameTimecode } from '../../../src/utils/stop-frames';

describe('stop-frames', () => {
  it('formats timecode as HH-MM-SS-FF', () => {
    expect(formatStopFrameTimecode({ timeUs: 0, fps: 30 })).toBe('00-00-00-00');
    expect(formatStopFrameTimecode({ timeUs: 1_000_000, fps: 30 })).toBe('00-00-01-00');
    expect(formatStopFrameTimecode({ timeUs: 1_500_000, fps: 30 })).toBe('00-00-01-15');
  });

  it('builds base name with sanitized timeline name and timecode', () => {
    const base = buildStopFrameBaseName({
      timelineName: 'My Timeline.otio',
      timeUs: 1_000_000,
      fps: 30,
    });

    expect(base).toBe('My_Timeline_00-00-01-00');
  });

  it('defaults to timeline base name if empty', () => {
    const base = buildStopFrameBaseName({
      timelineName: '',
      timeUs: 0,
      fps: 30,
    });

    expect(base).toBe('timeline_00-00-00-00');
  });
});
