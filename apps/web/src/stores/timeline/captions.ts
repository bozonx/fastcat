import type { Ref } from 'vue';
import type { TimelineDocument, TimelineTrackItem, TimelineMediaClipItem } from '~/timeline/types';
import type { MediaMetadata } from '~/stores/media.store';
import type { TimelineCommand } from '~/timeline/commands';
import {
  createDefaultCaptionStylePreset,
  buildCaptionChunksFromWords,
  extractTranscriptionWords,
  type CaptionGenerationSettings,
  type TimelineCaptionWord,
} from '~/utils/transcription/captions';
import type { TranscriptionRecord } from '~/utils/transcription/types';
import { loadTranscriptionSidecar } from '~/utils/transcription/persistence';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { TICKS_PER_MILLISECOND } from '~/utils/time';
import { quantizeTicksToFrames, sanitizeFps } from '~/timeline/commands/utils';

export interface TimelineCaptionsDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  mediaMetadata: Ref<Record<string, MediaMetadata>>;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      labelKey?: string;
    },
  ) => string[];
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getProjectId: () => string | null;
  getCurrentProjectName: () => string | null;
}

export interface TimelineCaptionsModule {
  generateCaptionsFromTimeline: (options: {
    trackId: string;
    settings: CaptionGenerationSettings;
  }) => Promise<{ addedCount: number; sourceCount: number }>;
}

