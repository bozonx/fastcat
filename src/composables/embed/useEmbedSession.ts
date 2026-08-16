import { createDevLogger } from '~/utils/dev-logger';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { useExportForm } from '~/composables/timeline/export/useExportForm';
import { loadExternalAssets, type ExternalAsset } from '~/utils/external-assets.service';
import { EXPORT_DIR_NAME } from '~/utils/constants';
import { randomToken } from '~/utils/ids';
import { ticksToSeconds } from '~/utils/time';
import { createEmbedBridge, type EmbedBridge } from './useEmbedBridge';
import type { EmbedAsset, EmbedCapabilities, EmbedInitPayload } from '~embed';

const log = createDevLogger('embed-session');

const EMBED_WORKSPACE_PREFIX = 'fastcat-embed-';
const EMBED_PROJECT_NAME = 'session';

export type EmbedSessionPhase =
  'standalone' | 'handshake' | 'loading' | 'ready' | 'exporting' | 'error';

function detectCapabilities(): EmbedCapabilities {
  return {
    webgpu: typeof navigator !== 'undefined' && !!navigator.gpu,
    webcodecs: typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function',
    opfs: typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated,
  };
}

function toExternalAssets(assets: EmbedAsset[]): ExternalAsset[] {
  return assets.map((asset) => ({
    id: asset.id,
    url: asset.url,
    type: asset.kind,
    filename: asset.filename,
  }));
}

/**
 * Drives one embedded editing session end to end: handshake, an ephemeral OPFS
 * workspace scoped to this session alone, ingest of the host's assets onto the
 * timeline, and handing the rendered file back.
 *
 * The session owns no persistence. Everything it writes lives under a single
 * per-session OPFS directory that `dispose` removes wholesale.
 */
