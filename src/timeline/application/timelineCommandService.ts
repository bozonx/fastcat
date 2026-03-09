import { VIDEO_DIR_NAME } from '~/utils/constants';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { ensureProxyCommand } from '~/media-cache/application/proxyThumbnailCommands';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';

interface TimelineMediaMetadata {
  duration?: number;
  video?: unknown;
  audio?: unknown;
}

export interface TimelineCommandServiceDeps {
  getTimelineDoc: () => TimelineDocument | null;
  ensureTimelineDoc: () => TimelineDocument;
  getCurrentTimelinePath: () => string | null;
  getTrackById: (trackId: string) => TimelineTrack | null;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
    },
  ) => void;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getOrFetchMetadataByPath: (path: string) => Promise<TimelineMediaMetadata | null>;
  getMediaMetadataByPath: (path: string) => TimelineMediaMetadata | null;
  fetchMediaMetadataByPath: (path: string) => Promise<TimelineMediaMetadata | null>;
  getUserSettings: () => { optimization: { autoCreateProxies: boolean } };
  mediaCache: Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>;
  defaultImageDurationUs: number;
  defaultImageSourceDurationUs: number;
  parseTimelineFromOtio: typeof import('~/timeline/otioSerializer').parseTimelineFromOtio;
  selectTimelineDurationUs: typeof import('~/timeline/selectors').selectTimelineDurationUs;
}

export interface AddClipToTimelineFromPathInput {
  trackId: string;
  name: string;
  path: string;
  startUs?: number;
}

export interface MoveItemToTrackInput {
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startUs: number;
}

export interface ExtractAudioToTrackInput {
  videoTrackId: string;
  videoItemId: string;
}

export interface AddTimelineClipFromPathInput {
  trackId: string;
  name: string;
  path: string;
  startUs?: number;
}

function isOtioPath(path: string) {
  return path.trim().toLowerCase().endsWith('.otio');
}

