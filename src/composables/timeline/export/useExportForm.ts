import { createDevLogger } from '~/utils/dev-logger';
import { computed, ref, watch, nextTick } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineSelectionRange } from '~/timeline/types';
import { resolveExportPreset } from '~/utils/settings';
import {
  useTimelineExport,
  sanitizeBaseName,
  resolveExportCodecs,
  resolveAudioExportSampleRate,
  supportsExportAlpha,
  normalizeExportFilename,
} from '~/composables/timeline/export';
import { createTimelineFormatFromProjectDefaults } from '~/timeline/format';
import { copyFile, rename } from '@tauri-apps/plugin-fs';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import { randomToken } from '~/utils/ids';
import { getNativeFileHandlePath } from '~/utils/tauri-media-processing';
import { formatRenderDuration } from '~/utils/format';
const log = createDevLogger('useExportForm');

export interface ExportRangeOption {
  id: string;
  label: string;
  description?: string;
  range?: TimelineSelectionRange;
  color?: string;
}

export function useExportForm() {
  const isInitializing = ref(false);
  const { t } = useI18n();
  const toast = useToast();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();
  const workspaceStore = useWorkspaceStore();

  const selectedExportRangeId = ref('timeline');
  const customExportPath = ref<string | null>(null);
  const isTauri = isTauriRuntime();

  const {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    exportDurationMs,
    lastExportStatus,
    outputFilename,
    filenameError,
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    audioChannels,
    audioSampleRate,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    bitrateMode,
    enableAdvancedSettings,
    maxBitrateMbps,
    minBitrateMbps,
    keyframeIntervalSec,
    exportAlpha,
    fastStart,
    includeMetadata,
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
    exportTimelineToFile,
    cancelExport,
    cancelRequested,
    resetExportState,
    exportType,
    ext,
    matchTimeline,
    customWidth,
    customHeight,
    customFps,
    customAudioSampleRate,
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
        color: marker.color || undefined,
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
      audioChannels: audioChannels.value,
      bitrateMode: bitrateMode.value,
      enableAdvancedSettings: enableAdvancedSettings.value,
      maxBitrateMbps: maxBitrateMbps.value,
      minBitrateMbps: minBitrateMbps.value,
      keyframeIntervalSec: keyframeIntervalSec.value,
      exportAlpha: exportAlpha.value,
      fastStart: fastStart.value,
      includeMetadata: includeMetadata.value,
      metadataTitle: metadataTitle.value.trim(),
      metadataDescription: metadataDescription.value.trim(),
      metadataAuthor: metadataAuthor.value.trim(),
      metadataTags: metadataTags.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }),
  );
  const isSettingsDirty = computed(() => {
    const encDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);

    const format =
      timelineStore.timelineFormat ??
      createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);

    const isEncodingDifferent =
      outputFormat.value !== encDefaults.format ||
      videoCodec.value !== encDefaults.videoCodec ||
      bitrateMbps.value !== encDefaults.bitrateMbps ||
      excludeAudio.value !== encDefaults.excludeAudio ||
      audioCodec.value !== encDefaults.audioCodec ||
      audioBitrateKbps.value !== encDefaults.audioBitrateKbps ||
      audioChannels.value !== 2 ||
      enableAdvancedSettings.value !== false ||
      maxBitrateMbps.value !== null ||
      minBitrateMbps.value !== null ||
      bitrateMode.value !== encDefaults.bitrateMode ||
      keyframeIntervalSec.value !== encDefaults.keyframeIntervalSec ||
      exportAlpha.value !== encDefaults.exportAlpha ||
      fastStart.value !== encDefaults.fastStart;

    const isGeometryDifferent =
      !matchTimeline.value ||
      exportWidth.value !== format.width ||
      exportHeight.value !== format.height ||
      exportFps.value !== format.fps ||
      Number(audioSampleRate.value) !== format.sampleRate;

    const isMetadataDifferent =
      includeMetadata.value !== false ||
      metadataTitle.value !== (projectStore.projectMeta?.title || '') ||
      metadataDescription.value !== (projectStore.projectMeta?.description || '') ||
      metadataAuthor.value !== (projectStore.projectMeta?.author || '') ||
      metadataTags.value !== (projectStore.projectMeta?.tags.join(', ') || '');

    return isEncodingDifferent || isGeometryDifferent || isMetadataDifferent;
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
    if (isInitializing.value) return;
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
    isInitializing.value = true;
    try {
      resetExportState();
      exportType.value = 'video';
      filenameError.value = null;
      selectedExportRangeId.value = resolveDefaultExportRangeId();

      await loadCodecSupport();

      const format =
        timelineStore.timelineFormat ??
        createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);

      const saved = projectStore.projectSettings.exportSettings;
      if (saved) {
        exportType.value = saved.exportType ?? 'video';
        outputFormat.value = saved.outputFormat ?? 'mp4';
        videoCodec.value = saved.videoCodec ?? 'avc1.640032';
        bitrateMbps.value = saved.bitrateMbps ?? 5;
        excludeAudio.value = saved.excludeAudio ?? false;
        audioCodec.value = saved.audioCodec ?? 'aac';
        audioBitrateKbps.value = saved.audioBitrateKbps ?? 128;
        audioChannels.value = saved.audioChannels ?? 2;
        audioSampleRate.value = saved.audioSampleRate ?? 48000;
        bitrateMode.value = saved.bitrateMode ?? 'variable';
        enableAdvancedSettings.value = saved.enableAdvancedSettings ?? false;
        maxBitrateMbps.value = saved.maxBitrateMbps ?? null;
        minBitrateMbps.value = saved.minBitrateMbps ?? null;
        keyframeIntervalSec.value = saved.keyframeIntervalSec ?? 2;
        exportAlpha.value = saved.exportAlpha ?? false;
        fastStart.value = saved.fastStart ?? true;
        matchTimeline.value = saved.matchTimeline ?? true;
        customWidth.value = saved.customWidth ?? format.width;
        customHeight.value = saved.customHeight ?? format.height;
        customFps.value = saved.customFps ?? format.fps;
        customAudioSampleRate.value = saved.customAudioSampleRate ?? format.sampleRate;
        includeMetadata.value = saved.includeMetadata ?? false;
        metadataTitle.value = saved.metadataTitle ?? '';
        metadataDescription.value = saved.metadataDescription ?? '';
        metadataAuthor.value = saved.metadataAuthor ?? '';
        metadataTags.value = saved.metadataTags ?? '';
        customExportPath.value = saved.customExportPath ?? null;
      } else {
        const encDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);
        exportType.value = 'video';
        outputFormat.value = encDefaults.format;
        videoCodec.value = encDefaults.videoCodec;
        bitrateMbps.value = encDefaults.bitrateMbps;
        excludeAudio.value = encDefaults.excludeAudio;
        audioCodec.value = encDefaults.audioCodec;
        audioBitrateKbps.value = encDefaults.audioBitrateKbps;
        audioChannels.value = 2;
        audioSampleRate.value = format.sampleRate;
        bitrateMode.value = encDefaults.bitrateMode;
        enableAdvancedSettings.value = false;
        maxBitrateMbps.value = null;
        minBitrateMbps.value = null;
        keyframeIntervalSec.value = encDefaults.keyframeIntervalSec;
        exportAlpha.value = encDefaults.exportAlpha;
        fastStart.value = encDefaults.fastStart;

        metadataTitle.value = projectStore.projectMeta?.title || '';
        metadataDescription.value = projectStore.projectMeta?.description || '';
        metadataAuthor.value = projectStore.projectMeta?.author || '';
        metadataTags.value = projectStore.projectMeta?.tags.join(', ') || '';
        includeMetadata.value = false;

        matchTimeline.value = true;
        customWidth.value = format.width;
        customHeight.value = format.height;
        customFps.value = format.fps;
        customAudioSampleRate.value = format.sampleRate;
        customExportPath.value = null;
      }

      if (!supportsExportAlpha(outputFormat.value, videoCodec.value)) {
        exportAlpha.value = false;
      }

      initialSavedSettingsSnapshot.value = savedSettingsSnapshot.value;

      await ensureExportDir();
      const timelineBase = sanitizeBaseName(
        projectStore.currentFileName || projectStore.currentProjectName || 'timeline',
      );
      outputFilename.value = await getNextAvailableFilename(timelineBase, ext.value);
      await validateFilename();
    } finally {
      await nextTick();
      isInitializing.value = false;
    }
  }

  function handleOutputFormatChange(fmt: 'mp4' | 'webm' | 'mkv') {
    const codecConfig = resolveExportCodecs(fmt, videoCodec.value, audioCodec.value);
    videoCodec.value = codecConfig.videoCodec;
    audioCodec.value = codecConfig.audioCodec;
    if (!supportsExportAlpha(fmt, videoCodec.value)) {
      exportAlpha.value = false;
    }
  }

  async function handleStartExport(onSuccess?: (file: File) => void | Promise<void>) {
    if (isExporting.value) return;

    exportProgress.value = 0;
    exportError.value = null;
    exportWarnings.value = [];
    exportDurationMs.value = null;
    lastExportStatus.value = null;
    const startTime = performance.now();

    try {
      const exportDir = await ensureExportDir();
      const ok = await validateFilename();
      if (!ok) return;

      isExporting.value = true;
      const finalFilename = normalizeExportFilename(outputFilename.value);
      outputFilename.value = finalFilename;
      console.log('[export form debug] starting export', finalFilename, 'duration', duration.value);

      try {
        await exportDir.getFileHandle(finalFilename);
        throw new Error(t('videoEditor.export.filenameAlreadyExists'));
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'NotFoundError') {
          throw e;
        }
      }

      const extIndex = finalFilename.lastIndexOf('.');
      const tempFilename =
        extIndex !== -1
          ? `.${finalFilename.slice(0, extIndex)}.tmp-${Date.now()}-${randomToken(6)}${finalFilename.slice(extIndex)}`
          : `.${finalFilename}.tmp-${Date.now()}-${randomToken(6)}`;
      const tempFileHandle = await exportDir.getFileHandle(tempFilename, { create: true });

      const isAudio = exportType.value === 'audio';
      const fileExt = outputFilename.value.split('.').pop()?.toLowerCase();

      const finalFormat = isAudio
        ? fileExt === 'aac' ||
          fileExt === 'mp4' ||
          fileExt === 'webm' ||
          fileExt === 'mkv' ||
          fileExt === 'opus' ||
          fileExt === 'ogg' ||
          fileExt === 'flac' ||
          fileExt === 'wav' ||
          fileExt === 'mp3'
          ? (fileExt as 'aac' | 'mp4' | 'webm' | 'mkv' | 'opus' | 'ogg' | 'flac' | 'wav' | 'mp3')
          : audioCodec.value === 'opus'
            ? 'opus'
            : audioCodec.value === 'flac'
              ? 'flac'
              : audioCodec.value === 'pcm'
                ? 'wav'
                : audioCodec.value === 'mp3'
                  ? 'mp3'
                  : 'aac'
        : outputFormat.value;

      const resolvedCodecs = isAudio
        ? { videoCodec: 'none', audioCodec: audioCodec.value }
        : resolveExportCodecs(outputFormat.value, videoCodec.value, audioCodec.value);
      const effectiveExportAlpha =
        !isAudio &&
        supportsExportAlpha(finalFormat, resolvedCodecs.videoCodec) &&
        exportAlpha.value;
      const effectiveAudioSampleRate = resolveAudioExportSampleRate({
        format: finalFormat,
        audioCodec: resolvedCodecs.audioCodec,
        sampleRate: audioSampleRate.value,
      });

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
            audioSampleRate: effectiveAudioSampleRate,
            audioChannels: audioChannels.value === 1 ? 'mono' : 'stereo',
            width: isAudio ? 2 : normalizedExportWidth.value,
            height: isAudio ? 2 : normalizedExportHeight.value,
            fps: isAudio ? 30 : normalizedExportFps.value,
            bitrateMode: enableAdvancedSettings.value ? bitrateMode.value : 'variable',
            maxBitrateBps:
              enableAdvancedSettings.value && maxBitrateMbps.value
                ? Math.round(maxBitrateMbps.value * 1_000_000)
                : null,
            minBitrateBps:
              enableAdvancedSettings.value && minBitrateMbps.value
                ? Math.round(minBitrateMbps.value * 1_000_000)
                : null,
            keyframeIntervalSec: enableAdvancedSettings.value ? keyframeIntervalSec.value : 2,
            exportAlpha: effectiveExportAlpha,
            fastStart: enableAdvancedSettings.value ? fastStart.value : false,
            metadata: includeMetadata.value
              ? {
                  title: metadataTitle.value,
                  description: metadataDescription.value,
                  author: metadataAuthor.value,
                  tags: metadataTags.value,
                }
              : undefined,
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

        let fileHandle: FileSystemFileHandle | null = null;

        if (isTauri) {
          fileHandle = await exportDir.getFileHandle(finalFilename, { create: true });
          const tempNativePath = getNativeFileHandlePath(tempFileHandle);
          const finalNativePath = getNativeFileHandlePath(fileHandle);
          if (!tempNativePath || !finalNativePath) {
            throw new Error('Native export file path is not available for finalizing');
          }
          try {
            await rename(tempNativePath, finalNativePath);
          } catch (renameErr) {
            log.warn('Native rename failed, falling back to copyFile', renameErr);
            await copyFile(tempNativePath, finalNativePath);
          }
        } else {
          let movedWeb = false;
          const moveableHandle = tempFileHandle as FileSystemFileHandle & {
            move?: (name: string) => Promise<void>;
          };
          if (typeof moveableHandle.move === 'function') {
            try {
              await moveableHandle.move(finalFilename);
              movedWeb = true;
              fileHandle = tempFileHandle;
            } catch (moveErr) {
              log.warn('FileSystemFileHandle.move failed, falling back to copy', moveErr);
            }
          }

          if (!movedWeb) {
            fileHandle = await exportDir.getFileHandle(finalFilename, { create: true });
            await withFileIoSlot(async () => {
              const tempFile = await tempFileHandle.getFile();
              const writable = await fileHandle!.createWritable({ keepExistingData: false });
              try {
                await writable.write(tempFile);
                await writable.close();
              } catch (e) {
                await writable.abort();
                throw e;
              }
            });
          }
        }

        if (isTauri && customExportPath.value && fileHandle) {
          const tauriFilePath = getNativeFileHandlePath(fileHandle);
          if (tauriFilePath) {
            const [
              { join },
              { exists, rename: tauriRename, copyFile: tauriCopyFile, remove: tauriRemove },
            ] = await Promise.all([
              import('@tauri-apps/api/path'),
              import('@tauri-apps/plugin-fs'),
            ]);
            const destPath = await join(customExportPath.value, outputFilename.value);
            if (await exists(destPath)) {
              throw new Error(t('videoEditor.export.filenameAlreadyExists'));
            }
            try {
              await tauriRename(tauriFilePath, destPath);
            } catch (renameErr) {
              log.warn('Custom export path rename failed, falling back to copyFile', renameErr);
              await tauriCopyFile(tauriFilePath, destPath);
              await tauriRemove(tauriFilePath).catch(() => undefined);
            }
          }
        }

        exportSuccess = true;
        exportProgress.value = 1;
        const durationMs = Math.round(performance.now() - startTime);
        exportDurationMs.value = durationMs;
        lastExportStatus.value = 'success';

        if (exportWarnings.value.length > 0) {
          toast.add({
            title: t('videoEditor.export.warningTitle'),
            description: exportWarnings.value[0]!,
            color: 'warning',
            icon: 'i-heroicons-exclamation-triangle',
          });
        }

        const durationText = formatRenderDuration(durationMs);
        toast.add({
          title: t('videoEditor.export.successTitle'),
          description: t('videoEditor.export.successDescWithDuration', {
            file: outputFilename.value,
            duration: durationText,
          }),
          color: 'success',
          icon: 'i-heroicons-check-circle',
        });

        if (onSuccess) {
          const file = isTauri
            ? new File([], outputFilename.value)
            : await withFileIoSlot(() => fileHandle!.getFile());
          await onSuccess(file);
        }
      } finally {
        try {
          await exportDir.removeEntry(tempFilename);
        } catch (e: unknown) {
          if (e instanceof Error && e.name !== 'NotFoundError') {
            log.warn('Failed to clean up temporary export file', e);
          }
        }
        if (!exportSuccess) {
          await validateFilename();
        }
      }
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);
      exportDurationMs.value = durationMs;
      lastExportStatus.value = 'error';
      log.error('Export failed:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        exportError.value = t('videoEditor.export.errorCancelled');
      } else {
        exportError.value = err instanceof Error ? err.message : t('videoEditor.export.error');
        const durationText = formatRenderDuration(durationMs);
        toast.add({
          title: t('videoEditor.export.error'),
          description: t('videoEditor.export.errorDescWithDuration', { duration: durationText }),
          color: 'error',
          icon: 'i-heroicons-exclamation-triangle',
        });
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
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        directory: true,
        multiple: false,
      });
      if (path) {
        const [{ join }, { writeTextFile, remove }] = await Promise.all([
          import('@tauri-apps/api/path'),
          import('@tauri-apps/plugin-fs'),
        ]);
        const probePath = await join(
          path,
          `.fastcat-export-probe-${Date.now()}-${randomToken(6)}.tmp`,
        );
        await writeTextFile(probePath, '');
        await remove(probePath);
        customExportPath.value = path;
      }
    } catch (e) {
      log.warn('Failed to pick export location', e);
      toast.add({
        title: t('videoEditor.export.error'),
        description: e instanceof Error ? e.message : undefined,
        color: 'error',
        icon: 'i-heroicons-exclamation-triangle',
      });
    }
  }

  function getPhaseLabel() {
    if (exportPhase.value === 'encoding-audio') return t('videoEditor.export.phaseEncodingAudio');
    if (exportPhase.value === 'encoding') {
      return exportType.value === 'audio'
        ? t('videoEditor.export.phaseEncodingAudio')
        : t('videoEditor.export.phaseEncoding');
    }
    if (exportPhase.value === 'finalizing') return t('videoEditor.export.phaseFinalizing');
    if (exportPhase.value === 'preparing') return t('videoEditor.export.phasePreparing');
    return t('videoEditor.export.processing');
  }

  async function resetAllSettings() {
    projectStore.projectSettings.exportSettings = undefined;
    matchTimeline.value = true;
    await initializeExportForm();
  }

  function resetField(fieldName: string) {
    const encDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);
    const format =
      timelineStore.timelineFormat ??
      createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);

    switch (fieldName) {
      case 'outputFormat':
        if (encDefaults) outputFormat.value = encDefaults.format;
        break;
      case 'videoCodec':
        if (encDefaults) videoCodec.value = encDefaults.videoCodec;
        break;
      case 'bitrateMbps':
        if (encDefaults) bitrateMbps.value = encDefaults.bitrateMbps;
        break;
      case 'excludeAudio':
        if (encDefaults) excludeAudio.value = encDefaults.excludeAudio;
        break;
      case 'audioCodec':
        if (encDefaults) audioCodec.value = encDefaults.audioCodec;
        break;
      case 'audioBitrateKbps':
        if (encDefaults) audioBitrateKbps.value = encDefaults.audioBitrateKbps;
        break;
      case 'audioChannels':
        audioChannels.value = 2;
        break;
      case 'bitrateMode':
        if (encDefaults) bitrateMode.value = encDefaults.bitrateMode;
        break;
      case 'enableAdvancedSettings':
        enableAdvancedSettings.value = false;
        break;
      case 'maxBitrateMbps':
        maxBitrateMbps.value = null;
        break;
      case 'minBitrateMbps':
        minBitrateMbps.value = null;
        break;
      case 'keyframeIntervalSec':
        if (encDefaults) keyframeIntervalSec.value = encDefaults.keyframeIntervalSec;
        break;
      case 'exportAlpha':
        if (encDefaults) exportAlpha.value = encDefaults.exportAlpha;
        break;
      case 'fastStart':
        if (encDefaults) fastStart.value = encDefaults.fastStart;
        break;
      case 'matchTimeline':
        matchTimeline.value = true;
        break;
      case 'customWidth':
        customWidth.value = format.width;
        exportWidth.value = format.width;
        break;
      case 'customHeight':
        customHeight.value = format.height;
        exportHeight.value = format.height;
        break;
      case 'customFps':
        customFps.value = format.fps;
        exportFps.value = format.fps;
        break;
      case 'customAudioSampleRate':
        customAudioSampleRate.value = format.sampleRate;
        audioSampleRate.value = format.sampleRate;
        break;
      case 'includeMetadata':
        includeMetadata.value = false;
        break;
      case 'metadataTitle':
        metadataTitle.value = projectStore.projectMeta?.title || '';
        break;
      case 'metadataDescription':
        metadataDescription.value = projectStore.projectMeta?.description || '';
        break;
      case 'metadataAuthor':
        metadataAuthor.value = projectStore.projectMeta?.author || '';
        break;
      case 'metadataTags':
        metadataTags.value = projectStore.projectMeta?.tags.join(', ') || '';
        break;
    }
  }

  function isFieldDirty(fieldName: string) {
    const encDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);
    const format =
      timelineStore.timelineFormat ??
      createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);

    switch (fieldName) {
      case 'outputFormat':
        return outputFormat.value !== encDefaults?.format;
      case 'videoCodec':
        return videoCodec.value !== encDefaults?.videoCodec;
      case 'bitrateMbps':
        return bitrateMbps.value !== encDefaults?.bitrateMbps;
      case 'excludeAudio':
        return excludeAudio.value !== encDefaults?.excludeAudio;
      case 'audioCodec':
        return audioCodec.value !== encDefaults?.audioCodec;
      case 'audioBitrateKbps':
        return audioBitrateKbps.value !== encDefaults?.audioBitrateKbps;
      case 'audioChannels':
        return audioChannels.value !== 2;
      case 'bitrateMode':
        return bitrateMode.value !== encDefaults?.bitrateMode;
      case 'enableAdvancedSettings':
        return enableAdvancedSettings.value !== false;
      case 'maxBitrateMbps':
        return maxBitrateMbps.value !== null;
      case 'minBitrateMbps':
        return minBitrateMbps.value !== null;
      case 'keyframeIntervalSec':
        return keyframeIntervalSec.value !== encDefaults?.keyframeIntervalSec;
      case 'exportAlpha':
        return exportAlpha.value !== encDefaults?.exportAlpha;
      case 'fastStart':
        return fastStart.value !== encDefaults?.fastStart;
      case 'matchTimeline':
        return !matchTimeline.value;
      case 'customWidth':
        return exportWidth.value !== format.width;
      case 'customHeight':
        return exportHeight.value !== format.height;
      case 'customFps':
        return exportFps.value !== format.fps;
      case 'customAudioSampleRate':
        return Number(audioSampleRate.value) !== format.sampleRate;
      case 'includeMetadata':
        return includeMetadata.value !== false;
      case 'metadataTitle':
        return metadataTitle.value !== (projectStore.projectMeta?.title || '');
      case 'metadataDescription':
        return metadataDescription.value !== (projectStore.projectMeta?.description || '');
      case 'metadataAuthor':
        return metadataAuthor.value !== (projectStore.projectMeta?.author || '');
      case 'metadataTags':
        return metadataTags.value !== (projectStore.projectMeta?.tags.join(', ') || '');
      default:
        return false;
    }
  }

  watch(
    [
      exportType,
      outputFormat,
      videoCodec,
      bitrateMbps,
      excludeAudio,
      audioCodec,
      audioBitrateKbps,
      audioChannels,
      audioSampleRate,
      bitrateMode,
      enableAdvancedSettings,
      maxBitrateMbps,
      minBitrateMbps,
      keyframeIntervalSec,
      exportAlpha,
      fastStart,
      matchTimeline,
      customWidth,
      customHeight,
      customFps,
      customAudioSampleRate,
      includeMetadata,
      metadataTitle,
      metadataDescription,
      metadataAuthor,
      metadataTags,
      customExportPath,
    ],
    () => {
      if (isInitializing.value) return;
      if (!projectStore.currentProjectName) return;

      projectStore.projectSettings.exportSettings = {
        exportType: exportType.value,
        outputFormat: outputFormat.value,
        videoCodec: videoCodec.value,
        bitrateMbps: bitrateMbps.value,
        excludeAudio: excludeAudio.value,
        audioCodec: audioCodec.value,
        audioBitrateKbps: audioBitrateKbps.value,
        audioChannels: audioChannels.value,
        audioSampleRate: Number(audioSampleRate.value) || 48000,
        bitrateMode: bitrateMode.value,
        enableAdvancedSettings: enableAdvancedSettings.value,
        maxBitrateMbps: maxBitrateMbps.value,
        minBitrateMbps: minBitrateMbps.value,
        keyframeIntervalSec: keyframeIntervalSec.value,
        exportAlpha: exportAlpha.value,
        fastStart: fastStart.value,
        matchTimeline: matchTimeline.value,
        customWidth: customWidth.value,
        customHeight: customHeight.value,
        customFps: customFps.value,
        customAudioSampleRate: customAudioSampleRate.value,
        includeMetadata: includeMetadata.value,
        metadataTitle: metadataTitle.value,
        metadataDescription: metadataDescription.value,
        metadataAuthor: metadataAuthor.value,
        metadataTags: metadataTags.value,
        customExportPath: customExportPath.value,
      };
    },
    { deep: true },
  );

  return {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    exportDurationMs,
    lastExportStatus,
    cancelRequested,
    outputFilename,
    filenameError,
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    audioChannels,
    audioSampleRate,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    bitrateMode,
    enableAdvancedSettings,
    maxBitrateMbps,
    minBitrateMbps,
    keyframeIntervalSec,
    exportAlpha,
    fastStart,
    includeMetadata,
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
    exportRangeOptions,
    hasSelectableExportRanges,
    isSettingsDirty,
    matchTimeline,
    customWidth,
    customHeight,
    customFps,
    customAudioSampleRate,
    ext,
    customExportPath,
    isTauri,
    exportType,

    initializeExportForm,
    pickTauriExportPath,
    handleOutputFormatChange,
    handleStartExport,
    getPhaseLabel,
    validateFilename,
    cancelExport,
    resetAllSettings,
    resetField,
    isFieldDirty,
  };
}
