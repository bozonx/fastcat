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
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';

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
    sourceStartUs: number;
    sourceEndUs: number;
    timelineStartUs: number;
    speed: number;
    words: ReturnType<typeof extractTranscriptionWords>;
  }): TimelineCaptionWord[] {
    const result: TimelineCaptionWord[] = [];

    for (const word of options.words) {
      const wordStartUs = Math.round(word.start * 1000);
      const wordEndUs = Math.round(word.end * 1000);
      if (wordEndUs <= options.sourceStartUs || wordStartUs >= options.sourceEndUs) continue;

      const clippedStartUs = Math.max(wordStartUs, options.sourceStartUs);
      const clippedEndUs = Math.min(wordEndUs, options.sourceEndUs);
      if (clippedEndUs <= clippedStartUs) continue;

      const relativeStartUs = clippedStartUs - options.sourceStartUs;
      const relativeEndUs = clippedEndUs - options.sourceStartUs;
      const timelineStartUs = options.timelineStartUs + Math.round(relativeStartUs / options.speed);
      const timelineEndUs = options.timelineStartUs + Math.round(relativeEndUs / options.speed);
      if (timelineEndUs <= timelineStartUs) continue;

      result.push({
        start: word.start,
        end: word.end,
        text: word.text,
        confidence: word.confidence,
        timelineStartMs: Math.round(timelineStartUs / 1000),
        timelineEndMs: Math.round(timelineEndUs / 1000),
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
            sourceStartUs: Math.max(0, Math.round(clip.sourceRange.startUs)),
            sourceEndUs: Math.max(
              0,
              Math.round(clip.sourceRange.startUs + clip.sourceRange.durationUs),
            ),
            timelineStartUs: Math.max(0, Math.round(clip.timelineRange.startUs)),
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
            startMs: Math.round(clip.timelineRange.startUs / 1000),
            endMs: Math.round((clip.timelineRange.startUs + clip.timelineRange.durationUs) / 1000),
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

    const fps = sanitizeFps(doc.timebase?.fps ?? 30);
    const commands: TimelineCommand[] = [];
    let lastEndUs = 0;

    for (const chunk of chunks) {
      const rawStartUs = Math.max(lastEndUs, Math.round(chunk.startMs * 1000));
      const rawDurationUs = Math.max(1_000, Math.round((chunk.endMs - chunk.startMs) * 1000));

      const startUs = quantizeTimeUsToFrames(rawStartUs, fps, 'round');
      const durationUs = quantizeTimeUsToFrames(rawDurationUs, fps, 'round');

      if (durationUs <= 0) continue;

      commands.push({
        type: 'add_virtual_clip_to_track',
        trackId: options.trackId,
        startUs,
        clipType: 'text',
        name: 'Generated captions',
        durationUs,
        text: chunk.text,
        style: stylePreset.textStyle,
      });
      lastEndUs = startUs + durationUs;
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
