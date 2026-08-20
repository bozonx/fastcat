import { createDevLogger } from '~/utils/dev-logger';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { loadTranscriptionSidecar } from '~/utils/transcription/persistence';
import { extractTranscriptionWords } from '~/utils/transcription/captions';
import { TICKS_PER_MILLISECOND } from '~/utils/time';
import type { TimelineMediaClipItem } from '~/timeline/types';
const log = createDevLogger('useSilenceTrimming');

/**
 * Composable for performing silence trimming on timeline clips using STT data.
 */
export function useSilenceTrimming() {
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();

  const PAUSE_THRESHOLD_TICKS = 500 * TICKS_PER_MILLISECOND; // 500ms

  async function applySilenceTrimming(options: {
    clipIds: string[];
    settings: {
      trimStart: boolean;
      trimEnd: boolean;
      trimMiddle: boolean;
      mode: 'cut' | 'mark';
    };
  }) {
    const doc = timelineStore.timelineDoc;
    if (!doc) return;

    const workspaceHandle = workspaceStore.workspaceHandle;
    if (!workspaceHandle) {
      log.error('Workspace handle not available');
      return;
    }

    const clipsData: {
      trackId: string;
      itemId: string;
      pauses: { startTicks: number; endTicks: number }[];
    }[] = [];

    const missingTranscriptionPaths = new Set<string>();

    for (const itemId of options.clipIds) {
      const track = doc.tracks.find((t) => t.items.some((i) => i.id === itemId));
      if (!track) continue;

      const item = track.items.find((i) => i.id === itemId) as TimelineMediaClipItem | undefined;
      if (!item || item.kind !== 'clip' || item.clipType !== 'media') continue;

      const sourcePath = item.source?.path;
      if (!sourcePath) continue;

      const record = await loadTranscriptionSidecar(workspaceHandle, sourcePath);
      if (!record) {
        missingTranscriptionPaths.add(sourcePath);
        continue;
      }

      const words = extractTranscriptionWords(record);
      if (words.length === 0) continue;

      const speed = item.speed ?? 1;
      const absSpeed = Math.abs(speed);

      // Transcription word timings are in milliseconds; convert to canonical ticks.
      const firstWord = words[0]!;
      const lastWord = words[words.length - 1]!;

      const firstWordStartTicks = firstWord.start * TICKS_PER_MILLISECOND;
      const lastWordEndTicks = lastWord.end * TICKS_PER_MILLISECOND;

      const pauses: { startTicks: number; endTicks: number }[] = [];

      // 1. Identify start pause
      if (options.settings.trimStart && firstWordStartTicks > item.sourceRange.startTicks) {
        pauses.push({
          startTicks: item.timelineRange.startTicks,
          endTicks:
            item.timelineRange.startTicks +
            (firstWordStartTicks - item.sourceRange.startTicks) / absSpeed,
        });
      }

      // 2. Identify end pause
      if (
        options.settings.trimEnd &&
        lastWordEndTicks < item.sourceRange.startTicks + item.sourceRange.durationTicks
      ) {
        pauses.push({
          startTicks:
            item.timelineRange.startTicks +
            (lastWordEndTicks - item.sourceRange.startTicks) / absSpeed,
          endTicks: item.timelineRange.startTicks + item.timelineRange.durationTicks,
        });
      }

      // 3. Identify middle pauses
      if (options.settings.trimMiddle) {
        for (let i = 0; i < words.length - 1; i++) {
          const word = words[i]!;
          const nextWord = words[i + 1]!;
          const gapStartTicks = word.end * TICKS_PER_MILLISECOND;
          const gapEndTicks = nextWord.start * TICKS_PER_MILLISECOND;

          if (gapEndTicks - gapStartTicks > PAUSE_THRESHOLD_TICKS) {
            const t1 =
              item.timelineRange.startTicks +
              (gapStartTicks - item.sourceRange.startTicks) / absSpeed;
            const t2 =
              item.timelineRange.startTicks +
              (gapEndTicks - item.sourceRange.startTicks) / absSpeed;

            // Only add if it's within current clip's timeline range
            const clipEndTicks = item.timelineRange.startTicks + item.timelineRange.durationTicks;
            const pauseStart = Math.max(item.timelineRange.startTicks, t1);
            const pauseEnd = Math.min(clipEndTicks, t2);

            if (pauseEnd - pauseStart > 100 * TICKS_PER_MILLISECOND) {
              // at least 100ms
              pauses.push({ startTicks: pauseStart, endTicks: pauseEnd });
            }
          }
        }
      }

      if (pauses.length > 0) {
        clipsData.push({
          trackId: track.id,
          itemId: item.id,
          pauses,
        });
      }
    }

    if (clipsData.length > 0) {
      timelineStore.applyTimeline(
        {
          type: 'auto_trim_pauses',
          clips: clipsData,
          mode: options.settings.mode,
        },
        {
          labelKey: 'fastcat.timeline.autoMontage.historyLabel',
        },
      );
    }

    return {
      missingTranscriptionCount: missingTranscriptionPaths.size,
    };
  }

  return {
    applySilenceTrimming,
  };
}
