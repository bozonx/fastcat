import { describe, expect, it } from 'vitest';

import { buildStopFrameFilename, formatStopFrameTimecode } from '../../../src/utils/stop-frames';

describe('stop-frames', () => {
  it('formats timecode as HH-MM-SS-FF', () => {
    expect(formatStopFrameTimecode({ timeUs: 0, fps: 30 })).toBe('00-00-00-00');
    expect(formatStopFrameTimecode({ timeUs: 1_000_000, fps: 30 })).toBe('00-00-01-00');
    expect(formatStopFrameTimecode({ timeUs: 1_500_000, fps: 30 })).toBe('00-00-01-15');
  });

  it('builds filename with sanitized timeline name and png extension', () => {
    const filename = buildStopFrameFilename({
      timelineName: 'My Timeline.otio',
      timeUs: 1_000_000,
      fps: 30,
      suffix: 'v1',
    });

    expect(filename).toBe('My_Timeline_00-00-01-00_v1.webp');
  });

  it('defaults to timeline base name if empty', () => {
    const filename = buildStopFrameFilename({
      timelineName: '',
      timeUs: 0,
      fps: 30,
      suffix: 'x',
    });

    expect(filename).toBe('timeline_00-00-00-00_x.webp');
  });
});
