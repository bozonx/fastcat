import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

import { createAutoSave } from '~/utils/auto-save';
import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  DEFAULT_MONITOR_VIEW_SETTINGS,
  type FastCatProjectSettings,
  type MonitorSettings,
  type MonitorViewSettings,
  type ProjectMonitorSettings,
} from '~/utils/project-settings';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import {
  createProjectUiRepository,
  type ProjectUiRepository,
} from '~/repositories/project-ui.repository';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';
import type { ProjectMeta } from '~/repositories/project-meta.repository';
import type { EditorView } from '~/stores/editor-view.store';
import { useFocusStore } from './focus.store';
import { useProjectTabsStore } from './project-tabs.store';
import { useTimelineStore } from './timeline.store';
import {
  useFileManagerStore,
  useFilesPageFileManagerStore,
  useFilesPageSidebarFileManagerStore,
} from './file-manager.store';

interface ProjectSettingsRepo {
  load(): Promise<unknown | null>;
  save(data: FastCatProjectSettings): Promise<void>;
}

export function applyLoadedTimelineSessionSnapshot(
  timelines: FastCatProjectSettings['timelines'],
  input: {
    activeTimelinePath: string | null;
    timelineDoc: unknown | null;
    currentTime: number;
    masterGain: number;
    masterMuted: boolean;
    zoom: number;
    trackHeights: Record<string, number>;
    selectionRange?: { startUs: number; endUs: number } | null;
  },
): FastCatProjectSettings['timelines'] {
  if (!input.activeTimelinePath || !input.timelineDoc) {
    return {
      ...timelines,
      sessions: { ...timelines.sessions },
    };
  }

  return {
    ...timelines,
    sessions: {
      ...timelines.sessions,
      [input.activeTimelinePath]: {
        playheadUs: input.currentTime,
        masterGain: input.masterGain,
        masterMuted: input.masterMuted,
        zoom: input.zoom,
        trackHeights: { ...input.trackHeights },
        selectionRange: input.selectionRange ? { ...input.selectionRange } : undefined,
      },
    },
  };
}

