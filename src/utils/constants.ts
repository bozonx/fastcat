import type { TimelineBlendMode } from '~/timeline/types';

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
   * Max concurrent **any** OPFS file operations (reads + writes) in the
   * **browser**. Reads and writes share the same Chromium datapipe pool, so a
   * unified cap prevents a burst of concurrent `getFile()`/`createWritable()`
   * calls from exhausting it.
   */
  MAX_CONCURRENT_FILE_IO: 2,
  /**
   * Interactive cap for the **shared (cross-origin isolated) budget** — a single
   * coordinated counter for the WHOLE renderer, held in the `SharedArrayBuffer`
   * (see io-budget.ts `resolveBudgetCapacity`). Because it is one atomic
   * semaphore across every realm, there is no uncoordinated-sum overshoot, so it
   * can safely run higher than the per-realm {@link MAX_CONCURRENT_FILE_IO}
   * local cap: 4 matches the historically-safe renderer datapipe pool size and
   * the compositor's {@link VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS}
   * so preview/export decode reads aren't throttled below what they request.
   *
   * Only used on the isolated (prod web) path; the local fallback keeps the
   * smaller split caps so its uncoordinated sum stays within the same ceiling.
   */
  MAX_CONCURRENT_FILE_IO_SHARED: 4,
  /**
   * Max concurrent streaming OPFS file operations (large writes/copies) in the
   * browser, ensuring interactive operations are never fully starved.
   */
  MAX_CONCURRENT_FILE_IO_STREAMING: 1,
  /**
   * Per-realm interactive cap for the **local fallback** budget (browser without
   * COOP/COEP, so a `SharedArrayBuffer` can't coordinate the realms — each runs
   * its OWN `LocalBudget` against the SAME renderer datapipe pool).
   *
   * Because the realms don't coordinate in this mode, the worker caps are kept
   * below the main-thread cap so the UNCOORDINATED SUM across the realms that do
   * editing-time OPFS I/O stays within the renderer-wide ceiling:
   *
   *   main (MAX_CONCURRENT_FILE_IO = 2)
   *   + video-core worker (MAX_CONCURRENT_FILE_IO_LOCAL_WORKER = 1)
   *   + audio-decode worker (MAX_CONCURRENT_FILE_IO_LOCAL_WORKER = 1)
   *   = 4 concurrent interactive ops — the historically-safe pool size the
   *     original single-thread governor used. Without this, three realms at the
   *     full cap of 2 reach 6 and can exhaust the pool ("Failed to create
   *     datapipe") → editor freeze under heavy editing.
   *
   * The main thread keeps the full cap (it is the busy writer and its ops are
   * short). On the shared (cross-origin isolated) path this is unused — the SAB
   * holds one coordinated budget for the whole renderer.
   */
  MAX_CONCURRENT_FILE_IO_LOCAL_WORKER: 1,
  /**
   * Unified I/O cap for the **Tauri** runtime. Same rationale as writes: in
   * Tauri this is only a light guard against FD thrash, so the value is high
   * enough not to throttle desktop I/O.
   */
  MAX_CONCURRENT_FILE_IO_NATIVE: 32,
  /**
   * How long an *interactive* io-budget slot may be held before the governor
   * logs a leak warning. Interactive ops (getFile, small writes, governed
   * reads) are short, so this is generous enough to never fire on a normal—even
   * large—operation, but low enough to surface a leaked slot (a slot that would
   * otherwise stall the small interactive pool forever). Warn-only: it never
   * force-releases, since a slow-but-alive op must not be double-counted.
   */
  SLOT_HOLD_WARN_MS_INTERACTIVE: 120_000,
  /**
   * Same, for *streaming* slots. Long-lived by design (an export writable can
   * stay open for minutes), so the threshold is much higher and only meant to
   * catch a genuinely leaked streaming slot — which is severe because the
   * streaming pool is tiny.
   */
  SLOT_HOLD_WARN_MS_STREAMING: 1_800_000,
} as const;

/**
 * Concurrency budgets for the background media-task schedulers (thumbnails,
 * encodes, waveforms). Centralised here so the web↔native values stay visible
 * side by side and are unified wherever the two runtimes have no reason to
 * differ. Each entry is `{ web, native }`.
 *
 * Design rationale (best-practice task tiers):
 * - `interactiveTasks` — quick, user-visible frame extraction (timeline & file
 *   thumbnails). Short-lived, so a small parallel pool keeps the UI responsive.
 *   Native gets +1 because desktop FS/decode has more headroom than OPFS.
 * - `encodeTasks` — long-running background encodes (proxy, conversion). Kept
 *   SERIAL (1) on both runtimes: a single encode occupies its slot for minutes,
 *   so running two would (a) starve the interactive pool if they shared it —
 *   which is why encodes live in their OWN queue — and (b) oversubscribe the
 *   CPU. Native additionally gates these via `media_job_gate`; web has no such
 *   backstop, so serialising here is what bounds it.
 * - `waveformExtraction` — audio peak extraction, the highest-value hidden task.
 *   Runs in its OWN pool so a thumbnail/encode backlog can never delay it. Web
 *   routes every request through a single shared audio-decode worker, so >1 buys
 *   nothing there; native peak extraction is ungated and can run 2 in parallel.
 */
