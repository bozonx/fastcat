import { createDevLogger } from '~/utils/dev-logger';
import { computed, ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineSelectionRange } from '~/timeline/types';
import {
  useTimelineExport,
  sanitizeBaseName,
  resolveExportCodecs,
  getExt,
  normalizeExportFilename,
} from '~/composables/timeline/export';
import { createTimelineFormatFromProjectDefaults } from '~/timeline/format';
import { save } from '@tauri-apps/plugin-dialog';
import { copyFile } from '@tauri-apps/plugin-fs';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import { randomToken } from '~/utils/ids';
const log = createDevLogger('useExportForm');

export interface ExportRangeOption {
  id: string;
  label: string;
  description?: string;
  range?: TimelineSelectionRange;
}

export function useExportForm() {
  const { t } = useI18n();
  const toast = useToast();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();

  const selectedExportRangeId = ref('timeline');
  const saveAsDefaults = ref(false);
  const customExportPath = ref<string | null>(null);
  const isTauri = isTauriRuntime();

  const {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    outputFilename,
    filenameError,
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    audioSampleRate,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    bitrateMode,
    keyframeIntervalSec,
    exportAlpha,
    metadataTitle,
    metadataDescription,
    metadataAuthor,
    metadataTags,
    videoCodecSupport,
    audioCodecSupport,
    isLoadingCodecSupport,
    bitrateBps,
    audioBitrateBps,
    normalizedExportWidth,
    normalizedExportHeight,
    normalizedExportFps,
    ensureExportDir,
    validateFilename,
    getNextAvailableFilename,
    loadCodecSupport,
    saveProjectSettingsAsDefault,
    exportTimelineToFile,
    cancelExport,
    cancelRequested,
    resetExportState,
    exportType,
    ext,
  } = useTimelineExport();

  const initialSavedSettingsSnapshot = ref('');

  const selectionRange = computed(() => timelineStore.getSelectionRange());
  const zoneMarkers = computed(() =>
    [...timelineStore.getMarkers()]
      .filter((marker) => Number.isFinite(marker.durationUs) && Number(marker.durationUs) > 0)
      .sort((a, b) => a.timeUs - b.timeUs),
  );
  const exportRangeOptions = computed<ExportRangeOption[]>(() => {
    const options: ExportRangeOption[] = [
      {
        id: 'timeline',
        label: t('videoEditor.export.wholeTimeline'),
      },
    ];

    if (selectionRange.value) {
      options.push({
        id: 'selection',
        label: t('videoEditor.export.selection'),
        range: selectionRange.value,
      });
    }

    zoneMarkers.value.forEach((marker, index) => {
      const text = marker.text.trim();
      options.push({
        id: `marker:${marker.id}`,
        label: t('videoEditor.export.zoneMarker', { index: index + 1 }),
        description: text || undefined,
        range: {
          startUs: Math.max(0, Math.round(marker.timeUs)),
          endUs: Math.max(
            Math.round(marker.timeUs),
            Math.round(marker.timeUs + (marker.durationUs ?? 0)),
          ),
        },
      });
    });

    return options;
  });
  const hasSelectableExportRanges = computed(() => exportRangeOptions.value.length > 1);
  const selectedExportRange = computed(
    () =>
      exportRangeOptions.value.find((option) => option.id === selectedExportRangeId.value) ??
      exportRangeOptions.value[0],
  );
  const savedSettingsSnapshot = computed(() =>
    JSON.stringify({
      exportType: exportType.value,
      width: normalizedExportWidth.value,
      height: normalizedExportHeight.value,
      fps: normalizedExportFps.value,
      resolutionFormat: resolutionFormat.value,
      orientation: orientation.value,
      aspectRatio: aspectRatio.value,
      isCustomResolution: isCustomResolution.value,
      format: outputFormat.value,
      videoCodec: videoCodec.value,
      bitrateMbps: bitrateMbps.value,
      excludeAudio: excludeAudio.value,
      audioCodec: audioCodec.value,
      audioBitrateKbps: audioBitrateKbps.value,
      bitrateMode: bitrateMode.value,
      keyframeIntervalSec: keyframeIntervalSec.value,
      exportAlpha: exportAlpha.value,
      metadataTitle: metadataTitle.value.trim(),
      metadataDescription: metadataDescription.value.trim(),
      metadataAuthor: metadataAuthor.value.trim(),
      metadataTags: metadataTags.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }),
  );
  const isSettingsDirty = computed(
    () => savedSettingsSnapshot.value !== initialSavedSettingsSnapshot.value,
  );

  watch(isSettingsDirty, (isDirty) => {
    if (isDirty) return;
    saveAsDefaults.value = false;
  });

  watch(exportRangeOptions, (options) => {
    if (options.some((option) => option.id === selectedExportRangeId.value)) return;
    selectedExportRangeId.value = 'timeline';
  });

  watch(
    () => selectionStore.selectedEntity,
    (selectedEntity) => {
      if (isExporting.value) return;

      if (selectedEntity?.source === 'timeline' && selectedEntity.kind === 'marker') {
        const selectedZoneMarker = zoneMarkers.value.find(
          (marker) => marker.id === selectedEntity.markerId,
        );
        if (selectedZoneMarker) {
          selectedExportRangeId.value = `marker:${selectedZoneMarker.id}`;
        }
        return;
      }

      if (
        selectedEntity?.source === 'timeline' &&
        selectedEntity.kind === 'selection-range' &&
        selectionRange.value
      ) {
        selectedExportRangeId.value = 'selection';
      }
    },
  );

  watch(ext, async (nextExt) => {
    try {
      const base = outputFilename.value.replace(/\.[^.]+$/, '');
      if (!base) return;

      if (!/_\d{3}$/.test(base)) {
        outputFilename.value = await getNextAvailableFilename(base, nextExt);
        return;
      }

      outputFilename.value = `${base}.${nextExt}`;
      await validateFilename();
    } catch {
      // ignore
    }
  });

  function resolveDefaultExportRangeId() {
    const selectedEntity = selectionStore.selectedEntity;

    if (selectedEntity?.source === 'timeline' && selectedEntity.kind === 'marker') {
      const selectedZoneMarker = zoneMarkers.value.find(
        (marker) => marker.id === selectedEntity.markerId,
      );
      if (selectedZoneMarker) {
        return `marker:${selectedZoneMarker.id}`;
      }
    }

    if (selectionRange.value) {
      return 'selection';
    }

    return 'timeline';
  }

  async function initializeExportForm() {
    resetExportState();
    exportType.value = 'video';
    filenameError.value = null;
    saveAsDefaults.value = false;
    customExportPath.value = null;
    selectedExportRangeId.value = resolveDefaultExportRangeId();

    await loadCodecSupport();

    outputFormat.value = projectStore.projectSettings.exportDefaults.encoding.format;
    videoCodec.value = projectStore.projectSettings.exportDefaults.encoding.videoCodec;
    bitrateMbps.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMbps;
    excludeAudio.value = projectStore.projectSettings.exportDefaults.encoding.excludeAudio;
    audioCodec.value = projectStore.projectSettings.exportDefaults.encoding.audioCodec;
    audioBitrateKbps.value = projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps;
    const format =
      timelineStore.timelineFormat ??
      createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);
    audioSampleRate.value = format.sampleRate;
    bitrateMode.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMode;
    keyframeIntervalSec.value =
      projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec;
    exportAlpha.value = projectStore.projectSettings.exportDefaults.encoding.exportAlpha;

    metadataTitle.value = projectStore.projectMeta?.title || '';
    metadataDescription.value = projectStore.projectMeta?.description || '';
    metadataAuthor.value = projectStore.projectMeta?.author || '';
    metadataTags.value = projectStore.projectMeta?.tags.join(', ') || '';

    exportWidth.value = format.width;
    exportHeight.value = format.height;
    exportFps.value = format.fps;
    resolutionFormat.value = format.resolutionFormat;
    orientation.value = format.orientation;
    aspectRatio.value = format.aspectRatio;
    isCustomResolution.value = format.isCustomResolution;
    initialSavedSettingsSnapshot.value = savedSettingsSnapshot.value;

    await ensureExportDir();
    const timelineBase = sanitizeBaseName(
      projectStore.currentFileName || projectStore.currentProjectName || 'timeline',
    );
    outputFilename.value = await getNextAvailableFilename(timelineBase, getExt(outputFormat.value));
    await validateFilename();
  }

  function handleOutputFormatChange(fmt: 'mp4' | 'webm' | 'mkv') {
    const codecConfig = resolveExportCodecs(fmt, videoCodec.value, audioCodec.value);
    videoCodec.value = codecConfig.videoCodec;
    audioCodec.value = codecConfig.audioCodec;
  }

  async function handleStartExport(onSuccess?: (file: File) => void | Promise<void>) {
    if (isExporting.value) return;

    isExporting.value = true;
    exportProgress.value = 0;
    exportError.value = null;
    exportWarnings.value = [];

    try {
      const exportDir = await ensureExportDir();
      const ok = await validateFilename();
      if (!ok) return;
      const finalFilename = normalizeExportFilename(outputFilename.value);
      outputFilename.value = finalFilename;

      try {
        await exportDir.getFileHandle(finalFilename);
        throw new Error(t('videoEditor.export.filenameAlreadyExists'));
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'NotFoundError') {
          throw e;
        }
      }

      const tempFilename = `.${finalFilename}.tmp-${Date.now()}-${randomToken(6)}`;
      const tempFileHandle = await exportDir.getFileHandle(tempFilename, { create: true });

      const isAudio = exportType.value === 'audio';
      const fileExt = outputFilename.value.split('.').pop()?.toLowerCase();

      const finalFormat = isAudio
        ? (fileExt === 'aac' || fileExt === 'mp4' || fileExt === 'webm' || fileExt === 'mkv'
            ? (fileExt as 'aac' | 'mp4' | 'webm' | 'mkv')
            : audioCodec.value === 'opus' ? 'webm' : 'aac')
        : outputFormat.value;

      const resolvedCodecs = isAudio
        ? { videoCodec: 'none', audioCodec: audioCodec.value }
        : resolveExportCodecs(
            outputFormat.value,
            videoCodec.value,
            audioCodec.value as 'aac' | 'opus',
          );

      let exportSuccess = false;
      try {
        exportPhase.value = 'encoding';
        await exportTimelineToFile(
          {
            format: finalFormat,
            videoCodec: resolvedCodecs.videoCodec,
            bitrate: isAudio ? 100_000 : bitrateBps.value,
            audioBitrate: audioBitrateBps.value,
            audio: isAudio ? true : !excludeAudio.value,
            audioCodec: resolvedCodecs.audioCodec,
            audioSampleRate: audioSampleRate.value,
            width: isAudio ? 2 : normalizedExportWidth.value,
            height: isAudio ? 2 : normalizedExportHeight.value,
            fps: isAudio ? 30 : normalizedExportFps.value,
            bitrateMode: bitrateMode.value,
            keyframeIntervalSec: keyframeIntervalSec.value,
            exportAlpha: isAudio ? false : exportAlpha.value,
            metadata: {
              title: metadataTitle.value,
              description: metadataDescription.value,
              author: metadataAuthor.value,
              tags: metadataTags.value,
            },
            exportRangeUs: selectedExportRange.value?.range,
          },
          tempFileHandle,
          (progress) => {
            exportProgress.value = progress;
          },
        );

        try {
          await exportDir.getFileHandle(finalFilename);
          throw new Error(t('videoEditor.export.filenameAlreadyExists'));
        } catch (e: unknown) {
          if (e instanceof Error && e.name !== 'NotFoundError') {
            throw e;
          }
        }

        const fileHandle = await exportDir.getFileHandle(finalFilename, { create: true });
        await withFileIoSlot(async () => {
          const tempFile = await tempFileHandle.getFile();
          const writable = await fileHandle.createWritable({ keepExistingData: false });
          try {
            await writable.write(tempFile);
            await writable.close();
          } catch (e) {
            await writable.abort();
            throw e;
          }
        });

        exportSuccess = true;
        exportProgress.value = 1;

        if (saveAsDefaults.value) {
          try {
            await saveProjectSettingsAsDefault();
          } catch (e) {
            log.warn('Failed to persist export defaults', e);
          }
        }

        if (exportWarnings.value.length > 0) {
          toast.add({
            title: t('videoEditor.export.warningTitle'),
            description: exportWarnings.value[0]!,
            color: 'warning',
            icon: 'i-heroicons-exclamation-triangle',
          });
        }

        toast.add({
          title: t('videoEditor.export.successTitle'),
          description: t('videoEditor.export.successDesc', {
            file: outputFilename.value,
          }),
          color: 'success',
          icon: 'i-heroicons-check-circle',
        });

        if (onSuccess) {
          const file = await withFileIoSlot(() => fileHandle.getFile());
          await onSuccess(file);
        }

        if (isTauri && customExportPath.value) {
          const tauriFileHandle = fileHandle as unknown as { path?: string };
          if (tauriFileHandle.path) {
            try {
              await copyFile(tauriFileHandle.path, customExportPath.value);
            } catch (e) {
              log.warn('Failed to copy exported file to custom location', e);
            }
          }
        }
      } finally {
        try {
          await exportDir.removeEntry(tempFilename);
        } catch (e) {
          log.warn('Failed to clean up temporary export file', e);
        }
        if (!exportSuccess) {
          await validateFilename();
        }
      }
    } catch (err: unknown) {
      log.error('Export failed:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        exportError.value = t('videoEditor.export.errorCancelled');
      } else {
        exportError.value = err instanceof Error ? err.message : t('videoEditor.export.error');
      }
    } finally {
      isExporting.value = false;
      exportPhase.value = null;
      cancelRequested.value = false;
    }
  }

  async function pickTauriExportPath() {
    if (!isTauri) return;
    try {
      const isAudio = exportType.value === 'audio';
      const audioExt = audioCodec.value === 'opus' ? 'webm' : 'aac';
      const path = await save({
        defaultPath: outputFilename.value,
        filters: isAudio
          ? [{ name: 'Audio', extensions: [audioExt] }]
          : [{ name: 'Video', extensions: [outputFormat.value] }],
      });
      if (path) {
        customExportPath.value = path;
      }
    } catch (e) {
      log.warn('Failed to pick export location', e);
    }
  }

  function getPhaseLabel() {
    if (exportPhase.value === 'encoding') return t('videoEditor.export.phaseEncoding');
    if (exportPhase.value === 'saving') return t('videoEditor.export.phaseSaving');
    if (exportPhase.value === 'preparing') return t('videoEditor.export.phasePreparing');
    return t('videoEditor.export.processing');
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
    audioSampleRate,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    bitrateMode,
    keyframeIntervalSec,
    exportAlpha,
    metadataTitle,
    metadataDescription,
    metadataAuthor,
    metadataTags,
    normalizedExportWidth,
    normalizedExportHeight,
    normalizedExportFps,
    videoCodecSupport,
    audioCodecSupport,
    isLoadingCodecSupport,

    selectedExportRangeId,
    selectedExportRange,
    saveAsDefaults,
    exportRangeOptions,
    hasSelectableExportRanges,
    isSettingsDirty,
    customExportPath,
    isTauri,
    exportType,
    ext,

    initializeExportForm,
    pickTauriExportPath,
    handleOutputFormatChange,
    handleStartExport,
    getPhaseLabel,
    validateFilename,
    cancelExport,
  };
}
