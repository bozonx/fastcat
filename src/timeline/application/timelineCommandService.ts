import { createDevLogger } from '~/utils/dev-logger';
import { VIDEO_DIR_NAME } from '~/utils/constants';
import type { TimelineCommand } from '~/timeline/commands';
import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClipItem,
  AudioFadeCurve,
} from '~/timeline/types';
import type { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import type { selectTimelineDurationTicks } from '~/timeline/selectors';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { ensureProxyCommand } from '~/media-cache/application/proxyThumbnailCommands';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { secondsToTicksClamped } from '~/utils/time';
import type { TimelineFormatInput } from '~/timeline/format';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { isAudioUndecodable, isVideoUndecodable } from '~/utils/media/compatibility';
import { applyResolutionPreset } from '~/utils/settings/helpers';
import {
  normalizeProjectPath,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';
const log = createDevLogger('timelineCommandService');

export interface TimelineMediaMetadata {
  duration?: number;
  video?: {
    width: number;
    height: number;
    fps: number;
    rotation?: number;
    canDecode?: boolean;
    /** True when the source's per-frame timing is not constant (VFR): `fps` is
     * just the stream average. `undefined` when this could not be judged. */
    isVariableFrameRate?: boolean;
  };
  audio?: {
    sampleRate: number;
    canDecode?: boolean;
  };
  /** True when previous metadata extraction failed and we cached the failure state. */
  error?: boolean;
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
  ) => string[];
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  getOrFetchMetadataByPath: (path: string) => Promise<TimelineMediaMetadata | null>;
  getMediaMetadataByPath: (path: string) => TimelineMediaMetadata | null;
  fetchMediaMetadataByPath: (path: string) => Promise<TimelineMediaMetadata | null>;
  getUserSettings: () => {
    optimization: { autoCreateProxies: boolean };
    projectDefaults: { defaultAudioFadeCurve: AudioFadeCurve };
    ui?: {
      defaultAudioWaveformMode?: 'half' | 'full' | 'none';
    };
  };
  getProjectSettings: () => {
    project: {
      width: number;
      height: number;
      fps: number;
      sampleRate: number;
      isAutoSettings: boolean;
      geometryResolved: boolean;
      sampleRateResolved: boolean;
    };
  };
  updateTimelineFormat: (settings: TimelineFormatInput) => Promise<void>;
  /** Legacy project-format writer kept for older callers; clip auto-detection writes to timelines. */
  updateProjectFormat: (settings: {
    width?: number;
    height?: number;
    fps?: number;
    sampleRate?: number;
  }) => void;
  mediaCache: Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>;
  defaultImageDurationTicks: number;
  defaultImageSourceDurationTicks: number;
  parseTimelineFromOtio: typeof parseTimelineFromOtio;
  selectTimelineDurationTicks: typeof selectTimelineDurationTicks;
}

export interface AddClipWarning {
  type: 'autoSettingsApplied' | 'fpsMismatch' | 'clipTrimmed' | 'sourceIsVfr';
  width?: number;
  height?: number;
  fps?: number;
  fileFps?: number;
  projectFps?: number;
}

export interface AddClipResult {
  durationTicks: number;
  itemId?: string;
  warnings?: AddClipWarning[];
}

export interface AddClipToTimelineFromPathInput {
  trackId: string;
  name: string;
  path: string;
  startTicks?: number;
  pseudo?: boolean;
}

export interface MoveItemToTrackInput {
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startTicks: number;
}

export interface ExtractAudioToTrackInput {
  videoTrackId: string;
  videoItemId: string;
}

export interface AddTimelineClipFromPathInput {
  trackId: string;
  name: string;
  path: string;
  startTicks?: number;
  pseudo?: boolean;
}

function isOtioPath(path: string) {
  return path.trim().toLowerCase().endsWith('.otio');
}

function areFpsClose(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.01;
}

// True when one fps is a (near-)integer multiple of the other, so held-frame
// sampling onto the project's frame grid yields an EVEN cadence — each source
// frame is shown a whole number of times (upsampling, e.g. 30→60) or dropped at a
// fixed stride (downsampling, e.g. 60→30). Even cadences play back without the
// uneven 3:2-style stutter; only genuinely non-integer ratios (24→30, 50→60,
// 60→24) judder, so those are the only cases worth warning the user about.
// A relative tolerance keeps broadcast rates (23.976↔24, 59.94↔30) on the "even"
// side, matching how they're perceived.
function fpsCadenceIsEven(fileFps: number, projectFps: number): boolean {
  if (!Number.isFinite(fileFps) || !Number.isFinite(projectFps)) return false;
  if (fileFps <= 0 || projectFps <= 0) return false;
  const ratio = fileFps >= projectFps ? fileFps / projectFps : projectFps / fileFps;
  const nearest = Math.round(ratio);
  if (nearest < 1) return false;
  return Math.abs(ratio - nearest) <= 0.02 * nearest;
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

    if (track.kind === 'video' && isVideoUndecodable(metadata)) {
      throw new Error('Video codec is not supported for preview or export');
    }
    if (track.kind === 'audio' && isAudioUndecodable(metadata)) {
      throw new Error('Audio codec is not supported for preview or export');
    }
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
    }).items.some((item) => item.kind === 'clip');

    return {
      hasVideo,
      hasAudio,
    };
  }

  async function resolveNestedTimeline(path: string, name: string) {
    const resolvedPath = normalizeProjectPath(path);
    const file = await deps.getFileByPath(resolvedPath);
    if (!file) {
      throw new Error('Failed to access file');
    }
    const text = await file.text();
    const doc = deps.parseTimelineFromOtio(text, {
      id: 'nested',
      name,
      format: deps.getProjectSettings().project,
    });

    return {
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
    const resolvedPath = normalizeProjectPath(path);
    const resolvedTargetPath = normalizeProjectPath(targetPath);

    if (resolvedPath === resolvedTargetPath) return true;

    const cache = options?.cache ?? new Map<string, TimelineDocument>();
    const visiting = options?.visiting ?? new Set<string>();

    if (visiting.has(resolvedPath)) {
      return false;
    }

    visiting.add(resolvedPath);

    try {
      let doc = cache.get(resolvedPath);
      if (!doc) {
        const nested = await resolveNestedTimeline(
          resolvedPath,
          resolvedPath.split('/').pop() ?? 'nested',
        );
        doc = nested.doc;
        cache.set(resolvedPath, doc);
      }

      for (const track of doc.tracks) {
        for (const item of track.items) {
          if (item.kind !== 'clip' || item.clipType !== 'timeline') continue;

          const nestedPath = item.source?.path;
          if (!nestedPath) continue;
          const resolvedNestedPath = resolveNestedMediaPath({
            nestedTimelinePath: resolvedPath,
            mediaPath: nestedPath,
          });
          if (resolvedNestedPath === resolvedTargetPath) return true;

          const hasCycle = await nestedTimelineReferencesPath(
            resolvedNestedPath,
            resolvedTargetPath,
            {
              cache,
              visiting,
            },
          );
          if (hasCycle) return true;
        }
      }

      return false;
    } finally {
      visiting.delete(resolvedPath);
    }
  }

  async function ensureNoNestedTimelineCycle(path: string) {
    const currentTimelinePath = deps.getCurrentTimelinePath();
    if (!currentTimelinePath) return;

    const resolvedPath = normalizeProjectPath(path);
    const resolvedCurrentTimelinePath = normalizeProjectPath(currentTimelinePath);

    if (resolvedPath === resolvedCurrentTimelinePath) {
      throw new Error('Cannot insert the currently opened timeline into itself');
    }

    const hasCycle = await nestedTimelineReferencesPath(resolvedPath, resolvedCurrentTimelinePath);
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
      labelKey?: string;
    },
  ): Promise<AddClipResult> {
    if (isOtioPath(input.path)) {
      return await addTimelineClipFromPath(input, options);
    }

    const file = await deps.getFileByPath(input.path);
    if (!file) throw new Error('Failed to access source file');

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    const metadata = await deps.getOrFetchMetadataByPath(input.path);
    // For images (by extension) we allow a fallback: if the worker failed to parse
    // metadata (e.g. PNG with alpha / non-standard format) — we still insert it
    // as a static image-clip with the default duration instead of failing the whole drop.
    const isImageExt = getMediaTypeFromFilename(input.name || input.path) === 'image';
    if ((!metadata || metadata.error) && !isImageExt) {
      throw new Error('Failed to resolve media metadata');
    }

    if (metadata && !metadata.error) {
      ensureTrackKindCompatibility(targetTrack, metadata);
    }

    const hasVideo = Boolean(metadata?.video);
    const hasAudio = Boolean(metadata?.audio);
    const isImageLike = isImageExt || (!hasVideo && !hasAudio);

    const durationTicks = isImageLike
      ? deps.defaultImageDurationTicks
      : Math.max(1, secondsToTicksClamped(Number(metadata?.duration)));
    const sourceDurationTicks = isImageLike ? deps.defaultImageSourceDurationTicks : durationTicks;

    if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
      throw new Error('Failed to resolve media duration');
    }

    const startTicks = input.startTicks ?? 0;
    let finalDurationTicks = durationTicks;
    const warnings: AddClipWarning[] = [];

    if (!input.pseudo) {
      // Check if startTicks falls inside any existing clip on this track
      const overlappingClip = targetTrack.items.find((it) => {
        if (it.kind !== 'clip') return false;
        const clipStart = it.timelineRange.startTicks;
        const clipEnd = clipStart + it.timelineRange.durationTicks;
        return startTicks >= clipStart && startTicks < clipEnd;
      });

      if (overlappingClip) {
        throw new Error('cannot_insert_on_clip');
      }

      // Find the next clip that starts after startTicks on this track
      const nextClip = targetTrack.items
        .filter((it) => it.kind === 'clip' && it.timelineRange.startTicks > startTicks)
        .sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks)[0];

      if (nextClip) {
        const maxAvailableDurationTicks = nextClip.timelineRange.startTicks - startTicks;
        if (maxAvailableDurationTicks <= 0) {
          throw new Error('cannot_insert_on_clip');
        }
        if (durationTicks > maxAvailableDurationTicks) {
          finalDurationTicks = maxAvailableDurationTicks;
          warnings.push({ type: 'clipTrimmed' });
        }
      }
    }

    const shouldAutoCreateProxy =
      deps.getUserSettings().optimization.autoCreateProxies &&
      hasVideo &&
      input.path.startsWith(`${VIDEO_DIR_NAME}/`) &&
      !deps.mediaCache.hasProxy(input.path);

    if (shouldAutoCreateProxy) {
      // Fire-and-forget: proxy creation is a background optimization. Failures must
      // not break the import flow — surface them as console warnings only.
      ensureProxyCommand({
        service: deps.mediaCache,
        file,
        projectRelativePath: input.path,
      }).catch((err) => {
        log.warn('[timeline] Auto proxy creation failed', err);
      });
    }

    if (!input.pseudo && metadata && (metadata.video || metadata.audio)) {
      const doc = deps.getTimelineDoc();
      const timelineFormat = getTimelineFormat(doc);
      const project = deps.getProjectSettings().project;

      let appliedWidth = 0;
      let appliedHeight = 0;
      let appliedFps = 0;
      let geometryApplied = false;

      // Auto-detection is timeline-local: project settings are only defaults for
      // new timelines. Geometry and sample rate resolve independently, so an
      // audio-only first clip can set sampleRate while geometry waits for video.
      if (timelineFormat.isAutoSettings) {
        const patch: TimelineFormatInput = {
          ...timelineFormat,
          useProjectSettings: false,
          settingsSource: 'firstClip',
        };
        let shouldUpdateTimelineFormat = false;

        if (metadata.video && !timelineFormat.geometryResolved) {
          const rotation = metadata.video.rotation ?? 0;
          const isRotated90 = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
          appliedWidth = isRotated90 ? metadata.video.height : metadata.video.width;
          appliedHeight = isRotated90 ? metadata.video.width : metadata.video.height;
          appliedFps = metadata.video.fps;
          Object.assign(
            patch,
            applyResolutionPreset({
              width: appliedWidth,
              height: appliedHeight,
              fps: appliedFps,
            }),
          );
          patch.geometryResolved = true;
          geometryApplied = true;
          shouldUpdateTimelineFormat = true;
        }

        if (metadata.audio && !timelineFormat.sampleRateResolved) {
          patch.sampleRate = metadata.audio.sampleRate;
          patch.sampleRateResolved = true;
          shouldUpdateTimelineFormat = true;
        }

        if (shouldUpdateTimelineFormat) {
          await deps.updateTimelineFormat(patch);
        }
      }

      if (geometryApplied) {
        // Surface the auto-applied resolution/fps only when geometry was actually
        // derived from this clip's video stream.
        warnings.push({
          type: 'autoSettingsApplied',
          width: appliedWidth,
          height: appliedHeight,
          fps: appliedFps,
        });
      } else if (metadata.video) {
        // Geometry was already settled (manual project, already-resolved auto, or
        // an independent timeline). Compare against the *effective* fps (project
        // settings win when followed), not the doc's stale snapshot, so the
        // mismatch warning reflects reality.
        const effectiveFps = resolveEffectiveTimelineFormat(timelineFormat, project).fps;
        // Only warn for uneven cadences that actually judder. An integer-ratio
        // mismatch (e.g. 60→30 or 30→60) samples evenly and plays back smoothly, so
        // warning there is a false alarm.
        if (
          !areFpsClose(metadata.video.fps, effectiveFps) &&
          !fpsCadenceIsEven(metadata.video.fps, effectiveFps)
        ) {
          warnings.push({
            type: 'fpsMismatch',
            fileFps: metadata.video.fps,
            projectFps: effectiveFps,
          });
        }
      }

      // Independent of whether this clip set/matched the project fps: a VFR
      // source's `fps` is just the stream average, not a real per-frame rate, so
      // whatever timebase choice was made for it (auto or manual) is a heuristic.
      // Surface that once per add so the user can knowingly pick a rate rather
      // than assume the number they see is exact.
      if (metadata.video?.isVariableFrameRate) {
        warnings.push({
          type: 'sourceIsVfr',
          fileFps: metadata.video.fps,
        });
      }
    }

    deps.ensureTimelineDoc();

    const userSettings = deps.getUserSettings();
    const defaultWaveformMode = userSettings.ui?.defaultAudioWaveformMode ?? 'half';
    const showWaveform = defaultWaveformMode !== 'none';
    const audioWaveformMode = defaultWaveformMode === 'full' ? 'full' : 'half';

    const res = deps.applyTimeline(
      {
        type: 'add_clip_to_track',
        trackId: input.trackId,
        name: input.name,
        path: input.path,
        durationTicks: finalDurationTicks,
        sourceDurationTicks,
        sourceRange: { startTicks: 0, durationTicks: finalDurationTicks },
        isImage: isImageLike,
        startTicks,
        pseudo: input.pseudo,
        audioFadeInCurve: userSettings.projectDefaults.defaultAudioFadeCurve,
        audioFadeOutCurve: userSettings.projectDefaults.defaultAudioFadeCurve,
        showWaveform,
        audioWaveformMode,
      },
      options,
    );

    return {
      durationTicks: finalDurationTicks,
      itemId: res[0],
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async function moveItemToTrack(input: MoveItemToTrackInput) {
    const doc = deps.getTimelineDoc();
    if (!doc) throw new Error('Timeline not loaded');

    const fromTrack = deps.getTrackById(input.fromTrackId);
    const toTrack = deps.getTrackById(input.toTrackId);
    if (!fromTrack || !toTrack) throw new Error('Track not found');

    const item = fromTrack.items.find((it) => it.id === input.itemId) as
      TimelineClipItem | undefined;
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

    // Re-read the document after any await so we apply against the latest state.
    const freshDoc = deps.getTimelineDoc();
    if (!freshDoc) throw new Error('Timeline not loaded');
    const freshFromTrack = deps.getTrackById(input.fromTrackId);
    const freshToTrack = deps.getTrackById(input.toTrackId);
    if (!freshFromTrack || !freshToTrack) throw new Error('Track not found');
    const freshItem = freshFromTrack.items.find((it) => it.id === input.itemId);
    if (!freshItem || freshItem.kind !== 'clip') throw new Error('Item no longer exists');

    deps.applyTimeline({
      type: 'move_item_to_track',
      fromTrackId: input.fromTrackId,
      toTrackId: input.toTrackId,
      itemId: input.itemId,
      startTicks: input.startTicks,
    });
  }

  async function extractAudioToTrack(input: ExtractAudioToTrackInput) {
    const doc = deps.getTimelineDoc();
    if (!doc) throw new Error('Timeline not loaded');

    const videoTrack = deps.getTrackById(input.videoTrackId);
    if (!videoTrack || videoTrack.kind !== 'video') throw new Error('Invalid video track');

    const videoItem = videoTrack.items.find((it) => it.id === input.videoItemId) as
      TimelineClipItem | undefined;
    if (!videoItem || videoItem.kind !== 'clip') throw new Error('Clip not found');

    if (videoItem.clipType !== 'media') {
      throw new Error('Only media clips can extract audio');
    }

    const path = videoItem.source?.path;
    if (!path) throw new Error('Invalid source');

    const metadata = await resolveMetadataByPath(path);
    if (!metadata.audio) throw new Error('Source has no audio');

    return deps.applyTimeline({
      type: 'extract_audio_to_track',
      videoTrackId: videoTrack.id,
      videoItemId: videoItem.id,
    });
  }

  async function addTimelineClipFromPath(
    input: AddTimelineClipFromPathInput,
    options?: {
      historyMode?: 'debounced' | 'immediate';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ): Promise<AddClipResult> {
    const track = deps.getTrackById(input.trackId);
    if (!track) throw new Error('Track not found');

    await ensureNoNestedTimelineCycle(input.path);

    const nested = await resolveNestedTimeline(input.path, input.name);
    ensureNestedTimelineTrackCompatibility(track, nested.summary);

    let durationTicks = secondsToTicksClamped(2);
    try {
      const nestedDurationTicks = deps.selectTimelineDurationTicks(nested.doc);
      if (Number.isFinite(nestedDurationTicks) && nestedDurationTicks > 0) {
        durationTicks = Math.max(1, Math.round(nestedDurationTicks));
      }
    } catch {
      // keep fallback duration
    }

    deps.ensureTimelineDoc();

    const targetTrack = deps.getTrackById(input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    const userSettings = deps.getUserSettings();
    const defaultWaveformMode = userSettings.ui?.defaultAudioWaveformMode ?? 'half';
    const showWaveform = defaultWaveformMode !== 'none';
    const audioWaveformMode = defaultWaveformMode === 'full' ? 'full' : 'half';

    const res = deps.applyTimeline(
      {
        type: 'add_clip_to_track',
        trackId: targetTrack.id,
        name: input.name,
        path: input.path,
        startTicks: input.startTicks ?? 0,
        durationTicks,
        pseudo: input.pseudo,
        audioFadeInCurve: userSettings.projectDefaults.defaultAudioFadeCurve,
        audioFadeOutCurve: userSettings.projectDefaults.defaultAudioFadeCurve,
        showWaveform,
        audioWaveformMode,
      },
      options,
    );

    return { durationTicks, itemId: res[0] };
  }

  return {
    addClipToTimelineFromPath,
    moveItemToTrack,
    extractAudioToTrack,
    addTimelineClipFromPath,
    ensureNoNestedTimelineCycle,
    ensureTimelineDoc: () => deps.ensureTimelineDoc(),
  };
}