export function createTimelineCaptionsModule(params: TimelineCaptionsDeps): TimelineCaptionsModule {
  const {
    timelineDoc,
    mediaMetadata,
    batchApplyTimeline,
    requestTimelineSave,
    getWorkspaceHandle,
    getCurrentProjectName,
  } = params;

  function isTrackActiveForCaptions(track: TimelineDocument['tracks'][number]): boolean {
    if (track.kind === 'video' && track.videoHidden) return false;
    if (track.audioMuted) return false;
    return true;
  }

  function isClipActiveForCaptions(
    item: TimelineDocument['tracks'][number]['items'][number],
  ): boolean {
    if (item.kind !== 'clip') return false;
    if (item.clipType !== 'media') return false;
    if (item.disabled || item.audioMuted) return false;
    if (!item.source?.path) return false;
    return true;
  }

  function asActiveCaptionMediaClip(item: TimelineTrackItem): TimelineMediaClipItem | null {
    if (!isClipActiveForCaptions(item)) return null;
    return item as TimelineMediaClipItem;
  }

  function findMatchingTranscriptionRecord(options: {
    records: TranscriptionRecord[];
    sourcePath: string;
    language?: string;
  }): TranscriptionRecord | null {
    const meta = mediaMetadata.value[options.sourcePath] ?? null;

    return (
      options.records.find((record) => {
        if (record.sourcePath !== options.sourcePath) return false;

        // If we have metadata, verify size and last modified to avoid stale cache
        if (meta) {
          if (record.sourceSize !== meta.source.size) return false;
          if (record.sourceLastModified !== meta.source.lastModified) return false;
        }

        // If language is requested, it must match (case-insensitive)
        if (options.language && options.language.trim()) {
          if (record.language.toLowerCase() !== options.language.trim().toLowerCase()) {
            return false;
          }
        }

        return true;
      }) ?? null
    );
  }

  function projectClipWordsToTimeline(options: {
    trackId: string;
    trackOrder: number;
    clipId: string;
    sourceName: string;
    sourcePath: string;
    sourceStartTicks: number;
    sourceEndTicks: number;
    timelineStartTicks: number;
    speed: number;
    words: ReturnType<typeof extractTranscriptionWords>;
  }): TimelineCaptionWord[] {
    const result: TimelineCaptionWord[] = [];

    for (const word of options.words) {
      const wordStartTicks = Math.round(word.start * TICKS_PER_MILLISECOND);
      const wordEndTicks = Math.round(word.end * TICKS_PER_MILLISECOND);
      if (wordEndTicks <= options.sourceStartTicks || wordStartTicks >= options.sourceEndTicks)
        continue;

      const clippedStartTicks = Math.max(wordStartTicks, options.sourceStartTicks);
      const clippedEndTicks = Math.min(wordEndTicks, options.sourceEndTicks);
      if (clippedEndTicks <= clippedStartTicks) continue;

      const relativeStartTicks = clippedStartTicks - options.sourceStartTicks;
      const relativeEndTicks = clippedEndTicks - options.sourceStartTicks;
      const timelineStartTicks =
        options.timelineStartTicks + Math.round(relativeStartTicks / options.speed);
      const timelineEndTicks =
        options.timelineStartTicks + Math.round(relativeEndTicks / options.speed);
      if (timelineEndTicks <= timelineStartTicks) continue;

      result.push({
        start: word.start,
        end: word.end,
        text: word.text,
        confidence: word.confidence,
        timelineStartMs: Math.round(timelineStartTicks / TICKS_PER_MILLISECOND),
        timelineEndMs: Math.round(timelineEndTicks / TICKS_PER_MILLISECOND),
        sourcePath: options.sourcePath,
        sourceName: options.sourceName,
        trackId: options.trackId,
        clipId: options.clipId,
        trackOrder: options.trackOrder,
      });
    }

    return result;
  }

  function trimWordsByCoveredRanges(options: {
    words: TimelineCaptionWord[];
    coveredRanges: Array<{ startMs: number; endMs: number }>;
  }): TimelineCaptionWord[] {
    if (options.coveredRanges.length === 0) return options.words;

    const result: TimelineCaptionWord[] = [];
    for (const word of options.words) {
      let segments = [{ startMs: word.timelineStartMs, endMs: word.timelineEndMs }];

      for (const covered of options.coveredRanges) {
        const nextSegments: Array<{ startMs: number; endMs: number }> = [];
        for (const segment of segments) {
          if (covered.endMs <= segment.startMs || covered.startMs >= segment.endMs) {
            nextSegments.push(segment);
            continue;
          }

          if (covered.startMs > segment.startMs) {
            nextSegments.push({ startMs: segment.startMs, endMs: covered.startMs });
          }
          if (covered.endMs < segment.endMs) {
            nextSegments.push({ startMs: covered.endMs, endMs: segment.endMs });
          }
        }
        segments = nextSegments.filter((segment) => segment.endMs > segment.startMs);
        if (segments.length === 0) break;
      }

      for (const segment of segments) {
        result.push({
          ...word,
          timelineStartMs: segment.startMs,
          timelineEndMs: segment.endMs,
        });
      }
    }

    return result;
  }

  async function collectTimelineCaptionWords(options?: {
    language?: string;
  }): Promise<TimelineCaptionWord[]> {
    const doc = timelineDoc.value;
    if (!doc) {
      throw new Error('Timeline not loaded');
    }

    const recordsByPath = new Map<string, TranscriptionRecord[]>();

    const getRecordsForPath = async (path: string) => {
      // Ensure absolute workspace path
      const projectName = getCurrentProjectName();
      const workspacePath =
        path.startsWith('/') || path.startsWith('projects/') || !projectName
          ? path
          : `projects/${projectName}/${path}`;

      let records = recordsByPath.get(workspacePath);
      if (!records) {
        const handle = getWorkspaceHandle();
        if (handle) {
          const record = await loadTranscriptionSidecar(handle, workspacePath);
          records = record ? [record] : [];
        } else {
          records = [];
        }
        recordsByPath.set(workspacePath, records);
      }
      return records;
    };

    const allWords: TimelineCaptionWord[] = [];

    for (const [trackOrder, track] of doc.tracks.entries()) {
      if (!isTrackActiveForCaptions(track)) continue;

      for (const item of track.items) {
        const clip = asActiveCaptionMediaClip(item);
        if (!clip) continue;

        const sourcePath = clip.source.path;
        const mediaType = getMediaTypeFromFilename(sourcePath);
        if (mediaType !== 'video' && mediaType !== 'audio') continue;

        const records = await getRecordsForPath(sourcePath);
        const projectName = getCurrentProjectName();
        const workspacePath =
          sourcePath.startsWith('/') || sourcePath.startsWith('projects/') || !projectName
            ? sourcePath
            : `projects/${projectName}/${sourcePath}`;

        const record = findMatchingTranscriptionRecord({
          records,
          sourcePath: workspacePath,
          language: options?.language,
        });
        if (!record) continue;

        const words = extractTranscriptionWords(record);
        if (words.length === 0) continue;

        const speedRaw = clip.speed;
        const speed =
          typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
            ? Math.abs(speedRaw)
            : 1;

        allWords.push(
          ...projectClipWordsToTimeline({
            trackId: track.id,
            trackOrder,
            clipId: clip.id,
            sourceName: record.sourceName,
            sourcePath,
            sourceStartTicks: Math.max(0, Math.round(clip.sourceRange.startTicks)),
            sourceEndTicks: Math.max(
              0,
              Math.round(clip.sourceRange.startTicks + clip.sourceRange.durationTicks),
            ),
            timelineStartTicks: Math.max(0, Math.round(clip.timelineRange.startTicks)),
            speed,
            words,
          }),
        );
      }
    }

    if (allWords.length === 0) {
      throw new Error('No active transcription cache was found for timeline media clips');
    }

    const visibleWords: TimelineCaptionWord[] = [];
    const coveredRanges: Array<{ startMs: number; endMs: number }> = [];

    for (const track of doc.tracks) {
      if (!isTrackActiveForCaptions(track)) continue;

      const trackWords = allWords.filter((word) => word.trackId === track.id);
      const trimmed = trimWordsByCoveredRanges({ words: trackWords, coveredRanges });
      visibleWords.push(...trimmed);

      if (track.kind === 'video') {
        for (const item of track.items) {
          const clip = asActiveCaptionMediaClip(item);
          if (!clip) continue;
          coveredRanges.push({
            startMs: Math.round(clip.timelineRange.startTicks / TICKS_PER_MILLISECOND),
            endMs: Math.round(
              (clip.timelineRange.startTicks + clip.timelineRange.durationTicks) /
                TICKS_PER_MILLISECOND,
            ),
          });
        }
      }
    }

    return visibleWords.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }

  async function generateCaptionsFromTimeline(options: {
    trackId: string;
    settings: CaptionGenerationSettings;
  }) {
    const doc = timelineDoc.value;
    if (!doc) {
      throw new Error('Timeline not loaded');
    }

    const track = doc.tracks.find((item) => item.id === options.trackId) ?? null;
    if (!track || track.kind !== 'video') {
      throw new Error('Captions can only be generated on a video track');
    }
    if (track.items.some((item) => item.kind === 'clip')) {
      throw new Error('Select an empty video track for generated captions');
    }

    const words = await collectTimelineCaptionWords({ language: options.settings.language });
    const chunks = buildCaptionChunksFromWords({
      words,
      settings: options.settings,
    });
    const stylePreset = createDefaultCaptionStylePreset();

    const fps = sanitizeFps(doc.timebase ?? 30);
    const commands: TimelineCommand[] = [];
    let lastEndTicks = 0;

    for (const chunk of chunks) {
      const rawStartTicks = Math.max(
        lastEndTicks,
        Math.round(chunk.startMs * TICKS_PER_MILLISECOND),
      );
      const rawDurationTicks = Math.max(
        TICKS_PER_MILLISECOND,
        Math.round((chunk.endMs - chunk.startMs) * TICKS_PER_MILLISECOND),
      );

      const startTicks = quantizeTicksToFrames(rawStartTicks, fps, 'round');
      const durationTicks = quantizeTicksToFrames(rawDurationTicks, fps, 'round');

      if (durationTicks <= 0) continue;

      commands.push({
        type: 'add_virtual_clip_to_track',
        trackId: options.trackId,
        startTicks,
        clipType: 'text',
        name: 'Generated captions',
        durationTicks,
        text: chunk.text,
        style: stylePreset.textStyle,
      });
      lastEndTicks = startTicks + durationTicks;
    }

    if (commands.length === 0) {
      throw new Error('No caption clips were generated from transcription cache');
    }

    batchApplyTimeline(commands, {
      labelKey: 'fastcat.captions.generated',
      saveMode: 'none',
    });

    await requestTimelineSave({ immediate: true });

    return {
      addedCount: commands.length,
      sourceCount: new Set(words.map((word) => word.sourcePath)).size,
    };
  }

  return {
    generateCaptionsFromTimeline,
  };
}
