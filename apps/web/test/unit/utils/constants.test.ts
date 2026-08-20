/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  PROXY_DIR_NAME,
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  FILES_DIR_NAME,
  EXPORT_DIR_NAME,
  TIMELINES_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  MAX_AUDIO_FILE_BYTES,
  VIDEO_CORE_LIMITS,
  TIMELINE_CLIP_THUMBNAILS,
  TIMELINE_RULER_CONSTANTS,
  BLEND_MODE_OPTIONS,
  TIMELINE_BLEND_MODES,
  isTimelineBlendMode,
  TRACK_COLOR_PRESETS,
  TIMELINE_DEFAULTS,
} from '~/utils/constants';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('constants', () => {
  it('exports directory names', () => {
    expect(PROXY_DIR_NAME).toBe('proxies');
    expect(VIDEO_DIR_NAME).toBe('_video');
    expect(AUDIO_DIR_NAME).toBe('_audio');
    expect(IMAGES_DIR_NAME).toBe('_images');
    expect(FILES_DIR_NAME).toBe('_files');
    expect(EXPORT_DIR_NAME).toBe('_export');
    expect(TIMELINES_DIR_NAME).toBe('_timelines');
    expect(DOCUMENTS_DIR_NAME).toBe('_documents');
  });

  it('exports audio file size limit', () => {
    expect(MAX_AUDIO_FILE_BYTES).toBe(200 * 1024 * 1024);
  });

  it('exports video core limits', () => {
    expect(VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS).toBe(4);
    expect(VIDEO_CORE_LIMITS.MAX_VIDEO_SAMPLE_REQUEST_TIMEOUT_MS).toBe(5_000);
    expect(VIDEO_CORE_LIMITS.MAX_VIDEO_FRAME_CACHE_MB).toBe(256);
    expect(VIDEO_CORE_LIMITS.MAX_WORKER_RPC_PENDING_CALLS).toBe(500);
    expect(VIDEO_CORE_LIMITS.BLEND_SHADOW_GAP_THRESHOLD_TICKS).toBe(TICKS_PER_SECOND / 5);
  });

  it('exports timeline clip thumbnails config', () => {
    expect(TIMELINE_CLIP_THUMBNAILS.DIR_NAME).toBe('video_clips');
    expect(TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS).toBe(4);
    expect(TIMELINE_CLIP_THUMBNAILS.WIDTH).toBe(320);
    expect(TIMELINE_CLIP_THUMBNAILS.HEIGHT).toBe(320);
    expect(TIMELINE_CLIP_THUMBNAILS.QUALITY).toBe(0.7);
  });

  it('exports ruler constants', () => {
    expect(TIMELINE_RULER_CONSTANTS.DEFAULT_ZONE_DURATION_TICKS).toBe(5 * TICKS_PER_SECOND);
    expect(TIMELINE_RULER_CONSTANTS.MIN_MARKER_DURATION_PX).toBe(10);
    expect(TIMELINE_RULER_CONSTANTS.MIN_SELECTION_DURATION_PX).toBe(6);
  });

  it('exports blend mode options', () => {
    expect(BLEND_MODE_OPTIONS).toHaveLength(17);
    expect(TIMELINE_BLEND_MODES).toHaveLength(17);
    expect(BLEND_MODE_OPTIONS[0]!.value).toBe('normal');
    expect(BLEND_MODE_OPTIONS.map((opt) => opt.value)).toEqual([...TIMELINE_BLEND_MODES]);
    expect(isTimelineBlendMode('overlay')).toBe(true);
    expect(isTimelineBlendMode('soft-light')).toBe(true);
    expect(isTimelineBlendMode('invalid')).toBe(false);
  });

  it('exports track color presets', () => {
    expect(TRACK_COLOR_PRESETS).toHaveLength(9);
    expect(TRACK_COLOR_PRESETS[0]).toBe('#2a2a2a');
  });

  it('exports timeline defaults', () => {
    expect(TIMELINE_DEFAULTS.FPS).toBe(30);
    expect(TIMELINE_DEFAULTS.ZOOM).toBe(50);
    expect(TIMELINE_DEFAULTS.MASTER_GAIN).toBe(1);
    expect(TIMELINE_DEFAULTS.PLAYBACK_SPEED).toBe(1);
  });
});
