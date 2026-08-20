import { createDevLogger } from '~/utils/dev-logger';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { useExportForm } from '~/composables/timeline/export/useExportForm';
import { resolveAssetPlacement } from '~/utils/external-assets.service';
import { createFileTransport, createUrlTransport } from '~/utils/embed/asset-transport';
import { downloadAssetToFile } from '~/utils/embed/asset-ingest';
import { summariseExport } from '~/utils/embed/export-summary';
import { EXPORT_DIR_NAME } from '~/utils/constants';
import { randomToken } from '~/utils/ids';
import { secondsToTicksClamped, ticksToSeconds } from '~/utils/time';
import { createEmbedBridge, type EmbedBridge } from './useEmbedBridge';
import { setEmbedFeatures } from '~/utils/embed-features';
import { applySyncedSettings, extractSyncedSettings } from '~/utils/embed/synced-settings';
import { registerHostRpc, settleHostRpc } from '~/utils/embed/host-rpc';
import { serializeTimelineToOtio } from '~/timeline/otio-serializer';
import {
  acquireSessionLock,
  collectAbandonedSessions,
  embedSessionDirPath,
  registerSession,
  removeSession,
  startSessionHeartbeat,
} from '~/utils/embed/session-lifecycle';
import { getLayoutModeOverride } from '~/composables/layout/useLayoutMode';
import { EMBED_PROTOCOL_VERSION } from '~embed';
import type {
  EmbedAsset,
  EmbedCapabilities,
  EmbedInitPayload,
  EmbedAssetTransportKind,
  EmbedLayoutPreference,
  EmbedOutputMode,
} from '~embed';

const log = createDevLogger('embed-session');

const EMBED_PROJECT_NAME = 'session';

/**
 * Preferences change in bursts — dragging a slider fires on every frame — so
 * they settle before the host hears about them.
 */
const PREFERENCES_DEBOUNCE_MS = 5_000;
/**
 * The timeline changes constantly during editing. This is a draft-keeping
 * signal, not a save button, so it trades latency for far fewer messages.
 */
const CHANGE_DEBOUNCE_MS = 10_000;
const EXPORT_ACK_TIMEOUT_MS = 30_000;

export type EmbedSessionPhase =
  'standalone' | 'handshake' | 'loading' | 'ready' | 'exporting' | 'error';

