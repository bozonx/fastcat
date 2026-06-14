import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { computeWaveformPeakLength, resolveWaveformSourceUs } from '~/utils/audio/waveform';
import { resolveNestedMediaPath } from '~/utils/video-editor/worker-clip-utils';

export interface BuildTimelinePeaksParams {
  doc: TimelineDocument;
  durationUs: number;
  maxLength: number;
  visiting: Set<string>;
  timelinePath?: string;
  docCache?: Map<string, TimelineDocument>;
  shouldCancel?: () => boolean;
  getMediaDurationUs?: (path: string) => number;
  loadTimelineDocument: (path: string, clip: TimelineClipItem) => Promise<TimelineDocument | null>;
  ensureMediaPeaks: (params: {
    path: string;
    maxLength: number;
    durationS?: number;
    shouldCancel?: () => boolean;
  }) => Promise<Float32Array[] | null>;
  yieldEverySamples?: number;
}

function makeEmptyPeaks(channelCount: number, length: number): Float32Array[] {
  return Array.from({ length: channelCount }, () => new Float32Array(length));
}

function mixPeakValue(target: number, next: number) {
  return Math.min(1, Math.abs(target) + Math.abs(next));
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function buildTimelinePeaks(
  params: BuildTimelinePeaksParams,
): Promise<Float32Array[] | null> {
  const {
    doc,
    durationUs,
    maxLength,
    visiting,
    timelinePath,
    docCache,
    shouldCancel,
    getMediaDurationUs,
    loadTimelineDocument,
    ensureMediaPeaks,
    yieldEverySamples = 4096,
  } = params;
  if (durationUs <= 0 || maxLength <= 0) return null;
  if (shouldCancel?.()) return null;

  const effectiveAudioResult = buildEffectiveAudioClipItems({
    audioTracks: doc.tracks.filter((track) => track.kind === 'audio'),
    videoTracks: doc.tracks.filter((track) => track.kind === 'video'),
  });

  let mixedPeaks: Float32Array[] | null = null;

  for (const item of effectiveAudioResult.items) {
    if (shouldCancel?.()) return null;
    if (item.kind !== 'clip') continue;
    const clip = item as TimelineClipItem;
    const rawPath = clip.source?.path;
    if (!rawPath) continue;
    const path = timelinePath
      ? resolveNestedMediaPath({ nestedTimelinePath: timelinePath, mediaPath: rawPath })
      : rawPath;

    let sourcePeaks: Float32Array[] | null = null;
    const clipSourceDurationUs =
      clip.sourceDurationUs && clip.sourceDurationUs > 0
        ? clip.sourceDurationUs
        : path
          ? (getMediaDurationUs?.(path) ?? 0)
          : 0;

    const sourceDurationUs = Math.max(
      1,
      Math.round(clipSourceDurationUs || clip.sourceRange.durationUs || 0),
    );

    if (clip.clipType === 'timeline') {
      if (visiting.has(path)) continue;

      let nestedDoc = docCache?.get(path) ?? null;
      if (!nestedDoc) {
        nestedDoc = await loadTimelineDocument(path, clip);
        if (!nestedDoc || shouldCancel?.()) continue;
        docCache?.set(path, nestedDoc);
      }

      visiting.add(path);
      const nestedDurationS = sourceDurationUs / 1_000_000;
      const nestedMaxLength = computeWaveformPeakLength(nestedDurationS);

      sourcePeaks = await buildTimelinePeaks({
        doc: nestedDoc,
        durationUs: sourceDurationUs,
        maxLength: nestedMaxLength,
        visiting,
        timelinePath: path,
        docCache,
        shouldCancel,
        getMediaDurationUs,
        loadTimelineDocument,
        ensureMediaPeaks,
        yieldEverySamples,
      });
      visiting.delete(path);
    } else {
      if (shouldCancel?.()) return null;
      sourcePeaks = await ensureMediaPeaks({
        path,
        maxLength,
        durationS: sourceDurationUs / 1_000_000,
        shouldCancel,
      });
      if (shouldCancel?.()) return null;
    }

    if (!sourcePeaks || sourcePeaks.length === 0) continue;

    const channelCount = sourcePeaks.length;
    if (!mixedPeaks) {
      mixedPeaks = makeEmptyPeaks(channelCount, maxLength);
    } else if (mixedPeaks.length < channelCount) {
      for (let channelIndex = mixedPeaks.length; channelIndex < channelCount; channelIndex++) {
        mixedPeaks.push(new Float32Array(maxLength));
      }
    }

    const itemStartUs = Math.max(0, Math.round(clip.timelineRange.startUs));
    const itemDurationUs = Math.max(0, Math.round(clip.timelineRange.durationUs));
    const itemSourceStartUs = Math.max(0, Math.round(clip.sourceRange.startUs));
    const itemSourceDurationUs = Math.max(1, Math.round(clip.sourceRange.durationUs));
    const gain = Math.max(0, Math.min(10, Number(clip.audioGain ?? 1)));

    const startIndex = Math.max(0, Math.floor((itemStartUs / durationUs) * maxLength));
    const endIndex = Math.min(
      maxLength,
      Math.ceil(((itemStartUs + itemDurationUs) / durationUs) * maxLength),
    );

    for (let sampleIndex = startIndex; sampleIndex < endIndex; sampleIndex++) {
      if (sampleIndex > startIndex && (sampleIndex - startIndex) % yieldEverySamples === 0) {
        if (shouldCancel?.()) return null;
        await yieldToMainThread();
      }

      const parentRatio = sampleIndex / maxLength;
      const absoluteUs = parentRatio * durationUs;
      const sourceUs = resolveWaveformSourceUs({
        absoluteUs,
        clipStartUs: itemStartUs,
        clipDurationUs: itemDurationUs,
        sourceStartUs: itemSourceStartUs,
        sourceRangeDurationUs: itemSourceDurationUs,
        speed: clip.speed,
      });
      if (sourceUs === null) continue;

      for (let channelIndex = 0; channelIndex < mixedPeaks.length; channelIndex++) {
        const sourceChannel = sourcePeaks[channelIndex] ?? sourcePeaks[0];
        if (!sourceChannel || sourceChannel.length === 0) continue;
        const sourceIndex = Math.min(
          sourceChannel.length - 1,
          Math.max(0, Math.floor((sourceUs / sourceDurationUs) * sourceChannel.length)),
        );
        const current = mixedPeaks[channelIndex]?.[sampleIndex] ?? 0;
        const next = (sourceChannel[sourceIndex] ?? 0) * gain;
        mixedPeaks[channelIndex]![sampleIndex] = mixPeakValue(current, next);
      }
    }
  }

  return mixedPeaks;
}
