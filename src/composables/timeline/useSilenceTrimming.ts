import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { loadTranscriptionSidecar } from '~/utils/transcription/persistence';
import { extractTranscriptionWords } from '~/utils/transcription/captions';
import type { TimelineMediaClipItem } from '~/timeline/types';

/**
 * Composable for performing silence trimming on timeline clips using STT data.
 */
export function useSilenceTrimming() {
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();
  const { t } = useI18n();

  const PAUSE_THRESHOLD_US = 500_000; // 500ms

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
       console.error('Workspace handle not available');
       return;
    }

    const clipsData: {
      trackId: string;
      itemId: string;
      pauses: { startUs: number; endUs: number }[];
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

      // Times in source microseconds
      const firstWord = words[0]!;
      const lastWord = words[words.length - 1]!;
      
      const firstWordStartUs = firstWord.start * 1000;
      const lastWordEndUs = lastWord.end * 1000;

      const pauses: { startUs: number; endUs: number }[] = [];

      // 1. Identify start pause
      if (options.settings.trimStart && firstWordStartUs > item.sourceRange.startUs) {
        pauses.push({
          startUs: item.timelineRange.startUs,
          endUs: item.timelineRange.startUs + (firstWordStartUs - item.sourceRange.startUs) / absSpeed
        });
      }

      // 2. Identify end pause
      if (options.settings.trimEnd && lastWordEndUs < item.sourceRange.startUs + item.sourceRange.durationUs) {
        pauses.push({
          startUs: item.timelineRange.startUs + (lastWordEndUs - item.sourceRange.startUs) / absSpeed,
          endUs: item.timelineRange.startUs + item.timelineRange.durationUs
        });
      }

      // 3. Identify middle pauses
      if (options.settings.trimMiddle) {
        for (let i = 0; i < words.length - 1; i++) {
          const word = words[i]!;
          const nextWord = words[i + 1]!;
          const gapStartUs = word.end * 1000;
          const gapEndUs = nextWord.start * 1000;

          if (gapEndUs - gapStartUs > PAUSE_THRESHOLD_US) {
            const t1 = item.timelineRange.startUs + (gapStartUs - item.sourceRange.startUs) / absSpeed;
            const t2 = item.timelineRange.startUs + (gapEndUs - item.sourceRange.startUs) / absSpeed;

            // Only add if it's within current clip's timeline range
            const clipEndUs = item.timelineRange.startUs + item.timelineRange.durationUs;
            const pauseStart = Math.max(item.timelineRange.startUs, t1);
            const pauseEnd = Math.min(clipEndUs, t2);

            if (pauseEnd - pauseStart > 100_000) { // at least 100ms
              pauses.push({ startUs: pauseStart, endUs: pauseEnd });
            }
          }
        }
      }

      if (pauses.length > 0) {
        clipsData.push({
          trackId: track.id,
          itemId: item.id,
          pauses
        });
      }
    }

    if (clipsData.length > 0) {
      timelineStore.applyTimeline({
        type: 'auto_trim_pauses',
        clips: clipsData,
        mode: options.settings.mode
      }, {
        labelKey: 'fastcat.timeline.autoMontage.historyLabel'
      });
    }

    return {
      missingTranscriptionCount: missingTranscriptionPaths.size
    };
  }

  return {
    applySilenceTrimming
  };
}