export const useProjectSettingsStore = defineStore('projectSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const projectSettingsRepo = ref<ProjectSettingsRepo | null>(null);
  const projectUiRepo = ref<ProjectUiRepository | null>(null);

  const projectSettings = ref<FastCatProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings),
  );
  const isLoadingProjectSettings = ref(false);
  const isSavingProjectSettings = ref(false);
  const projectSettingsSaveError = ref<string | null>(null);

  const getProjectDirHandle = ref<(() => Promise<FileSystemDirectoryHandle | null>) | null>(null);
  const getCurrentProjectName = ref<(() => string | null) | null>(null);
  const getIsReadOnly = ref<(() => boolean) | null>(null);
  const getProjectMeta = ref<(() => ProjectMeta | null) | null>(null);
  const saveProjectMeta = ref<((updates: Partial<ProjectMeta>) => Promise<void>) | null>(null);
  const getCurrentEditorView = ref<(() => EditorView) | null>(null);
  const getLastViewBeforeFullscreen = ref<(() => EditorView | null) | null>(null);

  const PROJECT_MONITOR_KEYS = new Set<keyof ProjectMonitorSettings>([
    'previewResolution',
    'useProxy',
    'previewEffectsEnabled',
    'showGrid',
    'showTimecode',
    'toolbarPosition',
  ]);

  const activeMonitorView = computed<MonitorViewSettings>(() => {
    const view = getCurrentEditorView.value?.() ?? 'cut';
    const lastViewBeforeFullscreen = getLastViewBeforeFullscreen.value?.() ?? null;
    const targetView = view === 'fullscreen' ? lastViewBeforeFullscreen || 'cut' : view;
    const safeView = ['cut', 'sound', 'export'].includes(targetView) ? targetView : 'cut';

    const platformSuffix = getPlatformSuffix();
    const platformViewKey = `${safeView}${platformSuffix}`;

    return (
      projectSettings.value.monitors[platformViewKey] ??
      projectSettings.value.monitors[safeView] ??
      projectSettings.value.monitors.cut
    );
  });

  /**
   * Facade for legacy consumers that access a single monitor object.
   * Per-view fields (pan/zoom) route to `monitors[view]`, project-wide fields
   * route to `monitor`.
   */
  const activeMonitor = computed<MonitorSettings>(() => {
    const viewRef = activeMonitorView.value;
    const projectRef = projectSettings.value.monitor;
    return new Proxy({} as MonitorSettings, {
      get(_t, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        if (prop in viewRef) return (viewRef as unknown as Record<string, unknown>)[prop];
        if (prop in projectRef) return (projectRef as unknown as Record<string, unknown>)[prop];
        return undefined;
      },
      set(_t, prop: string | symbol, value) {
        if (typeof prop !== 'string') return false;
        if (PROJECT_MONITOR_KEYS.has(prop as keyof ProjectMonitorSettings)) {
          (projectRef as unknown as Record<string, unknown>)[prop] = value;
          return true;
        }
        if (prop === 'panX' || prop === 'panY' || prop === 'zoom') {
          (viewRef as unknown as Record<string, unknown>)[prop] = value;
          return true;
        }
        return true;
      },
      has(_t, prop) {
        return typeof prop === 'string' && (prop in viewRef || prop in projectRef);
      },
      ownKeys() {
        return [...Object.keys(viewRef), ...Object.keys(projectRef)];
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in viewRef || prop in projectRef) {
          return { configurable: true, enumerable: true, writable: true, value: undefined };
        }
        return undefined;
      },
    });
  });

  const autoSave = createAutoSave({
    doSave: async () => {
      if (!workspaceStore.projectsHandle) return false;
      if (!getCurrentProjectName.value?.()) return false;
      if (isLoadingProjectSettings.value) return false;
      if (getIsReadOnly.value?.()) return false;

      isSavingProjectSettings.value = true;
      projectSettingsSaveError.value = null;
      try {
        await ensureRepo();

        // Save technical settings
        if (projectSettingsRepo.value) {
          await projectSettingsRepo.value.save(projectSettings.value);
        }

        // Save UI session settings
        if (projectUiRepo.value) {
          const focusStore = useFocusStore();
          const projectTabsStore = useProjectTabsStore();
          const timelineStore = useTimelineStore();

          const timelines = applyLoadedTimelineSessionSnapshot(projectSettings.value.timelines, {
            activeTimelinePath: focusStore.activeTimelinePath,
            timelineDoc: timelineStore.timelineDoc,
            currentTime: timelineStore.currentTime,
            masterGain: timelineStore.masterGain,
            masterMuted: timelineStore.audioMuted ?? false,
            zoom: timelineStore.timelineZoom,
            trackHeights: timelineStore.trackHeights,
            selectionRange: timelineStore.selectionRange,
          });

          const fileManagerPaths: Record<string, string | null> = {};
          const internalFmStores = {
            editor: useFileManagerStore(),
            filesPage: useFilesPageFileManagerStore(),
            'filesPage-sidebar': useFilesPageSidebarFileManagerStore(),
          };

          for (const [key, store] of Object.entries(internalFmStores)) {
            fileManagerPaths[key] = store.selectedFolder?.path ?? null;
          }

          await projectUiRepo.value.save({
            version: 1,
            monitor: projectSettings.value.monitor,
            monitors: projectSettings.value.monitors,
            timelines: {
              openPaths: timelines.openPaths,
              sessions: timelines.sessions,
            },
            ui: {
              activeTabId: projectTabsStore.activeTabId,
              fileTabs: projectTabsStore.fileTabs,
              staticTabsOrder: projectTabsStore.staticTabsOrder,
              fileManagerPaths,
              layout: {
                cutPanels: null,
                soundPanels: null,
                splitSizes: {},
                verticalSplitSizes: {},
                timelineHeights: {},
              },
            },
          });
        }
      } catch (e: unknown) {
        projectSettingsSaveError.value = e instanceof Error ? e.message : 'Unknown error occurred';
        throw e;
      } finally {
        isSavingProjectSettings.value = false;
      }
    },
    onError: (e) => {
      console.warn('Failed to save project settings', e);
    },
  });

  function setContext(input: {
    getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
    getCurrentProjectName: () => string | null;
    getIsReadOnly: () => boolean;
    getProjectMeta: () => ProjectMeta | null;
    saveProjectMeta: (updates: Partial<ProjectMeta>) => Promise<void>;
    getCurrentEditorView: () => EditorView;
    getLastViewBeforeFullscreen: () => EditorView | null;
  }) {
    getProjectDirHandle.value = input.getProjectDirHandle;
    getCurrentProjectName.value = input.getCurrentProjectName;
    getIsReadOnly.value = input.getIsReadOnly;
    getProjectMeta.value = input.getProjectMeta;
    saveProjectMeta.value = input.saveProjectMeta;
    getCurrentEditorView.value = input.getCurrentEditorView;
    getLastViewBeforeFullscreen.value = input.getLastViewBeforeFullscreen;
  }

  function closeProjectSettings() {
    autoSave.reset();
    isLoadingProjectSettings.value = false;
    isSavingProjectSettings.value = false;
    projectSettingsRepo.value = null;
    projectUiRepo.value = null;

    projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
  }

  function markProjectSettingsAsDirty() {
    autoSave.markDirty();
  }

  function markProjectSettingsAsCleanForCurrentRevision() {
    autoSave.markCleanForCurrentRevision();
  }

  async function ensureRepo(): Promise<void> {
    if (projectSettingsRepo.value && projectUiRepo.value) return;

    const dir = await getProjectDirHandle.value?.();
    if (dir) {
      if (!projectSettingsRepo.value) {
        projectSettingsRepo.value = createProjectSettingsRepository({ projectDir: dir });
      }
      if (!projectUiRepo.value) {
        projectUiRepo.value = createProjectUiRepository({ projectDir: dir });
      }
    }
  }

  async function projectFileExists(path: string): Promise<boolean> {
    const dir = await getProjectDirHandle.value?.();
    if (!dir) return false;

    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return false;

    try {
      let currentDir = dir;
      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part);
      }
      await currentDir.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  }

  async function loadProjectSettings() {
    isLoadingProjectSettings.value = true;

    projectSettingsRepo.value = null;
    projectUiRepo.value = null;
    await ensureRepo();

    try {
      const settings = createDefaultProjectSettings(workspaceStore.userSettings);

      // Load technical settings
      if (projectSettingsRepo.value) {
        const repo = projectSettingsRepo.value as ProjectSettingsRepo;
        const raw = await repo.load();
        if (raw) {
          const normalized = normalizeProjectSettings(raw, workspaceStore.userSettings);
          Object.assign(settings, normalized);
        }
      }

      // Load UI session settings
      if (projectUiRepo.value) {
        const repo = projectUiRepo.value as ProjectUiRepository;
        const uiRaw = await repo.load();
        if (uiRaw) {
          // Legacy migration: lift project-wide fields out of per-monitor entries
          // into the shared `monitor` block when `monitor` is missing.
          const inheritedProjectMonitor = (() => {
            if (uiRaw.monitor) return { ...settings.monitor, ...uiRaw.monitor };
            const firstMonitor = (uiRaw.monitors as Record<string, unknown> | undefined)
              ? (Object.values(uiRaw.monitors) as Array<Record<string, unknown> | undefined>)[0]
              : undefined;
            if (!firstMonitor) return settings.monitor;
            const lift: Partial<typeof settings.monitor> = {};
            for (const key of Object.keys(settings.monitor) as Array<
              keyof typeof settings.monitor
            >) {
              const v = firstMonitor[key as string];
              if (v !== undefined) (lift as Record<string, unknown>)[key as string] = v;
            }
            return { ...settings.monitor, ...lift };
          })();
          settings.monitor = inheritedProjectMonitor;

          if (uiRaw.monitors) {
            const next: Record<string, MonitorViewSettings> = { ...settings.monitors };
            for (const key of Object.keys(uiRaw.monitors)) {
              const patch = uiRaw.monitors[key] as Record<string, unknown> | undefined;
              if (!patch || typeof patch !== 'object') continue;
              const base = next[key] ?? settings.monitors.cut ?? DEFAULT_MONITOR_VIEW_SETTINGS;
              next[key] = {
                panX: typeof patch.panX === 'number' ? patch.panX : base.panX,
                panY: typeof patch.panY === 'number' ? patch.panY : base.panY,
                zoom: typeof patch.zoom === 'number' ? patch.zoom : base.zoom,
              };
            }
            settings.monitors = next;
          }

          if (uiRaw.timelines) {
            settings.timelines = { ...settings.timelines, ...uiRaw.timelines };

            // Validate openPaths exist and normalize
            const validatedPaths: string[] = [];
            for (const path of settings.timelines.openPaths) {
              if (await projectFileExists(path)) {
                validatedPaths.push(path);
              }
            }
            settings.timelines.openPaths = validatedPaths;
          }

          if (uiRaw.ui) {
            settings.ui = { ...settings.ui, ...uiRaw.ui };
          }
        }
      }

      projectSettings.value = settings;

      // Sync loaded state to other stores
      const projectTabsStore = useProjectTabsStore();
      projectTabsStore.setTabsState({
        activeTabId: settings.ui.activeTabId,
        fileTabs: settings.ui.fileTabs,
        staticTabsOrder: settings.ui.staticTabsOrder,
      });

      const internalFmStores = {
        editor: useFileManagerStore(),
        filesPage: useFilesPageFileManagerStore(),
        'filesPage-sidebar': useFilesPageSidebarFileManagerStore(),
      };

      for (const [key, store] of Object.entries(internalFmStores)) {
        const savedPath = settings.ui.fileManagerPaths[key];
        if (savedPath && (!store.selectedFolder || store.selectedFolder.path !== savedPath)) {
          store.openFolderByPath(savedPath);
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name === 'NotFoundError') {
        projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
        return;
      }

      console.warn('Failed to load project settings, fallback to defaults', e);
      projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
    } finally {
      isLoadingProjectSettings.value = false;
      autoSave.reset();
      markProjectSettingsAsCleanForCurrentRevision();
    }
  }

  // Watch for volatile timeline UI state changes to ensure they are saved to project.ui.json
  // even if they are the only fields changing.
  watch(
    () => {
      const timelineStore = useTimelineStore();
      return [
        timelineStore.currentTime,
        timelineStore.timelineZoom,
        timelineStore.masterGain,
        timelineStore.audioMuted,
        timelineStore.trackHeights,
        timelineStore.selectionRange,
      ];
    },
    () => {
      if (isLoadingProjectSettings.value) return;
      markProjectSettingsAsDirty();
      // We don't need to call requestProjectSettingsSave(immediate: true) here
      // as markProjectSettingsAsDirty will eventually trigger debounced save
      // or we can call it without immediate for 500ms debounce.
      void requestProjectSettingsSave();
    },
    { deep: true },
  );

  async function requestProjectSettingsSave(options?: { immediate?: boolean }) {
    await autoSave.requestSave(options);
  }

  async function saveProjectSettings() {
    await requestProjectSettingsSave({ immediate: true });
  }

  async function saveInitialProjectSettingsForNewProject(options: {
    projectDir: FileSystemDirectoryHandle;
  }) {
    projectSettingsRepo.value = createProjectSettingsRepository({ projectDir: options.projectDir });
    projectUiRepo.value = createProjectUiRepository({ projectDir: options.projectDir });

    const initial = createDefaultProjectSettings(workspaceStore.userSettings);
    projectSettings.value = initial;

    try {
      await projectSettingsRepo.value.save(projectSettings.value);
      await projectUiRepo.value.save({
        version: 1,
        monitors: initial.monitors,
        timelines: {
          openPaths: initial.timelines.openPaths,
          sessions: initial.timelines.sessions,
        },
        ui: initial.ui as ProjectUiLayoutState,
      });
    } catch (e) {
      console.warn('Failed to create project settings/ui files', e);
    }

    autoSave.reset();
    markProjectSettingsAsCleanForCurrentRevision();
  }

  watch(
    projectSettings,
    () => {
      if (isLoadingProjectSettings.value) return;
      markProjectSettingsAsDirty();
      void requestProjectSettingsSave();
    },
    { deep: true, flush: 'sync' },
  );

  // Ensure platform-specific monitor exists
  watch(
    [
      () => getPlatformSuffix(),
      () => getCurrentEditorView.value?.(),
      () => isLoadingProjectSettings.value,
    ],
    ([suffix, view, loading]) => {
      if (loading || !suffix) return;
      const targetView = view ?? 'cut';
      const safeView = ['cut', 'sound', 'export'].includes(targetView) ? targetView : 'cut';
      const key = `${safeView}${suffix}`;
      if (!projectSettings.value.monitors[key]) {
        const base =
          projectSettings.value.monitors[safeView] ??
          projectSettings.value.monitors.cut ??
          DEFAULT_MONITOR_VIEW_SETTINGS;
        projectSettings.value.monitors[key] = { ...base };
      }
    },
    { immediate: true },
  );

  return {
    projectSettings,
    isLoadingProjectSettings,
    isSavingProjectSettings,
    projectSettingsSaveError,
    setContext,
    closeProjectSettings,
    loadProjectSettings,
    saveProjectSettings,
    requestProjectSettingsSave,
    saveInitialProjectSettingsForNewProject,
    activeMonitor,
    activeMonitorView,
  };
});