export function useEmbedSession() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const { openProject, resetProjectState } = useProjectActions();
  const { addMediaToTimeline } = useAddMediaToTimeline();
  const exportForm = useExportForm();
  const { locale } = useI18n();

  const phase = ref<EmbedSessionPhase>('handshake');
  const errorMessage = ref<string | null>(null);
  const assetCount = ref(0);
  const bridge = shallowRef<EmbedBridge | null>(null);

  const sessionId = randomToken(10);
  const workspaceDirName = `${EMBED_WORKSPACE_PREFIX}${sessionId}`;

  /** Resolved once the host acknowledges it has consumed the exported file. */
  let exportAck: (() => void) | null = null;
  let exportedFilename: string | null = null;

  const canExport = computed(
    () => phase.value === 'ready' && (timelineStore.timelineDoc?.tracks?.length ?? 0) > 0,
  );

  function fail(code: string, message: string) {
    log.error(code, message);
    errorMessage.value = message;
    phase.value = 'error';
    bridge.value?.send('error', { code, message });
  }

  async function writeProjectFile(relativePath: string, data: Blob) {
    const handle = await projectStore.getProjectFileHandleByRelativePath({
      relativePath,
      create: true,
    });
    if (!handle) throw new Error(`Failed to create project file: ${relativePath}`);

    const writable = await handle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async function ingestAssets(assets: EmbedAsset[]) {
    if (!assets.length) return;

    const results = await loadExternalAssets({
      assets: toExternalAssets(assets),
      writeProjectFile,
    });

    const failed = results.filter((result) => !result.success);
    for (const result of failed) {
      log.warn('Asset failed to load', result.asset.url, result.error);
    }

    const loaded = results.filter((result) => result.success);
    if (!loaded.length) {
      if (failed.length) throw new Error('None of the supplied assets could be loaded');
      return;
    }

    // Placement is sequential from the playhead, so start from the timeline head
    // rather than wherever a previous operation left it.
    timelineStore.setCurrentTimeTicks(0);
    await addMediaToTimeline(
      loaded.map((result) => ({ name: result.asset.filename ?? result.path, path: result.path })),
      { notifyRedirect: false },
    );

    assetCount.value = loaded.length;
  }

  async function initSession(payload: EmbedInitPayload) {
    if (phase.value !== 'handshake') {
      log.warn('Ignoring a second init for an already initialised session');
      return;
    }

    phase.value = 'loading';
    try {
      if (payload.locale) locale.value = payload.locale;

      await workspaceStore.initAutomaticWorkspace(workspaceDirName);
      if (!workspaceStore.workspaceHandle) {
        throw new Error(workspaceStore.error ?? 'Failed to open the embedded workspace');
      }

      await projectStore.createProject(EMBED_PROJECT_NAME);
      await openProject(EMBED_PROJECT_NAME);
      if (!projectStore.currentProjectName) {
        throw new Error('Failed to create the embedded session project');
      }

      await ingestAssets(payload.assets ?? []);

      phase.value = 'ready';
      bridge.value?.send('initialized', {
        assetCount: assetCount.value,
        durationMs: Math.round(ticksToSeconds(timelineStore.duration) * 1000),
      });
    } catch (e) {
      fail('init-failed', e instanceof Error ? e.message : String(e));
    }
  }

  async function startExport(options?: { filename?: string }) {
    if (phase.value !== 'ready') {
      log.warn('Ignoring export request in phase', phase.value);
      return;
    }

    phase.value = 'exporting';
    try {
      await exportForm.initializeExportForm();
      if (options?.filename) exportForm.outputFilename.value = options.filename;

      await exportForm.handleStartExport(async (file: File) => {
        exportedFilename = file.name;
        // `File` crosses the boundary by reference to its backing store, so the
        // host streams it straight out of OPFS without the bytes ever being
        // materialised in either page's heap.
        bridge.value?.send('export:done', {
          file,
          meta: {
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        });
      });

      if (exportForm.exportError.value) {
        throw new Error(exportForm.exportError.value);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error('Export failed', message);
      bridge.value?.send('export:error', { message });
    } finally {
      phase.value = 'ready';
    }
  }

  /**
   * The host has finished reading the exported file, so the copy the session
   * kept alive for it can go. Held separately from `dispose` because a host may
   * keep editing after taking one render.
   */
  async function acknowledgeExport() {
    exportAck?.();
    exportAck = null;

    if (!exportedFilename) return;
    const filename = exportedFilename;
    exportedFilename = null;

    try {
      await projectStore.deleteByPath(`${EXPORT_DIR_NAME}/${filename}`);
    } catch (e) {
      log.warn('Failed to remove the acknowledged export', e);
    }
  }

  async function dispose() {
    bridge.value?.stop();
    bridge.value = null;

    try {
      await resetProjectState();
      await workspaceStore.wipeWorkspace();
      workspaceStore.resetWorkspace();

      const root = await navigator.storage?.getDirectory();
      await root?.removeEntry(workspaceDirName, { recursive: true });
    } catch (e) {
      log.warn('Failed to clean up the embedded session', e);
    }
  }

  function start() {
    const created = createEmbedBridge();
    if (!created) {
      phase.value = 'standalone';
      return;
    }

    bridge.value = created;
    created.on('init', (payload) => void initSession(payload));
    created.on('export:start', (payload) => void startExport(payload));
    created.on('export:ack', () => void acknowledgeExport());
    created.on('dispose', () => void dispose());

    created.send('ready', {
      version: 1,
      capabilities: detectCapabilities(),
    });
  }

  watch(
    () => [exportForm.exportPhase.value, exportForm.exportProgress.value] as const,
    ([exportPhase, progress]) => {
      if (phase.value !== 'exporting') return;
      bridge.value?.send('export:progress', { phase: exportPhase, progress });
    },
  );

  onScopeDispose(() => {
    bridge.value?.stop();
  });

  return {
    phase,
    errorMessage,
    assetCount,
    canExport,
    start,
    startExport,
    dispose,
  };
}
