import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { registerEffect, unregisterEffect } from '~/effects/core/registry';
import { getPlatformCapabilities } from '~/utils/capabilities';
import {
  scanNativeAudioPlugins,
  type NativeAudioPluginDescriptor,
} from '~/utils/audio/native-audio-plugins';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('audioPluginsStore');

/**
 * A scanned CLAP descriptor id is `clap:<path-hash>:<clap-plugin-id>` (see the
 * Rust catalog). The native host needs the bare CLAP plugin id, so recover the
 * segment after the path hash — the plugin id itself may contain colons, so we
 * split only on the first one after the `clap:` prefix.
 */
function parseClapPluginId(descriptorId: string): string | null {
  const prefix = 'clap:';
  if (!descriptorId.startsWith(prefix)) return null;
  const rest = descriptorId.slice(prefix.length);
  const separator = rest.indexOf(':');
  if (separator < 0) return null;
  return rest.slice(separator + 1);
}

/**
 * Holds the result of native (CLAP/…) audio plugin scans and mirrors the
 * loadable plugins into the shared effect registry so they show up in the clip
 * effect picker and the audio effect library — but only while the feature is
 * enabled in settings. Registration attaches an `AudioPluginRef` via the
 * manifest's `defaultValues.plugin`, which `buildNativeAudioEffectSpecs` lifts
 * onto the native `AudioEffectSpec.plugin` so the CLAP host can locate the binary.
 */
export const useAudioPluginsStore = defineStore('audioPlugins', () => {
  const plugins = ref<NativeAudioPluginDescriptor[]>([]);
  const isScanning = ref(false);
  const error = ref<string | null>(null);
  /** Bumped whenever the effect registry is re-synced, so pickers recompute. */
  const registryVersion = ref(0);

  let registeredTypes: string[] = [];
  let initialized = false;

  function clearRegistered() {
    for (const type of registeredTypes) {
      unregisterEffect(type);
    }
    registeredTypes = [];
  }

  function syncRegistry() {
    clearRegistered();

    const workspace = useWorkspaceStore();
    if (workspace.userSettings.audioPlugins.enabled) {
      for (const plugin of plugins.value) {
        if (!plugin.isLoadable || plugin.format !== 'clap') continue;
        const pluginId = parseClapPluginId(plugin.id);
        if (!pluginId) continue;

        registerEffect({
          type: plugin.id,
          name: plugin.name,
          description: plugin.vendor ? `${plugin.vendor} · CLAP` : 'CLAP plugin',
          icon: 'i-heroicons-puzzle-piece',
          target: 'audio',
          category: 'artistic',
          defaultValues: {
            wet: 1,
            plugin: { format: 'clap', path: plugin.path, pluginId },
          },
          controls: [
            {
              kind: 'slider',
              key: 'wet',
              label: 'Wet',
              min: 0,
              max: 1,
              step: 0.01,
              format: (v) => `${Math.round(Number(v) * 100)}%`,
            },
          ],
        });
        registeredTypes.push(plugin.id);
      }
    }

    registryVersion.value += 1;
  }

  async function scan(): Promise<void> {
    if (!getPlatformCapabilities().nativeAudioPlugins || isScanning.value) return;

    const workspace = useWorkspaceStore();
    isScanning.value = true;
    error.value = null;
    try {
      const result = await scanNativeAudioPlugins({
        formats: workspace.userSettings.audioPlugins.enabledFormats,
        customPaths: workspace.userSettings.audioPlugins.customScanPaths,
        includeStandardPaths: true,
      });
      plugins.value = result.plugins;
    } catch (err) {
      log.error('Failed to scan native audio plugins:', err);
      error.value = err instanceof Error ? err.message : String(err);
      plugins.value = [];
    } finally {
      isScanning.value = false;
      syncRegistry();
    }
  }

  /** Scan once on first use if the feature is enabled and set to scan on startup. */
  async function ensureInit(): Promise<void> {
    if (initialized) return;
    initialized = true;
    if (!getPlatformCapabilities().nativeAudioPlugins) return;

    const settings = useWorkspaceStore().userSettings.audioPlugins;
    if (settings.enabled && settings.scanOnStartup) {
      await scan();
    } else {
      syncRegistry();
    }
  }

  // Turning the feature on/off (or off→on with nothing scanned yet) keeps the
  // pickers in sync: enabling with no scan result triggers a scan; otherwise we
  // just (de)register what we already have.
  watch(
    () => useWorkspaceStore().userSettings.audioPlugins.enabled,
    (enabled) => {
      if (enabled && plugins.value.length === 0 && getPlatformCapabilities().nativeAudioPlugins) {
        void scan();
      } else {
        syncRegistry();
      }
    },
  );

  return {
    plugins,
    isScanning,
    error,
    registryVersion,
    scan,
    syncRegistry,
    ensureInit,
  };
});