async function detectCapabilities(): Promise<EmbedCapabilities> {
  let storageQuotaBytes: number | null = null;
  try {
    storageQuotaBytes = (await navigator.storage?.estimate())?.quota ?? null;
  } catch {
    // Some browsers refuse to estimate in a third-party frame; that is itself
    // useful information for the host, reported as "unknown".
  }

  return {
    webgpu: typeof navigator !== 'undefined' && !!navigator.gpu,
    webcodecs: typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function',
    opfs: typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated,
    storageQuotaBytes,
  };
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
  const reclaimedSessions = ref(0);
  const layoutPreference = ref<EmbedLayoutPreference>('auto');
  const outputMode = ref<EmbedOutputMode>('blob');
  const assetTransport = ref<EmbedAssetTransportKind>('url');
  const bridge = shallowRef<EmbedBridge | null>(null);
  const resolvedLayoutMode = getLayoutModeOverride();

  const sessionId = randomToken(10);

  let releaseSessionLock: (() => void) | null = null;
  let stopHeartbeat: (() => void) | null = null;

  /** Resolved once the host acknowledges it has consumed the exported file. */
  let exportAck: (() => void) | null = null;
  let pendingExportAck: Promise<void> | null = null;
  let exportedFilename: string | null = null;
  let exportAckTimer: ReturnType<typeof setTimeout> | null = null;
  const sessionAbortController = new AbortController();
  let ingestQueue: Promise<void> = Promise.resolve();
  let queuedIngestBatches = 0;
  let nextAssetSequence = 0;
  const assetIds = new Set<string>();

  const isIngesting = ref(false);
  const hasUnacknowledgedExport = ref(false);

  /**
   * Rendering reads every participating source end to end, so an asset that is
   * still arriving would export as a truncated clip. The gate stays shut until
   * ingest is quiet and something is actually on the timeline.
   */
  const canExport = computed(
    () =>
      phase.value === 'ready' &&
      !isIngesting.value &&
      !hasUnacknowledgedExport.value &&
      (timelineStore.timelineDoc?.tracks?.length ?? 0) > 0,
  );

  function fail(code: string, message: string) {
    log.error(code, message);
    errorMessage.value = message;
    phase.value = 'error';
    bridge.value?.send('error', { code, message });
  }

  /** Resolves once the host answers `asset:url-expired` with a fresh URL. */
  const pendingUrlRefreshes = new Map<string, (url: string) => void>();

  function requestFreshUrl(assetId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!bridge.value) {
        reject(new Error('No host to ask for a fresh URL'));
        return;
      }
      pendingUrlRefreshes.set(assetId, resolve);
      bridge.value.send('asset:url-expired', { assetId });
    });
  }

  function createTransport(asset: EmbedAsset, assetId: string) {
    if (asset.file) return createFileTransport(assetId, asset.file);
    if (!asset.url) throw new Error(`Asset ${assetId} has neither a URL nor a file`);

    // A host that declared `host` transport has told us its URLs are not
    // reachable from here. Failing loudly beats a confusing CORS error, or
    // worse, a request that quietly leaves the host's control.
    if (assetTransport.value === 'host') {
      throw new Error(`Asset ${assetId} arrived as a URL, but this session uses host transport`);
    }

    return createUrlTransport({
      id: assetId,
      url: asset.url,
      requestFreshUrl,
      signal: sessionAbortController.signal,
    });
  }

  /**
   * Brings the host's assets in one at a time, placing each on the timeline as
   * soon as it lands rather than after the whole batch. With several assets the
   * user starts trimming the first while the rest are still arriving.
   */
  function ingestAssets(assets: EmbedAsset[]): Promise<void> {
    if (!assets.length) return Promise.resolve();
    queuedIngestBatches += 1;
    isIngesting.value = true;
    const batch = ingestQueue.then(() => ingestAssetsSequentially(assets));
    // Keep the queue alive after a failed batch so later host actions are not
    // poisoned by one bad URL.
    ingestQueue = batch
      .catch((error: unknown) => {
        log.warn('Asset ingest batch failed', error);
      })
      .finally(() => {
        queuedIngestBatches -= 1;
        isIngesting.value = queuedIngestBatches > 0;
      });
    return batch;
  }

  async function ingestAssetsSequentially(assets: EmbedAsset[]) {
    for (const asset of assets) {
      const suppliedId = asset.id;
      const assetId = suppliedId ?? `asset-${nextAssetSequence++}`;
      if (assetIds.has(assetId)) {
        bridge.value?.send('error', {
          code: 'asset-duplicate-id',
          message: `Asset ID ${assetId} already exists`,
        });
        continue;
      }
      assetIds.add(assetId);
      try {
        const transport = createTransport(asset, assetId);
        const contentType = await transport.getContentType();
        const placement = resolveAssetPlacement(
          { url: asset.url ?? '', type: asset.kind, filename: asset.filename },
          contentType,
        );
        const fileHandle = await projectStore.getProjectFileHandleByRelativePath({
          relativePath: placement.relativePath,
          create: true,
        });
        if (!fileHandle) throw new Error(`Cannot create ${placement.relativePath}`);

        try {
          await downloadAssetToFile({
            transport,
            fileHandle,
            onProgress: (loadedBytes, totalBytes) => {
              bridge.value?.send('asset:progress', { assetId, loadedBytes, totalBytes });
            },
            signal: sessionAbortController.signal,
          });
        } finally {
          transport.dispose();
        }

        // Placement is sequential from the playhead, so the first asset starts
        // at the timeline head and each later one lands after it.
        const startTicks =
          asset.startAt === undefined
            ? assetCount.value === 0
              ? 0
              : timelineStore.duration
            : secondsToTicksClamped(asset.startAt);
        timelineStore.setCurrentTimeTicks(startTicks);
        const wasAdded = await addMediaToTimeline(
          [{ name: placement.filename, path: placement.relativePath }],
          {
            targetTrackId: asset.track,
            notifyRedirect: false,
          },
        );
        if (!wasAdded) throw new Error(`Cannot place ${assetId} on the timeline`);
        assetCount.value += 1;
      } catch (e) {
        assetIds.delete(assetId);
        log.error(`Failed to import asset ${assetId}`, e);
        bridge.value?.send('error', {
          code: 'asset-failed',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!assetCount.value) throw new Error('None of the supplied assets could be loaded');
  }

  async function initSession(payload: EmbedInitPayload) {
    if (phase.value !== 'handshake') {
      log.warn('Ignoring a second init for an already initialised session');
      return;
    }

    phase.value = 'loading';
    try {
      if (payload.locale) locale.value = payload.locale;
      layoutPreference.value = payload.layout ?? 'auto';
      outputMode.value = payload.output ?? 'blob';
      assetTransport.value = payload.assetTransport ?? 'url';
      setEmbedFeatures(payload.features);

      // Reclaim whatever earlier sessions left behind before adding to it. This
      // is the only cleanup path that survives a crashed or killed tab.
      const reclaimed = await collectAbandonedSessions(sessionId);
      reclaimedSessions.value = reclaimed.length;
      if (reclaimed.length) log.log(`Reclaimed ${reclaimed.length} abandoned session(s)`);

      // Lock first, register second: the collector treats "registered but
      // unlocked" as dead, so the reverse order would leave a window where a
      // concurrent tab could sweep a session that is still starting up.
      releaseSessionLock = await acquireSessionLock(sessionId);
      await registerSession(sessionId);
      stopHeartbeat = startSessionHeartbeat(sessionId);

      await workspaceStore.initAutomaticWorkspace(embedSessionDirPath(sessionId));
      if (!workspaceStore.workspaceHandle) {
        throw new Error(workspaceStore.error ?? 'Failed to open the embedded workspace');
      }

      // Nothing here outlives the session, so the persistence machinery built
      // for real projects is dead weight: rotating backups would fill the very
      // directory the session deletes on the way out, and the host is the one
      // holding the timeline (as OTIO) between visits.
      workspaceStore.userSettings.backup.enabled = false;
      workspaceStore.userSettings.openLastProjectOnStart = false;
      // Applied after the workspace has loaded its defaults so the host's stored
      // values win, and before the project opens so hotkeys and snapping are
      // already the user's by the time anything is on screen.
      applySyncedSettings(workspaceStore.userSettings, payload.preferences);

      // The host usually knows the target format before the first clip does —
      // a story is 9:16 whatever the source footage happens to be.
      await projectStore.createProject(EMBED_PROJECT_NAME, payload.projectDefaults);
      await openProject(EMBED_PROJECT_NAME);
      if (!projectStore.currentProjectName) {
        throw new Error('Failed to create the embedded session project');
      }

      if (payload.initialProject) {
        const timelinePath = projectStore.currentTimelinePath;
        if (!timelinePath) throw new Error('Embedded project has no timeline to restore');
        // Runtime protocol validation already checked Timeline.1. Writing it
        // before ingest means any clips whose media is supplied below resolve
        // against the final session workspace; unresolved references remain
        // visibly offline instead of being silently replaced.
        await projectStore.writeTextByPath(timelinePath, payload.initialProject.otio);
        await timelineStore.loadTimeline();
      }

      await ingestAssets(payload.assets ?? []);

      // `initialized` waits for the shell to pick a layout (see the watcher
      // below): the host is told which one it got, and that is only known once
      // the editor root has measured its container.
      phase.value = 'ready';
    } catch (e) {
      fail('init-failed', e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadExport(file: File, uploadUrl: string) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: file.type ? { 'Content-Type': file.type } : undefined,
    });
    if (!response.ok) throw new Error(`Upload rejected with HTTP ${response.status}`);
  }

  async function startExport(options?: { filename?: string; uploadUrl?: string }) {
    if (phase.value !== 'ready' || hasUnacknowledgedExport.value) {
      log.warn('Ignoring export request in phase', phase.value);
      return;
    }

    phase.value = 'exporting';
    try {
      await exportForm.initializeExportForm();
      if (options?.filename) exportForm.outputFilename.value = options.filename;

      await exportForm.handleStartExport(async (file: File) => {
        exportedFilename = file.name;

        // Described from the finished file rather than the export settings, so
        // what the host records cannot disagree with the bytes it receives.
        const { meta, poster } = await summariseExport(file);
        const doc = timelineStore.timelineDoc;
        const otio = doc ? serializeTimelineToOtio(doc) : '';

        if (outputMode.value === 'upload') {
          if (!options?.uploadUrl) throw new Error('Upload mode requires an uploadUrl');
          // Streams straight out of storage to the host's endpoint, so a render
          // too large to hand across the channel never enters it.
          await uploadExport(file, options.uploadUrl);
          bridge.value?.send('export:done', { poster, otio, meta });
          await acknowledgeExport();
          return;
        }

        // `File` crosses the boundary by reference to its backing store, so the
        // host streams it straight out of OPFS without the bytes ever being
        // materialised in either page's heap.
        pendingExportAck = new Promise<void>((resolve) => {
          exportAck = resolve;
        });
        hasUnacknowledgedExport.value = true;
        bridge.value?.send('export:done', { file, poster, otio, meta });
        exportAckTimer = setTimeout(() => {
          bridge.value?.send('error', {
            code: 'protocol-timeout',
            message: 'The host did not acknowledge the exported file in time.',
          });
          void acknowledgeExport();
        }, EXPORT_ACK_TIMEOUT_MS);
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

  /** Lets the editor's own close control reach the host, which owns the frame. */
  function requestClose() {
    bridge.value?.send('requestClose', undefined);
  }

  /**
   * Tells the host the frame is too short to work in. Advisory only — the host
   * owns its own layout — but without it an editor squeezed into a 200px slot
   * has no way to say so, and the user just sees a broken screen.
   */
  function requestResize(minHeightPx: number) {
    bridge.value?.send('resize-request', { minHeightPx });
  }

  /**
   * The host has finished reading the exported file, so the copy the session
   * kept alive for it can go. Held separately from `dispose` because a host may
   * keep editing after taking one render.
   */
  async function acknowledgeExport() {
    if (exportAckTimer) clearTimeout(exportAckTimer);
    exportAckTimer = null;
    exportAck?.();
    exportAck = null;
    pendingExportAck = null;
    hasUnacknowledgedExport.value = false;

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
    sessionAbortController.abort();
    if (exportAckTimer) clearTimeout(exportAckTimer);
    // Flush anything still sitting behind a debounce: this is the host's last
    // chance to keep the user's work and preferences.
    if (preferencesTimer) clearTimeout(preferencesTimer);
    if (changeTimer) clearTimeout(changeTimer);
    emitPreferences();
    emitChange();

    registerHostRpc(null);
    const farewellBridge = bridge.value;

    // The host may issue dispose as soon as it sees export:done. Keep OPFS
    // alive until it confirms the File has actually been consumed.
    // A host can dispose from inside its export callback. Do not wait for an
    // acknowledgement which now cannot arrive; release the file ourselves.
    await acknowledgeExport();
    await ingestQueue;

    stopHeartbeat?.();
    stopHeartbeat = null;

    try {
      await resetProjectState();
      await workspaceStore.wipeWorkspace();
      workspaceStore.resetWorkspace();
      await removeSession(sessionId);
    } catch (e) {
      log.warn('Failed to clean up the embedded session', e);
    } finally {
      // Released last: while it is held, another tab's collector treats this
      // session as alive and leaves its directory alone.
      releaseSessionLock?.();
      releaseSessionLock = null;

      // Announced only once the storage is actually gone, so a host that waits
      // for it knows the session left nothing behind.
      farewellBridge?.send('disposed', undefined);
      farewellBridge?.stop();
      bridge.value = null;
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
    created.on('asset:url', ({ assetId, url }) => {
      pendingUrlRefreshes.get(assetId)?.(url);
      pendingUrlRefreshes.delete(assetId);
    });
    created.on('rpc:result', ({ requestId, result, error }) =>
      settleHostRpc(requestId, { result, error }),
    );
    created.on('save:request', () => emitChange());
    created.on('asset:add', ({ assets }) => void ingestAssets(assets));
    created.on('export:cancel', () => void exportForm.cancelExport());
    created.on('export:ack', () => void acknowledgeExport());
    created.on('dispose', () => void dispose());

    registerHostRpc((channel, requestId, payload) => {
      created.send(channel === 'stt' ? 'stt:request' : 'llm:request', { requestId, payload });
    });

    void detectCapabilities().then((capabilities) => {
      created.send('ready', { version: EMBED_PROTOCOL_VERSION, capabilities });
    });
  }

  let preferencesTimer: ReturnType<typeof setTimeout> | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;

  function emitPreferences() {
    bridge.value?.send('preferences:changed', extractSyncedSettings(workspaceStore.userSettings));
  }

  function emitChange() {
    const doc = timelineStore.timelineDoc;
    if (!doc) return;
    try {
      bridge.value?.send('change', {
        dirty: timelineStore.isTimelineDirty,
        otio: serializeTimelineToOtio(doc),
      });
    } catch (e) {
      log.warn('Failed to serialise the timeline for the host', e);
    }
  }

  watch(
    () => workspaceStore.userSettings,
    () => {
      if (phase.value === 'handshake' || phase.value === 'loading') return;
      if (preferencesTimer) clearTimeout(preferencesTimer);
      preferencesTimer = setTimeout(emitPreferences, PREFERENCES_DEBOUNCE_MS);
    },
    { deep: true },
  );

  watch(
    () => [timelineStore.timelineDoc, timelineStore.isTimelineDirty] as const,
    () => {
      if (phase.value !== 'ready' && phase.value !== 'exporting') return;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(emitChange, CHANGE_DEBOUNCE_MS);
    },
    { deep: true },
  );

  let hasAnnouncedInit = false;
  watch(
    () => [phase.value, resolvedLayoutMode.value] as const,
    ([currentPhase, layout]) => {
      if (hasAnnouncedInit || currentPhase !== 'ready' || !layout) return;
      hasAnnouncedInit = true;
      bridge.value?.send('initialized', {
        assetCount: assetCount.value,
        durationMs: Math.round(ticksToSeconds(timelineStore.duration) * 1000),
        layout,
        reclaimedSessions: reclaimedSessions.value,
      });
    },
    { immediate: true },
  );

  watch(
    () => [exportForm.exportPhase.value, exportForm.exportProgress.value] as const,
    ([exportPhase, progress]) => {
      if (phase.value !== 'exporting') return;
      bridge.value?.send('export:progress', { phase: exportPhase, progress });
    },
  );

  onScopeDispose(() => {
    if (preferencesTimer) clearTimeout(preferencesTimer);
    if (changeTimer) clearTimeout(changeTimer);
    registerHostRpc(null);
    bridge.value?.stop();
    stopHeartbeat?.();
    releaseSessionLock?.();
  });

  return {
    phase,
    errorMessage,
    assetCount,
    reclaimedSessions,
    layoutPreference,
    outputMode,
    assetTransport,
    canExport,
    requestClose,
    requestResize,
    isIngesting,
    start,
    startExport,
    dispose,
  };
}
