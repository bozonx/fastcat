// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeProjectSettings } from '../../src/utils/project-settings';
import { createDefaultUserSettings } from '../../src/utils/settings';

describe('project settings normalization', () => {
  it('clamps numeric fields to reasonable bounds', () => {
    const user = createDefaultUserSettings();

    const normalized = normalizeProjectSettings(
      {
        project: {
          width: 1920,
          height: 1080,
          fps: 25,
          resolutionFormat: '1080p',
          orientation: 'landscape',
          aspectRatio: '16:9',
          isCustomResolution: false,
          audioChannels: 'stereo',
          sampleRate: 999999,
        },
        exportDefaults: {
          encoding: {
            format: 'mp4',
            videoCodec: 'avc1.640032',
            bitrateMbps: 5,
            excludeAudio: false,
            audioCodec: 'aac',
            audioBitrateKbps: 128,
            bitrateMode: 'variable',
            keyframeIntervalSec: 999,
            exportAlpha: false,
            metadata: {
              title: '',
              author: '',
              tags: '',
            },
          },
        },
        monitor: {
          previewResolution: 99999,
          useProxy: true,
          panX: 0,
          panY: 0,
        },
        timelines: {
          openPaths: [],
          lastOpenedPath: null,
        },
        transitions: {
          defaultDurationUs: 2_000_000,
        },
      },
      user,
    );

    expect(normalized.project.sampleRate).toBe(192000);
    expect(normalized.exportDefaults.encoding.keyframeIntervalSec).toBe(60);
    expect(normalized.monitor.previewResolution).toBe(4320);
  });
});
