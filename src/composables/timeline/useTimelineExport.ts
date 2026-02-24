import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  getExportWorkerClient,
  setExportHostApi,
  terminateExportWorker,
  restartExportWorker,
} from '~/utils/video-editor/worker-client';
import type { TimelineTrackItem } from '~/timeline/types';
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
  clipType: 'media' | 'adjustment' | 'background';
  id: string;
  layer: number;
  source?: { path: string };
  backgroundColor?: string;
  opacity?: number;
  effects?: unknown[];
  timelineRange: { startUs: number; durationUs: number };
  sourceRange: { startUs: number; durationUs: number };
}

export function toWorkerTimelineClips(
  items: TimelineTrackItem[],
  options?: { layer?: number },
): WorkerTimelineClip[] {
  const clips: WorkerTimelineClip[] = [];
  for (const item of items) {
    if (item.kind !== 'clip') continue;
    const base: WorkerTimelineClip = {
      kind: 'clip',
      clipType: item.clipType,
      id: item.id,
      layer: options?.layer ?? 0,
      opacity: item.opacity,
      effects: item.effects ? JSON.parse(JSON.stringify(item.effects)) : undefined,
      timelineRange: {
        startUs: item.timelineRange.startUs,
        durationUs: item.timelineRange.durationUs,
      },
      sourceRange: {
        startUs: item.sourceRange.startUs,
        durationUs: item.sourceRange.durationUs,
      },
    };

    if (item.clipType === 'media') {
      clips.push({
        ...base,
        source: { path: item.source.path },
      });
    } else if (item.clipType === 'background') {
      clips.push({
        ...base,
        backgroundColor: item.backgroundColor,
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

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const audioTracks = hasSolo
      ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
      : allAudioTracks.filter((t) => !t.audioMuted);

    const videoTracksForAudio = hasSolo
      ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
      : allVideoTracks.filter((t) => !t.audioMuted);

    const videoClips = videoTracks.flatMap((track, index) => {
      const clips = toWorkerTimelineClips(track.items ?? [], {
        layer: videoTracks.length - 1 - index,
      });
      if (!track.effects?.length) return clips;

      const trackEffects = JSON.parse(JSON.stringify(track.effects)) as any[];
      return clips.map((clip) => ({
        ...clip,
        effects: clip.effects ? [...(clip.effects as any[]), ...trackEffects] : trackEffects,
      }));
    });
    const audioItems = audioTracks.flatMap((t) => t.items);
    const audioClipsFromTracks = toWorkerTimelineClips(audioItems);

    const audioClipsFromVideo = videoTracksForAudio.flatMap((track) =>
      (track.items ?? [])
        .filter(
          (item): item is Extract<typeof item, { kind: 'clip'; clipType: 'media' }> =>
            item.kind === 'clip' && item.clipType === 'media' && !item.audioFromVideoDisabled,
        )
        .map((item) => ({
          kind: 'clip' as const,
          clipType: 'media' as const,
          id: `${item.id}__audio`,
          layer: 0,
          source: { path: item.source.path },
          timelineRange: {
            startUs: item.timelineRange.startUs,
            durationUs: item.timelineRange.durationUs,
          },
          sourceRange: {
            startUs: item.sourceRange.startUs,
            durationUs: item.sourceRange.durationUs,
          },
        })),
    );

    const audioClips = [...audioClipsFromTracks, ...audioClipsFromVideo];

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
