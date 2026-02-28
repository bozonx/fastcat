import { VIDEO_DIR_NAME } from '~/utils/constants';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';

interface TimelineMediaMetadata {
  duration?: number;
  video?: unknown;
  audio?: unknown;
}

export interface TimelineCommandServiceDeps {
  getTimelineDoc: () => TimelineDocument | null;
  ensureTimelineDoc: () => TimelineDocument;
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
  getOrFetchMetadata: (
    handle: FileSystemFileHandle,
    path: string,
  ) => Promise<TimelineMediaMetadata | null>;
  getMediaMetadataByPath: (path: string) => TimelineMediaMetadata | null;
  fetchMediaMetadataByPath: (path: string) => Promise<TimelineMediaMetadata | null>;
  getUserSettings: () => { optimization: { autoCreateProxies: boolean } };
  hasProxy: (path: string) => boolean;
  generateProxy: (handle: FileSystemFileHandle, path: string) => Promise<void>;
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
    if (track.kind === 'audio' && isImageLike) {
      throw new Error('Images cannot be added to audio tracks');
    }
  }

  async function addClipToTimelineFromPath(input: AddClipToTimelineFromPathInput) {
    const handle = await deps.getFileHandleByPath(input.path);
    if (!handle) throw new Error('Failed to access file handle');

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    const metadata = await deps.getOrFetchMetadata(handle, input.path);
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
      !deps.hasProxy(input.path);

    if (shouldAutoCreateProxy) {
      void deps.generateProxy(handle, input.path);
    }

    deps.ensureTimelineDoc();

    deps.applyTimeline({
      type: 'add_clip_to_track',
      trackId: input.trackId,
      name: input.name,
      path: input.path,
      clipType: 'media',
      durationUs,
      sourceDurationUs,
      isImage: isImageLike,
      startUs: input.startUs,
    });
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

    if (item.clipType !== 'media') {
      throw new Error('Only media clips can be moved across tracks');
    }

    const path = item.source?.path;
    if (!path) throw new Error('Invalid source');

    const metadata = await resolveMetadataByPath(path);
    ensureTrackKindCompatibility(toTrack, metadata);

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

  async function addTimelineClipFromPath(input: AddTimelineClipFromPathInput) {
    const handle = await deps.getFileHandleByPath(input.path);
    if (!handle) throw new Error('Failed to access file handle');

    const track = deps.getTrackById(input.trackId);
    if (!track) throw new Error('Track not found');

    let durationUs = 2_000_000;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const nested = deps.parseTimelineFromOtio(text, { id: 'nested', name: input.name, fps: 25 });
      const nestedDurationUs = deps.selectTimelineDurationUs(nested);
      if (Number.isFinite(nestedDurationUs) && nestedDurationUs > 0) {
        durationUs = Math.max(1, Math.round(nestedDurationUs));
      }
    } catch {
      // keep fallback duration
    }

    deps.ensureTimelineDoc();

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    deps.applyTimeline({
      type: 'add_clip_to_track',
      trackId: targetTrack.id,
      name: input.name,
      path: input.path,
      clipType: 'timeline',
      durationUs,
      sourceDurationUs: durationUs,
      startUs: input.startUs,
    });
  }

  return {
    addClipToTimelineFromPath,
    moveItemToTrack,
    extractAudioToTrack,
    addTimelineClipFromPath,
  };
}
