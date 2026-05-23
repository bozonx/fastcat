export const PROXY_DIR_NAME = 'proxies';
export const VIDEO_DIR_NAME = '_video';
export const AUDIO_DIR_NAME = '_audio';
export const IMAGES_DIR_NAME = '_images';
export const FILES_DIR_NAME = '_files';
export const EXPORT_DIR_NAME = '_export';
export const TIMELINES_DIR_NAME = '_timelines';
export const DOCUMENTS_DIR_NAME = '_documents';

export const FASTCAT_PUBLICADOR_APP_NAME = 'FastCat';

export const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024; // 200MB

export const FILE_IO_LIMITS = {
  /**
   * Max concurrent `FileSystemWritableFileStream` writes in the **browser**
   * (Chromium File System Access / OPFS) runtime.
   *
   * Every open writable consumes a Chromium "datapipe" handle, and the
   * preview/export workers read video through the same renderer-process pool.
   * Capping concurrency here keeps a burst of writers (settings/ui/meta autosave,
   * timeline autosave + backups, audio peaks, thumbnails, proxies) from
   * exhausting that pool — which surfaced as `InvalidStateError: Failed to
   * create datapipe` on writes and `TypeError: network error` on worker reads.
   */
  MAX_CONCURRENT_FILE_WRITES: 2,
  /**
   * Max concurrent writes in the **Tauri** runtime. Tauri writes go to the
   * native filesystem (custom handle, not a Chromium `FileSystemFileHandle`), so
   * they do not share the mojo datapipe pool — the browser cap would only add
   * latency. Kept finite as a light guard against pathological FD/disk thrash;
   * far above the handful of writers that ever run at once.
   */
  MAX_CONCURRENT_FILE_WRITES_NATIVE: 32,
} as const;

export const VIDEO_CORE_LIMITS = {
  MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS: 4,
  MAX_VIDEO_SAMPLE_REQUEST_TIMEOUT_MS: 5_000,
  /**
   * Max wall-clock a single op (render/load/mutation) may hold the compositor's
   * serialization queue before the watchdog aborts it to release the queue. Set
   * well above MAX_VIDEO_SAMPLE_REQUEST_TIMEOUT_MS so it only fires on a genuine
   * stall, never on a normally-slow render.
   */
  OP_QUEUE_WATCHDOG_MS: 15_000,
  MAX_VIDEO_FRAME_CACHE_MB: 256,
  MAX_WORKER_RPC_PENDING_CALLS: 500,
  /** Max gap (µs) between adjacent clips to still apply blend shadow during transitions */
  BLEND_SHADOW_GAP_THRESHOLD_US: 200_000,
};

export const TIMELINE_CLIP_THUMBNAILS = {
  DIR_NAME: 'video_clips',
  INTERVAL_SECONDS: 4,
  /** Max dimension (px) for thumbnail generation — applies to both axes so vertical videos get 180×320, horizontal 320×180. */
  WIDTH: 320,
  HEIGHT: 320,
  QUALITY: 0.7,
  MAX_CONCURRENT_TASKS: 2,
} as const;

export const FILE_MANAGER_THUMBNAILS = {
  DIR_NAME: 'video_files',
  MAX_SIZE: 400,
  QUALITY: 0.6,
  POSITION_FRACTION: 0.25, // First quarter
  MAX_CONCURRENT_TASKS: 3,
} as const;

export const FILE_MANAGER_ROOT_SPACER_HEIGHT = '6rem';

export const TIMELINE_TRACK_LABELS_WIDTH = 220;

export const TIMELINE_MANAGER_THUMBNAILS = {
  DIR_NAME: 'timelines',
  MAX_SIZE: 1280,
  QUALITY: 0.8,
} as const;

export const MARKER_THUMBNAILS = {
  DIR_NAME: 'markers',
  WIDTH: 160,
  HEIGHT: 90,
  QUALITY: 0.6,
} as const;

export const TIMELINE_RULER_CONSTANTS = {
  DEFAULT_ZONE_DURATION_US: 5_000_000, // 5 seconds
  MIN_MARKER_DURATION_PX: 10,
  MIN_SELECTION_DURATION_PX: 6,
} as const;

export const BLEND_MODE_OPTIONS = [
  { value: 'normal', labelKey: 'fastcat.clip.blendMode.normal' },
  { value: 'add', labelKey: 'fastcat.clip.blendMode.add' },
  { value: 'multiply', labelKey: 'fastcat.clip.blendMode.multiply' },
  { value: 'screen', labelKey: 'fastcat.clip.blendMode.screen' },
  { value: 'darken', labelKey: 'fastcat.clip.blendMode.darken' },
  { value: 'lighten', labelKey: 'fastcat.clip.blendMode.lighten' },
];

export const TRACK_COLOR_PRESETS = [
  '#2a2a2a', // Default
  '#4a90e2', // Blue
  '#50e3c2', // Teal
  '#b8e986', // Green
  '#f8e71c', // Yellow
  '#f5a623', // Orange
  '#d0021b', // Red
  '#bd10e0', // Purple
  '#9013fe', // Violet
];
export const TIMELINE_DEFAULTS = {
  FPS: 30,
  ZOOM: 50,
  MASTER_GAIN: 1,
  PLAYBACK_SPEED: 1,
} as const;