export const MEDIA_CONCURRENCY = {
  interactiveTasks: { web: 2, native: 3 },
  encodeTasks: { web: 1, native: 1 },
  waveformExtraction: { web: 1, native: 2 },
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
  /**
   * How many encoded-frame submissions the export loop keeps in flight before it
   * stalls to wait for the encoder to drain (`waitForVideoBackpressure`). It is
   * the buffer that lets the decode/composite loop run ahead and keep a fast HW
   * encoder fed across bursty decode (some frames are cache hits, some pay a
   * seek). Too shallow starves the encoder between slow decodes; too deep just
   * pins that many full VideoFrames in the encoder queue. 8 keeps the encoder
   * busy while bounding 4K frame backlog to ~100 MB.
   */
  EXPORT_ENCODER_QUEUE_DEPTH: 8,
  /**
   * Max number of upcoming clips a single prewarm tick warms ahead of the
   * playhead. The prewarm op is exclusive against `renderFrame` (shared op
   * queue), so this is deliberately bounded — a larger batch would hold the
   * queue longer and hitch the next rendered frame. It is larger than
   * MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS (which gates *concurrency*, not how
   * many clips are queued) so a dense cut cluster — common when a nested
   * timeline flattens to many short clips packed into the lookahead window —
   * is fully covered instead of leaving the 5th+ cut cold (cut stutter).
   */
  MAX_PREWARM_CLIPS: 8,
  /**
   * How many frames of the *currently playing* clip the decode-ahead keeps warm
   * past the playhead. Fed by a persistent sequential sink iterator that lives
   * across prewarm ticks, so each 250 ms tick only decodes the few NEW frames that
   * entered this window (never a from-keyframe re-seek). Without decode-ahead
   * every played frame is an on-demand sparse `getSample` inside the render path,
   * which re-decodes from the previous keyframe and caps playback at a fraction
   * of real-time (the "plays at half fps" symptom). 16 frames ≈ two prewarm
   * intervals at 25–30 fps: enough slack to ride out a slow tick without pinning
   * a large VideoFrame backlog in the cache budget.
   */
  MAX_ACTIVE_PREWARM_FRAMES: 16,
  MAX_WORKER_RPC_PENDING_CALLS: 500,
  /** Max gap (µs) between adjacent clips to still apply blend shadow during transitions */
  BLEND_SHADOW_GAP_THRESHOLD_US: 200_000,
};

export const PIXI_RENDERER_PREFERENCE = 'webgpu' as const;

/**
 * Per-method timeouts (ms) for worker RPC calls. A single coarse timeout is
 * wrong because methods have wildly different cost: a metadata probe should
 * fail fast, a full timeline rebuild on a slow disk legitimately takes longer,
 * and long-running jobs (export, audio extraction, transcode, frame-strip
 * extraction) must not time out at all — they report progress and are cancelled
 * explicitly. `null` means "no timeout".
 */
export const WORKER_RPC_TIMEOUTS_MS: Record<string, number | null> = {
  extractMetadata: 30_000,
  setPixiRendererPreference: 10_000,
  initCompositor: 30_000,
  destroyCompositor: 15_000,
  clearClips: 15_000,
  renderFrame: 60_000,
  loadTimeline: 120_000,
  updateTimelineLayout: 60_000,
  extractFrameToBlob: 60_000,
  // No timeout: progress-reporting / explicitly-cancelled long jobs.
  exportTimeline: null,
  transcodeMedia: null,
  extractAudio: null,
  extractVideoFrameBlobs: null,
  cancelExport: 30_000,
  releaseFrameExtractor: 15_000,
};

/** Fallback when a method has no explicit entry in WORKER_RPC_TIMEOUTS_MS. */
export const WORKER_RPC_DEFAULT_TIMEOUT_MS = 30_000;

export const TIMELINE_CLIP_THUMBNAILS = {
  DIR_NAME: 'video_clips',
  INTERVAL_SECONDS: 4,
  /** Max dimension (px) for thumbnail generation — applies to both axes so vertical videos get 180×320, horizontal 320×180. */
  WIDTH: 320,
  HEIGHT: 320,
  QUALITY: 0.7,
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

export const TIMELINE_BLEND_MODES = [
  'normal',
  'add',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const satisfies readonly TimelineBlendMode[];

export function isTimelineBlendMode(value: unknown): value is TimelineBlendMode {
  return typeof value === 'string' && TIMELINE_BLEND_MODES.includes(value as TimelineBlendMode);
}

export const BLEND_MODE_OPTIONS: Array<{
  value: TimelineBlendMode;
  labelKey: string;
}> = [
  { value: 'normal', labelKey: 'fastcat.clip.blendMode.normal' },
  { value: 'add', labelKey: 'fastcat.clip.blendMode.add' },
  { value: 'multiply', labelKey: 'fastcat.clip.blendMode.multiply' },
  { value: 'screen', labelKey: 'fastcat.clip.blendMode.screen' },
  { value: 'overlay', labelKey: 'fastcat.clip.blendMode.overlay' },
  { value: 'darken', labelKey: 'fastcat.clip.blendMode.darken' },
  { value: 'lighten', labelKey: 'fastcat.clip.blendMode.lighten' },
  { value: 'color-dodge', labelKey: 'fastcat.clip.blendMode.colorDodge' },
  { value: 'color-burn', labelKey: 'fastcat.clip.blendMode.colorBurn' },
  { value: 'hard-light', labelKey: 'fastcat.clip.blendMode.hardLight' },
  { value: 'soft-light', labelKey: 'fastcat.clip.blendMode.softLight' },
  { value: 'difference', labelKey: 'fastcat.clip.blendMode.difference' },
  { value: 'exclusion', labelKey: 'fastcat.clip.blendMode.exclusion' },
  { value: 'hue', labelKey: 'fastcat.clip.blendMode.hue' },
  { value: 'saturation', labelKey: 'fastcat.clip.blendMode.saturation' },
  { value: 'color', labelKey: 'fastcat.clip.blendMode.color' },
  { value: 'luminosity', labelKey: 'fastcat.clip.blendMode.luminosity' },
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
