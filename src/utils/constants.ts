export const PROXY_DIR_NAME = 'proxies';
export const VIDEO_DIR_NAME = '_video';
export const AUDIO_DIR_NAME = '_audio';
export const IMAGES_DIR_NAME = '_images';
export const EXPORT_DIR_NAME = '_export';
export const TIMELINES_DIR_NAME = '_timelines';
export const SOURCES_DIR_NAME = 'sources'; // Keeping for migration/compatibility if needed

export const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024; // 200MB

export const STORAGE_LIMITS = {
  PROXY_BYTES: 10 * 1024 * 1024 * 1024, // 10GB
  CACHE_BYTES: 2 * 1024 * 1024 * 1024, // 2GB
  THUMBNAILS_BYTES: 1 * 1024 * 1024 * 1024, // 1GB
};

export const VIDEO_CORE_LIMITS = {
  MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS: 4,
  MAX_WORKER_RPC_PENDING_CALLS: 500,
};

export const TIMELINE_CLIP_THUMBNAILS = {
  DIR_NAME: 'video_clip_frames',
  INTERVAL_SECONDS: 2,
  WIDTH: 160,
  HEIGHT: 90,
  QUALITY: 0.4,
  MAX_CONCURRENT_TASKS: 2,
} as const;
