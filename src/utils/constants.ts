export const PROXY_DIR_NAME = 'proxies';
export const VIDEO_DIR_NAME = '_video';
export const AUDIO_DIR_NAME = '_audio';
export const IMAGES_DIR_NAME = '_images';
export const FILES_DIR_NAME = '_files';
export const EXPORT_DIR_NAME = '_export';
export const TIMELINES_DIR_NAME = '_timelines';

export const FASTCAT_PUBLICADOR_APP_NAME = 'FastCat';

export const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024; // 200MB

export const VIDEO_CORE_LIMITS = {
  MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS: 4,
  MAX_VIDEO_FRAME_CACHE_MB: 256,
  MAX_WORKER_RPC_PENDING_CALLS: 500,
  /** Max gap (µs) between adjacent clips to still apply blend shadow during transitions */
  BLEND_SHADOW_GAP_THRESHOLD_US: 200_000,
};

export const TIMELINE_CLIP_THUMBNAILS = {
  DIR_NAME: 'video_clips',
  INTERVAL_SECONDS: 4,
  WIDTH: 160,
  HEIGHT: 90,
  QUALITY: 0.4,
  MAX_CONCURRENT_TASKS: 2,
} as const;

export const FILE_MANAGER_THUMBNAILS = {
  DIR_NAME: 'video_files',
  MAX_SIZE: 400,
  QUALITY: 0.6,
  POSITION_FRACTION: 0.25, // First quarter
  MAX_CONCURRENT_TASKS: 3,
} as const;

export const TIMELINE_MANAGER_THUMBNAILS = {
  DIR_NAME: 'timelines',
} as const;

export const TIMELINE_RULER_CONSTANTS = {
  DEFAULT_ZONE_DURATION_US: 5_000_000, // 5 seconds
  MIN_MARKER_DURATION_PX: 10,
  MIN_SELECTION_DURATION_PX: 6,
} as const;
