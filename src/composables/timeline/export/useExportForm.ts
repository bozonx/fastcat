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
} from '~/composables/timeline/export';

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
    isLoadingCodecSupport,
    bitrateBps,
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

    if (
      selectionRange.value &&
      (!selectedEntity ||
        selectedEntity.source !== 'timeline' ||
        selectedEntity.kind === 'selection-range')
    ) {
      return 'selection';
    }

    return 'timeline';
  }

  async function initializeExportForm() {
    exportError.value = null;
    exportWarnings.value = [];
    filenameError.value = null;
    exportProgress.value = 0;
    exportPhase.value = null;
    isExporting.value = false;
    cancelRequested.value = false;
    saveAsDefaults.value = false;
    selectedExportRangeId.value = resolveDefaultExportRangeId();

    await loadCodecSupport();

    outputFormat.value = projectStore.projectSettings.exportDefaults.encoding.format;
    videoCodec.value = projectStore.projectSettings.exportDefaults.encoding.videoCodec;
    bitrateMbps.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMbps;
    excludeAudio.value = projectStore.projectSettings.exportDefaults.encoding.excludeAudio;
    audioCodec.value = projectStore.projectSettings.exportDefaults.encoding.audioCodec;
    audioBitrateKbps.value = projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps;
    audioSampleRate.value = projectStore.projectSettings.project.sampleRate;
    bitrateMode.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMode;
    keyframeIntervalSec.value =
      projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec;
    exportAlpha.value = projectStore.projectSettings.exportDefaults.encoding.exportAlpha;

    metadataTitle.value = projectStore.projectMeta?.title || '';
    metadataDescription.value = projectStore.projectMeta?.description || '';
    metadataAuthor.value = projectStore.projectMeta?.author || '';
    metadataTags.value = projectStore.projectMeta?.tags.join(', ') || '';

    exportWidth.value = projectStore.projectSettings.project.width;
    exportHeight.value = projectStore.projectSettings.project.height;
    exportFps.value = projectStore.projectSettings.project.fps;
    resolutionFormat.value = projectStore.projectSettings.project.resolutionFormat;
    orientation.value = projectStore.projectSettings.project.orientation;
    aspectRatio.value = projectStore.projectSettings.project.aspectRatio;
    isCustomResolution.value = projectStore.projectSettings.project.isCustomResolution;
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

  async function handleFilenameExtUpdate(fmt: 'mp4' | 'webm' | 'mkv') {
    try {
      const base = outputFilename.value.replace(/\.[^.]+$/, '');
      const nextExt = getExt(fmt);

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

      try {
        await exportDir.getFileHandle(outputFilename.value);
        throw new Error('A file with this name already exists');
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'NotFoundError') {
          throw e;
        }
      }

      let fileHandle: FileSystemFileHandle;
      try {
        fileHandle = await exportDir.getFileHandle(outputFilename.value, { create: true });
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e.name === 'NotAllowedError' || e.name === 'InvalidModificationError')
        ) {
          throw new Error('A file with this name already exists', { cause: e });
        }
        throw e;
      }

      const resolvedCodecs = resolveExportCodecs(
        outputFormat.value,
        videoCodec.value,
        audioCodec.value as 'aac' | 'opus',
      );

      let exportSuccess = false;
      try {
        if (saveAsDefaults.value) {
          await saveProjectSettingsAsDefault();
        }

        exportPhase.value = 'encoding';
        await exportTimelineToFile(
          {
            format: outputFormat.value,
            videoCodec: resolvedCodecs.videoCodec,
            bitrate: bitrateBps.value,
            audioBitrate: audioBitrateKbps.value * 1000,
            audio: !excludeAudio.value,
            audioCodec: resolvedCodecs.audioCodec,
            audioSampleRate: audioSampleRate.value,
            width: normalizedExportWidth.value,
            height: normalizedExportHeight.value,
            fps: normalizedExportFps.value,
            bitrateMode: bitrateMode.value,
            keyframeIntervalSec: keyframeIntervalSec.value,
            exportAlpha: exportAlpha.value,
            metadata: {
              title: metadataTitle.value,
              description: metadataDescription.value,
              author: metadataAuthor.value,
              tags: metadataTags.value,
            },
            exportRangeUs: selectedExportRange.value?.range,
          },
          fileHandle,
          (progress) => {
            exportProgress.value = progress;
          },
        );

        exportSuccess = true;

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
          const file = await fileHandle.getFile();
          await onSuccess(file);
        }
      } finally {
        if (!exportSuccess) {
          try {
            await exportDir.removeEntry(outputFilename.value);
          } catch (e) {
            console.warn('Failed to clean up partial export file', e);
          }
          await validateFilename();
        }
      }
    } catch (err: unknown) {
      console.error('Export failed:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        exportError.value = t('videoEditor.export.errorCancelled');
      } else {
        exportError.value =
          err instanceof Error ? err.message : t('videoEditor.export.error');
      }
    } finally {
      isExporting.value = false;
      exportPhase.value = null;
      cancelRequested.value = false;
    }
  }

  function getPhaseLabel() {
    if (exportPhase.value === 'encoding') return t('videoEditor.export.phaseEncoding');
    if (exportPhase.value === 'saving') return t('videoEditor.export.phaseSaving');
    if (exportPhase.value === 'preparing')
      return t('videoEditor.export.phasePreparing');
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
    isLoadingCodecSupport,

    selectedExportRangeId,
    selectedExportRange,
    saveAsDefaults,
    exportRangeOptions,
    hasSelectableExportRanges,
    isSettingsDirty,

    initializeExportForm,
    handleOutputFormatChange,
    handleFilenameExtUpdate,
    handleStartExport,
    getPhaseLabel,
    validateFilename,
    cancelExport,
  };
}
