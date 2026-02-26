import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import {
  getExportWorkerClient,
  setExportHostApi,
  terminateExportWorker,
  restartExportWorker,
} from '~/utils/video-editor/worker-client';
import type { ClipTransform, TimelineTrackItem } from '~/timeline/types';
import { clampNumber, mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkAudioCodecSupport,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';

export interface ExportOptions {
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrate: number;
  audioBitrate: number;
  audio: boolean;
  audioCodec?: string;
  width: number;
  height: number;
  fps: number;
}

export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background' | 'text';
  id: string;
  layer: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  source?: { path: string };
  backgroundColor?: string;
  text?: string;
  style?: import('~/timeline/types').TextClipStyle;
  freezeFrameSourceUs?: number;
  opacity?: number;
  effects?: unknown[];
  transform?: ClipTransform;
  timelineRange: { startUs: number; durationUs: number };
  sourceRange: { startUs: number; durationUs: number };
}

export async function toWorkerTimelineClips(
  items: TimelineTrackItem[],
  projectStore: ReturnType<typeof useProjectStore>,
  options?: {
    layer?: number;
    trackKind?: 'video' | 'audio';
    visitedPaths?: Set<string>;
    parentOpacity?: number;
    parentEffects?: any[];
  },
): Promise<WorkerTimelineClip[]> {
  const clips: WorkerTimelineClip[] = [];
  const trackKind = options?.trackKind ?? 'video';
  const visitedPaths = options?.visitedPaths ?? new Set<string>();

  function cloneEffects<T>(effects: T): T {
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(effects);
      }
    } catch {
      // ignore
    }
    return effects;
  }

  function mergeFadeInUs(input: {
    childFadeInUs: unknown;
    parentFadeInUs: unknown;
    parentLocalStartUs: number;
  }): number | undefined {
    const child = clampNumber(input.childFadeInUs, 0, Number.MAX_SAFE_INTEGER);
    const parent = clampNumber(input.parentFadeInUs, 0, Number.MAX_SAFE_INTEGER);
    if (!parent || parent <= 0) return child;
    const remaining = Math.max(0, Math.round(parent - input.parentLocalStartUs));
    if (remaining <= 0) return child;
    if (child === undefined) return remaining;
    return Math.max(child, remaining);
  }

  function mergeFadeOutUs(input: {
    childFadeOutUs: unknown;
    parentFadeOutUs: unknown;
    parentLocalEndUs: number;
    parentDurationUs: number;
  }): number | undefined {
    const child = clampNumber(input.childFadeOutUs, 0, Number.MAX_SAFE_INTEGER);
    const parent = clampNumber(input.parentFadeOutUs, 0, Number.MAX_SAFE_INTEGER);
    if (!parent || parent <= 0) return child;
    const outStart = Math.max(0, Math.round(input.parentDurationUs - parent));
    if (input.parentLocalEndUs <= outStart) return child;
    const remaining = Math.max(
      0,
      Math.round(parent - (input.parentDurationUs - input.parentLocalEndUs)),
    );
    if (remaining <= 0) return child;
    if (child === undefined) return remaining;
    return Math.max(child, remaining);
  }

  function isProbablyUrlLike(path: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
  }

  function getDirname(path: string): string {
    const normalized = String(path).replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 1) return '';
    parts.pop();
    return parts.join('/');
  }

  function joinPaths(left: string, right: string): string {
    const l = String(left).replace(/\\/g, '/').replace(/\/+$/g, '');
    const r = String(right).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!l) return r;
    if (!r) return l;
    return `${l}/${r}`;
  }

  function resolveNestedMediaPath(params: {
    nestedTimelinePath: string;
    mediaPath: string;
  }): string {
    const mediaPath = String(params.mediaPath);
    if (!mediaPath) return mediaPath;
    if (mediaPath.startsWith('/')) return mediaPath;
    if (isProbablyUrlLike(mediaPath)) return mediaPath;
    if (mediaPath.startsWith('sources/') || mediaPath.startsWith('timelines/')) return mediaPath;
    const baseDir = getDirname(params.nestedTimelinePath);
    if (!baseDir) return mediaPath;
    return joinPaths(baseDir, mediaPath);
  }

  for (const item of items) {
    if (item.kind !== 'clip') continue;

    const clipType = (item as any).clipType ?? 'media';
    const parentOpacity = options?.parentOpacity ?? 1;
    const itemOpacity = item.opacity ?? 1;
    const combinedOpacity = parentOpacity * itemOpacity;

    const parentEffects = options?.parentEffects ?? [];
    const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
    const combinedEffects =
      parentEffects.length > 0 ? [...parentEffects, ...itemEffects] : itemEffects;

    const base: WorkerTimelineClip = {
      kind: 'clip',
      clipType: clipType === 'timeline' ? 'media' : clipType,
      id: item.id,
      layer:
        options?.layer ??
        (typeof (item as any).layer === 'number' && Number.isFinite((item as any).layer)
          ? Math.round((item as any).layer)
          : 0),
      speed: (item as any).speed,
      audioGain: (item as any).audioGain,
      audioBalance: (item as any).audioBalance,
      audioFadeInUs: (item as any).audioFadeInUs,
      audioFadeOutUs: (item as any).audioFadeOutUs,
      opacity: combinedOpacity,
      effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      transform: (item as any).transform,
      timelineRange: {
        startUs: item.timelineRange.startUs,
        durationUs: item.timelineRange.durationUs,
      },
      sourceRange: {
        startUs: item.sourceRange.startUs,
        durationUs: item.sourceRange.durationUs,
      },
    };

    if (clipType === 'media' || clipType === 'timeline') {
      const path = (item as any).source?.path;
      if (!path) continue;

      if (clipType === 'timeline') {
        if (visitedPaths.has(path)) {
          console.warn('Circular dependency detected in nested timeline:', path);
          continue;
        }

        try {
          const handle = await projectStore.getFileHandleByPath(path);
          if (handle) {
            const file = await handle.getFile();
            const text = await file.text();
            const nestedDoc = parseTimelineFromOtio(text, {
              id: 'nested',
              name: 'nested',
              fps: 25,
            });

            const nextVisited = new Set(visitedPaths).add(path);

            if (trackKind === 'video') {
              const nestedVideoTracks = nestedDoc.tracks.filter(
                (t) => t.kind === 'video' && !t.videoHidden,
              );
              for (let i = 0; i < nestedVideoTracks.length; i++) {
                const track = nestedVideoTracks[i];
                if (!track) continue;
                const nestedLayer = (options?.layer ?? 0) + (nestedVideoTracks.length - 1 - i);

                const trackEffects = Array.isArray(track.effects)
                  ? cloneEffects(track.effects)
                  : [];
                const combinedTrackEffects =
                  combinedEffects.length > 0 ? [...combinedEffects, ...trackEffects] : trackEffects;

                const nestedWorkerClips = await toWorkerTimelineClips(track.items, projectStore, {
                  layer: nestedLayer,
                  trackKind: 'video',
                  visitedPaths: nextVisited,
                  parentOpacity: combinedOpacity,
                  parentEffects: combinedTrackEffects,
                });

                for (const nClip of nestedWorkerClips) {
                  const resolvedNClip: WorkerTimelineClip =
                    nClip.clipType === 'media' && nClip.source?.path
                      ? {
                          ...nClip,
                          source: {
                            path: resolveNestedMediaPath({
                              nestedTimelinePath: path,
                              mediaPath: nClip.source.path,
                            }),
                          },
                        }
                      : nClip;

                  const nStartUs = resolvedNClip.timelineRange.startUs;
                  const nEndUs = nStartUs + resolvedNClip.timelineRange.durationUs;

                  const windowStartUs = item.sourceRange.startUs;
                  const windowEndUs = windowStartUs + item.sourceRange.durationUs;

                  const overlapStartUs = Math.max(nStartUs, windowStartUs);
                  const overlapEndUs = Math.min(nEndUs, windowEndUs);

                  if (overlapStartUs < overlapEndUs) {
                    const visibleDurationUs = overlapEndUs - overlapStartUs;
                    const parentStartUs =
                      item.timelineRange.startUs + (overlapStartUs - windowStartUs);
                    const sourceShiftUs = overlapStartUs - nStartUs;

                    clips.push({
                      ...resolvedNClip,
                      id: `${item.id}_nested_${resolvedNClip.id}`,
                      layer: nestedLayer,
                      audioGain: mergeGain((item as any).audioGain, resolvedNClip.audioGain),
                      audioBalance: mergeBalance(
                        (item as any).audioBalance,
                        resolvedNClip.audioBalance,
                      ),
                      audioFadeInUs: mergeFadeInUs({
                        childFadeInUs: resolvedNClip.audioFadeInUs,
                        parentFadeInUs: (item as any).audioFadeInUs,
                        parentLocalStartUs: overlapStartUs - windowStartUs,
                      }),
                      audioFadeOutUs: mergeFadeOutUs({
                        childFadeOutUs: resolvedNClip.audioFadeOutUs,
                        parentFadeOutUs: (item as any).audioFadeOutUs,
                        parentLocalEndUs: overlapEndUs - windowStartUs,
                        parentDurationUs: Math.max(0, Math.round(item.timelineRange.durationUs)),
                      }),
                      timelineRange: {
                        startUs: parentStartUs,
                        durationUs: visibleDurationUs,
                      },
                      sourceRange: {
                        startUs: resolvedNClip.sourceRange.startUs + sourceShiftUs,
                        durationUs: visibleDurationUs,
                      },
                    });
                  }
                }
              }
            } else if (trackKind === 'audio') {
              const nestedAudioItems = buildEffectiveAudioClipItems({
                audioTracks: nestedDoc.tracks.filter((t) => t.kind === 'audio'),
                videoTracks: nestedDoc.tracks.filter((t) => t.kind === 'video'),
              });

              const nestedWorkerClips = await toWorkerTimelineClips(
                nestedAudioItems,
                projectStore,
                {
                  layer: 0,
                  trackKind: 'audio',
                  visitedPaths: nextVisited,
                  parentOpacity: combinedOpacity,
                  parentEffects: combinedEffects,
                },
              );

              for (const nClip of nestedWorkerClips) {
                const resolvedNClip: WorkerTimelineClip =
                  nClip.clipType === 'media' && nClip.source?.path
                    ? {
                        ...nClip,
                        source: {
                          path: resolveNestedMediaPath({
                            nestedTimelinePath: path,
                            mediaPath: nClip.source.path,
                          }),
                        },
                      }
                    : nClip;

                const nStartUs = resolvedNClip.timelineRange.startUs;
                const nEndUs = nStartUs + resolvedNClip.timelineRange.durationUs;

                const windowStartUs = item.sourceRange.startUs;
                const windowEndUs = windowStartUs + item.sourceRange.durationUs;

                const overlapStartUs = Math.max(nStartUs, windowStartUs);
                const overlapEndUs = Math.min(nEndUs, windowEndUs);

                if (overlapStartUs < overlapEndUs) {
                  const visibleDurationUs = overlapEndUs - overlapStartUs;
                  const parentStartUs =
                    item.timelineRange.startUs + (overlapStartUs - windowStartUs);
                  const sourceShiftUs = overlapStartUs - nStartUs;

                  const parentLocalStartUs = overlapStartUs - windowStartUs;
                  const parentLocalEndUs = overlapEndUs - windowStartUs;
                  const parentDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

                  clips.push({
                    ...resolvedNClip,
                    id: `${item.id}_nested_${resolvedNClip.id}`,
                    layer: 0,
                    audioGain: mergeGain((item as any).audioGain, resolvedNClip.audioGain),
                    audioBalance: mergeBalance(
                      (item as any).audioBalance,
                      resolvedNClip.audioBalance,
                    ),
                    audioFadeInUs: mergeFadeInUs({
                      childFadeInUs: resolvedNClip.audioFadeInUs,
                      parentFadeInUs: (item as any).audioFadeInUs,
                      parentLocalStartUs,
                    }),
                    audioFadeOutUs: mergeFadeOutUs({
                      childFadeOutUs: resolvedNClip.audioFadeOutUs,
                      parentFadeOutUs: (item as any).audioFadeOutUs,
                      parentLocalEndUs,
                      parentDurationUs,
                    }),
                    timelineRange: {
                      startUs: parentStartUs,
                      durationUs: visibleDurationUs,
                    },
                    sourceRange: {
                      startUs: resolvedNClip.sourceRange.startUs + sourceShiftUs,
                      durationUs: visibleDurationUs,
                    },
                  });
                }
              }
            }
            continue;
          }
        } catch (e) {
          console.error('Failed to expand nested timeline', e);
        }
      }

      clips.push({
        ...base,
        source: { path },
        freezeFrameSourceUs: item.freezeFrameSourceUs,
      });
    } else if (clipType === 'background') {
      clips.push({
        ...base,
        backgroundColor: String((item as any).backgroundColor ?? '#000000'),
      });
    } else if (clipType === 'text') {
      clips.push({
        ...base,
        text: String((item as any).text ?? ''),
        style: (item as any).style,
      });
    } else {
      clips.push(base);
    }
  }
  return clips;
}