export function createTimelineCommandService(deps: TimelineCommandServiceDeps) {
  async function resolveMetadataByPath(path: string): Promise<TimelineMediaMetadata> {
    const existing = deps.getMediaMetadataByPath(path);
    if (existing) return existing;

    const fetched = await deps.fetchMediaMetadataByPath(path);
    if (!fetched) {
      throw new Error('Failed to resolve media metadata');
    }
    return fetched;
  }

  function ensureTrackKindCompatibility(track: TimelineTrack, metadata: TimelineMediaMetadata) {
    const hasVideo = Boolean(metadata.video);
    const hasAudio = Boolean(metadata.audio);
    const isImageLike = !hasVideo && !hasAudio;

    if (track.kind === 'video' && !hasVideo && !isImageLike) {
      throw new Error('Only video sources can be added to video tracks');
    }
    if (track.kind === 'audio') {
      if (isImageLike) {
        throw new Error('Images cannot be added to audio tracks');
      }
      if (hasVideo && !hasAudio) {
        throw new Error('Video without audio cannot be added to audio tracks');
      }
    }
  }

  function summarizeNestedTimeline(doc: TimelineDocument) {
    const hasVideo = doc.tracks.some(
      (track) =>
        track.kind === 'video' &&
        !track.videoHidden &&
        track.items.some((item) => item.kind === 'clip' && !(item as TimelineClipItem).disabled),
    );
    const hasAudio = buildEffectiveAudioClipItems({
      audioTracks: doc.tracks.filter((track) => track.kind === 'audio'),
      videoTracks: doc.tracks.filter((track) => track.kind === 'video'),
    }).some((item) => item.kind === 'clip');

    return {
      hasVideo,
      hasAudio,
    };
  }

  async function resolveNestedTimeline(path: string, name: string) {
    const handle = await deps.getFileHandleByPath(path);
    if (!handle) throw new Error('Failed to access file handle');

    const file = await handle.getFile();
    const text = await file.text();
    const doc = deps.parseTimelineFromOtio(text, { id: 'nested', name, fps: 25 });

    return {
      handle,
      doc,
      summary: summarizeNestedTimeline(doc),
    };
  }

  async function nestedTimelineReferencesPath(
    path: string,
    targetPath: string,
    options?: {
      cache?: Map<string, TimelineDocument>;
      visiting?: Set<string>;
    },
  ): Promise<boolean> {
    if (path === targetPath) return true;

    const cache = options?.cache ?? new Map<string, TimelineDocument>();
    const visiting = options?.visiting ?? new Set<string>();

    if (visiting.has(path)) {
      return false;
    }

    visiting.add(path);

    try {
      let doc = cache.get(path);
      if (!doc) {
        const nested = await resolveNestedTimeline(path, path.split('/').pop() ?? 'nested');
        doc = nested.doc;
        cache.set(path, doc);
      }

      for (const track of doc.tracks) {
        for (const item of track.items) {
          if (item.kind !== 'clip' || item.clipType !== 'timeline') continue;

          const nestedPath = item.source?.path;
          if (!nestedPath) continue;
          if (nestedPath === targetPath) return true;

          const hasCycle = await nestedTimelineReferencesPath(nestedPath, targetPath, {
            cache,
            visiting,
          });
          if (hasCycle) return true;
        }
      }

      return false;
    } finally {
      visiting.delete(path);
    }
  }

  async function ensureNoNestedTimelineCycle(path: string) {
    const currentTimelinePath = deps.getCurrentTimelinePath();
    if (!currentTimelinePath) return;

    if (path === currentTimelinePath) {
      throw new Error('Cannot insert the currently opened timeline into itself');
    }

    const hasCycle = await nestedTimelineReferencesPath(path, currentTimelinePath);
    if (hasCycle) {
      throw new Error('Cannot create circular nested timeline dependency');
    }
  }

  function ensureNestedTimelineTrackCompatibility(
    track: TimelineTrack,
    summary: { hasVideo: boolean; hasAudio: boolean },
  ) {
    if (track.kind === 'video' && !summary.hasVideo) {
      throw new Error('Only nested timelines with video content can be added to video tracks');
    }
    if (track.kind === 'audio' && !summary.hasAudio) {
      throw new Error('Only nested timelines with audio content can be added to audio tracks');
    }
  }

  async function addClipToTimelineFromPath(
    input: AddClipToTimelineFromPathInput,
    options?: {
      historyMode?: 'debounced' | 'immediate';
      historyDebounceMs?: number;
      label?: string;
    },
  ) {
    if (isOtioPath(input.path)) {
      return await addTimelineClipFromPath(input, options);
    }

    const handle = await deps.getFileHandleByPath(input.path);
    if (!handle) throw new Error('Failed to access file handle');

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    const metadata = await deps.getOrFetchMetadataByPath(input.path);
    if (!metadata) throw new Error('Failed to resolve media metadata');

    ensureTrackKindCompatibility(targetTrack, metadata);

    const hasVideo = Boolean(metadata.video);
    const hasAudio = Boolean(metadata.audio);
    const isImageLike = !hasVideo && !hasAudio;

    const durationUs = isImageLike
      ? deps.defaultImageDurationUs
      : Math.floor(Number(metadata.duration) * 1_000_000);
    const sourceDurationUs = isImageLike ? deps.defaultImageSourceDurationUs : durationUs;

    if (!Number.isFinite(durationUs) || durationUs <= 0) {
      throw new Error('Failed to resolve media duration');
    }

    const shouldAutoCreateProxy =
      deps.getUserSettings().optimization.autoCreateProxies &&
      hasVideo &&
      input.path.startsWith(`${VIDEO_DIR_NAME}/`) &&
      !deps.mediaCache.hasProxy(input.path);

    if (shouldAutoCreateProxy) {
      void ensureProxyCommand({
        service: deps.mediaCache,
        fileHandle: handle,
        projectRelativePath: input.path,
      });
    }

    deps.ensureTimelineDoc();

    deps.applyTimeline(
      {
        type: 'add_clip_to_track',
        trackId: input.trackId,
        name: input.name,
        path: input.path,
        clipType: 'media',
        durationUs,
        sourceDurationUs,
        isImage: isImageLike,
        startUs: input.startUs,
      },
      options,
    );

    return { durationUs };
  }

  async function moveItemToTrack(input: MoveItemToTrackInput) {
    const doc = deps.getTimelineDoc();
    if (!doc) throw new Error('Timeline not loaded');

    const fromTrack = deps.getTrackById(input.fromTrackId);
    const toTrack = deps.getTrackById(input.toTrackId);
    if (!fromTrack || !toTrack) throw new Error('Track not found');

    const item = fromTrack.items.find((it) => it.id === input.itemId) as
      | TimelineClipItem
      | undefined;
    if (!item || item.kind !== 'clip') throw new Error('Item not found');

    const path = item.source?.path;
    if (!path) throw new Error('Invalid source');

    if (item.clipType === 'media') {
      const metadata = await resolveMetadataByPath(path);
      ensureTrackKindCompatibility(toTrack, metadata);
    } else if (item.clipType === 'timeline') {
      const nested = await resolveNestedTimeline(path, item.name);
      ensureNestedTimelineTrackCompatibility(toTrack, nested.summary);
    } else {
      throw new Error('Only media and nested timeline clips can be moved across tracks');
    }

    deps.applyTimeline({
      type: 'move_item_to_track',
      fromTrackId: input.fromTrackId,
      toTrackId: input.toTrackId,
      itemId: input.itemId,
      startUs: input.startUs,
    });
  }

  async function extractAudioToTrack(input: ExtractAudioToTrackInput) {
    const doc = deps.getTimelineDoc();
    if (!doc) throw new Error('Timeline not loaded');

    const videoTrack = deps.getTrackById(input.videoTrackId);
    if (!videoTrack || videoTrack.kind !== 'video') throw new Error('Invalid video track');

    const videoItem = videoTrack.items.find((it) => it.id === input.videoItemId) as
      | TimelineClipItem
      | undefined;
    if (!videoItem || videoItem.kind !== 'clip') throw new Error('Clip not found');

    if (videoItem.clipType !== 'media') {
      throw new Error('Only media clips can extract audio');
    }

    const path = videoItem.source?.path;
    if (!path) throw new Error('Invalid source');

    const metadata = await resolveMetadataByPath(path);
    if (!metadata.audio) throw new Error('Source has no audio');

    const audioTracks = doc.tracks.filter((t) => t.kind === 'audio');
    if (audioTracks.length === 0) throw new Error('No audio tracks');

    const targetAudioTrackId = audioTracks[0]!.id;

    deps.applyTimeline({
      type: 'extract_audio_to_track',
      videoTrackId: videoTrack.id,
      videoItemId: videoItem.id,
      audioTrackId: targetAudioTrackId,
    });
  }

  async function addTimelineClipFromPath(
    input: AddTimelineClipFromPathInput,
    options?: {
      historyMode?: 'debounced' | 'immediate';
      historyDebounceMs?: number;
      label?: string;
    },
  ) {
    const track = deps.getTrackById(input.trackId);
    if (!track) throw new Error('Track not found');

    await ensureNoNestedTimelineCycle(input.path);

    const nested = await resolveNestedTimeline(input.path, input.name);
    ensureNestedTimelineTrackCompatibility(track, nested.summary);

    let durationUs = 2_000_000;
    try {
      const nestedDurationUs = deps.selectTimelineDurationUs(nested.doc);
      if (Number.isFinite(nestedDurationUs) && nestedDurationUs > 0) {
        durationUs = Math.max(1, Math.round(nestedDurationUs));
      }
    } catch {
      // keep fallback duration
    }

    deps.ensureTimelineDoc();

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    deps.applyTimeline(
      {
        type: 'add_clip_to_track',
        trackId: targetTrack.id,
        name: input.name,
        path: input.path,
        clipType: 'timeline',
        durationUs,
        sourceDurationUs: durationUs,
        startUs: input.startUs,
      },
      options,
    );

    return { durationUs };
  }

  return {
    addClipToTimelineFromPath,
    moveItemToTrack,
    extractAudioToTrack,
    addTimelineClipFromPath,
  };
}