export function getExt(fmt: 'mp4' | 'webm' | 'mkv'): 'mp4' | 'webm' | 'mkv' {
  if (fmt === 'webm') return 'webm';
  if (fmt === 'mkv') return 'mkv';
  return 'mp4';
}

export function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveExportCodecs(
  format: 'mp4' | 'webm' | 'mkv',
  selectedVideoCodec: string,
  selectedAudioCodec: 'aac' | 'opus',
) {
  if (format === 'webm') {
    return {
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus' as const,
    };
  }

  if (format === 'mkv') {
    return {
      videoCodec: 'av01.0.05M.08',
      audioCodec: 'opus' as const,
    };
  }

  return {
    videoCodec: selectedVideoCodec,
    audioCodec: selectedAudioCodec,
  };
}

export function useTimelineExport() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();

  let cachedExportDir: FileSystemDirectoryHandle | null = null;
  let cachedProjectName: string | null = null;
  let cachedProjectsHandle: FileSystemDirectoryHandle | null = null;
  let cachedExportFilenames: Set<string> | null = null;
  let inflightExportFilenames: Promise<Set<string>> | null = null;

  const isExporting = ref(false);
  const exportProgress = ref(0);
  const exportError = ref<string | null>(null);
  const exportPhase = ref<'encoding' | 'saving' | null>(null);
  const exportWarnings = ref<string[]>([]);

  const cancelRequested = ref(false);

  const outputFilename = ref('');
  const filenameError = ref<string | null>(null);

  const outputFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4');
  const videoCodec = ref('avc1.640032');
  const bitrateMbps = ref<number>(5);
  const excludeAudio = ref(false);
  const audioCodec = ref<'aac' | 'opus'>('aac');
  const audioBitrateKbps = ref<number>(128);
  const exportWidth = ref<number>(1920);
  const exportHeight = ref<number>(1080);
  const exportFps = ref<number>(30);
  const resolutionFormat = ref<string>('1080p');
  const orientation = ref<'landscape' | 'portrait'>('landscape');
  const aspectRatio = ref<string>('16:9');
  const isCustomResolution = ref<boolean>(false);

  const videoCodecSupport = ref<Record<string, boolean>>({});
  const isLoadingCodecSupport = ref(false);

  const ext = computed(() => getExt(outputFormat.value));

  const bitrateBps = computed(() => {
    const value = Number(bitrateMbps.value);
    if (!Number.isFinite(value)) return 5_000_000;
    const clamped = Math.min(200, Math.max(0.2, value));
    return Math.round(clamped * 1_000_000);
  });

  const normalizedExportWidth = computed(() => {
    const value = Number(exportWidth.value);
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.round(value);
  });

  const normalizedExportHeight = computed(() => {
    const value = Number(exportHeight.value);
    if (!Number.isFinite(value) || value <= 0) return 1080;
    return Math.round(value);
  });

  const normalizedExportFps = computed(() => {
    const value = Number(exportFps.value);
    if (!Number.isFinite(value) || value <= 0) return 30;
    return Math.round(Math.min(240, Math.max(1, value)));
  });

  function resetExportFsCache() {
    cachedExportDir = null;
    cachedProjectName = null;
    cachedProjectsHandle = null;
    cachedExportFilenames = null;
    inflightExportFilenames = null;
  }

  function isExportDirCacheValid() {
    return (
      cachedExportDir !== null &&
      cachedProjectsHandle === workspaceStore.projectsHandle &&
      cachedProjectName === projectStore.currentProjectName
    );
  }

  async function ensureExportDir(): Promise<FileSystemDirectoryHandle> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
      resetExportFsCache();
      throw new Error('Project is not opened');
    }

    if (isExportDirCacheValid() && cachedExportDir) {
      return cachedExportDir;
    }

    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
      projectStore.currentProjectName,
    );
    cachedExportDir = await projectDir.getDirectoryHandle('export', { create: true });
    cachedProjectName = projectStore.currentProjectName;
    cachedProjectsHandle = workspaceStore.projectsHandle;
    cachedExportFilenames = null;
    inflightExportFilenames = null;
    return cachedExportDir;
  }

  async function listExportFilenames(exportDir: FileSystemDirectoryHandle): Promise<Set<string>> {
    const names = new Set<string>();
    const iterator = (exportDir as any).values?.() ?? (exportDir as any).entries?.();
    if (!iterator) return names;

    for await (const value of iterator) {
      const handle = Array.isArray(value) ? value[1] : value;
      if (handle?.kind === 'file' && typeof handle?.name === 'string') {
        names.add(handle.name);
      }
    }
    return names;
  }

  async function loadExportFilenames(options?: { force?: boolean }): Promise<Set<string>> {
    if (options?.force) {
      cachedExportFilenames = null;
      inflightExportFilenames = null;
    }

    if (cachedExportFilenames) {
      return cachedExportFilenames;
    }

    if (inflightExportFilenames) {
      return inflightExportFilenames;
    }

    inflightExportFilenames = (async () => {
      const exportDir = await ensureExportDir();
      const names = await listExportFilenames(exportDir);
      cachedExportFilenames = names;
      inflightExportFilenames = null;
      return names;
    })();

    return inflightExportFilenames;
  }

  async function preloadExportIndex() {
    await loadExportFilenames({ force: true });
  }

  function rememberExportedFilename(filename: string) {
    if (!cachedExportFilenames) {
      cachedExportFilenames = new Set<string>();
    }
    cachedExportFilenames.add(filename);
  }

  async function getNextAvailableFilename(base: string, ext: string) {
    const names = await loadExportFilenames();
    let index = 1;
    while (index < 1000) {
      const candidate = `${base}_${String(index).padStart(3, '0')}.${ext}`;
      if (!names.has(candidate)) return candidate;
      index++;
    }
    throw new Error('Failed to generate a unique filename');
  }

  async function validateFilename() {
    const trimmed = outputFilename.value.trim();
    if (!trimmed) {
      filenameError.value = 'Filename is required';
      return false;
    }

    if (!trimmed.toLowerCase().endsWith(`.${ext.value}`)) {
      filenameError.value = `Filename must end with .${ext.value}`;
      return false;
    }

    const names = await loadExportFilenames();
    if (names.has(trimmed)) {
      filenameError.value = 'A file with this name already exists';
      return false;
    }

    filenameError.value = null;
    return true;
  }

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      const [videoSupport, audioSupport] = await Promise.all([
        checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS),
        (async () => {
          try {
            const { canEncodeAudio } = await import('mediabunny');
            const [aac, opus] = await Promise.all([
              canEncodeAudio('aac', {
                numberOfChannels: 2,
                sampleRate: 48000,
                bitrate: 128_000,
              }),
              canEncodeAudio('opus', {
                numberOfChannels: 2,
                sampleRate: 48000,
                bitrate: 128_000,
              }),
            ]);
            return { aac: !!aac, opus: !!opus } as const;
          } catch {
            const support = await checkAudioCodecSupport([
              { value: 'mp4a.40.2', label: 'AAC' },
              { value: 'opus', label: 'Opus' },
            ]);
            return {
              aac: support['mp4a.40.2'] !== false,
              opus: support['opus'] !== false,
            } as const;
          }
        })(),
      ]);

      videoCodecSupport.value = videoSupport;

      if (videoCodecSupport.value[videoCodec.value] === false) {
        const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find(
          (opt) => videoCodecSupport.value[opt.value],
        );
        if (firstSupported) videoCodec.value = firstSupported.value;
      }

      if (audioSupport.aac === false && audioSupport.opus !== false) {
        audioCodec.value = 'opus';
      } else {
        audioCodec.value = 'aac';
      }
    } finally {
      isLoadingCodecSupport.value = false;
    }
  }

  async function exportTimelineToFile(
    options: ExportOptions,
    fileHandle: FileSystemFileHandle,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    const doc = timelineStore.timelineDoc;
    const allVideoTracks = doc?.tracks?.filter((track) => track.kind === 'video') ?? [];
    const videoTracks = allVideoTracks.filter((track) => !track.videoHidden);
    const allAudioTracks = doc?.tracks?.filter((track) => track.kind === 'audio') ?? [];

    const videoClips: WorkerTimelineClip[] = [];
    for (let index = 0; index < videoTracks.length; index++) {
      const track = videoTracks[index];
      if (!track) continue;

      const trackEffects = track.effects ? JSON.parse(JSON.stringify(track.effects)) : [];
      const clips = await toWorkerTimelineClips(track.items ?? [], projectStore, {
        layer: videoTracks.length - 1 - index,
        trackKind: 'video',
        parentEffects: trackEffects,
      });

      videoClips.push(...clips);
    }

    const effectiveAudioItems = buildEffectiveAudioClipItems({
      audioTracks: allAudioTracks,
      videoTracks: allVideoTracks,
    });

    const audioClips = await toWorkerTimelineClips(effectiveAudioItems, projectStore, {
      trackKind: 'audio',
    });

    if (!videoClips.length && !audioClips.length) throw new Error('Timeline is empty');

    const { client } = getExportWorkerClient();

    setExportHostApi({
      getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
      onExportProgress: (progress) => onProgress(progress / 100),
      onExportPhase: (phase) => {
        exportPhase.value = phase;
      },
      onExportWarning: (message) => {
        exportWarnings.value.push(message);
      },
    });

    await (client as any).exportTimeline(fileHandle, options, videoClips, audioClips);
  }

  async function cancelExport() {
    if (!isExporting.value) return;
    if (cancelRequested.value) return;
    cancelRequested.value = true;

    try {
      const { client } = getExportWorkerClient();
      await client.cancelExport();
    } catch (e) {
      // Ignore and rely on fallback terminate
      console.warn('Failed to request cooperative export cancel', e);
    }

    // Fallback: if export is still running after a grace period, terminate the worker.
    setTimeout(() => {
      if (!isExporting.value) return;
      try {
        terminateExportWorker('Export cancelled by user');
        restartExportWorker();
      } catch (e) {
        console.error('Failed to cancel export worker', e);
      }
    }, 1500);
  }

  return {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    cancelRequested,
    outputFilename,
    filenameError,
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    videoCodecSupport,
    isLoadingCodecSupport,
    ext,
    bitrateBps,
    normalizedExportWidth,
    normalizedExportHeight,
    normalizedExportFps,
    ensureExportDir,
    preloadExportIndex,
    validateFilename,
    getNextAvailableFilename,
    rememberExportedFilename,
    loadCodecSupport,
    exportTimelineToFile,
    cancelExport,
  };
}
