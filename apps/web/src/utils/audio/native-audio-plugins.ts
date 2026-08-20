import { getPlatformCapabilities } from '~/utils/capabilities';
import type { AudioPluginDescriptor } from '~/types/generated/native-monitor/AudioPluginDescriptor';
import type { AudioPluginFormat } from '~/types/generated/native-monitor/AudioPluginFormat';
import type { AudioPluginScanRequest } from '~/types/generated/native-monitor/AudioPluginScanRequest';
import type { AudioPluginScanResult } from '~/types/generated/native-monitor/AudioPluginScanResult';
import type { AudioPluginStatus } from '~/types/generated/native-monitor/AudioPluginStatus';
import type { AudioPluginStatusCode } from '~/types/generated/native-monitor/AudioPluginStatusCode';

export type NativeAudioPluginDescriptor = AudioPluginDescriptor;
export type NativeAudioPluginFormat = AudioPluginFormat;
export type NativeAudioPluginScanRequest = AudioPluginScanRequest;
export type NativeAudioPluginScanResult = AudioPluginScanResult;
export type NativeAudioPluginStatus = AudioPluginStatus;
export type NativeAudioPluginStatusCode = AudioPluginStatusCode;

export function createEmptyNativeAudioPluginScanResult(): NativeAudioPluginScanResult {
  return {
    plugins: [],
    scannedPaths: [],
  };
}

export async function scanNativeAudioPlugins(
  request: NativeAudioPluginScanRequest,
): Promise<NativeAudioPluginScanResult> {
  if (!getPlatformCapabilities().nativeAudioPlugins) {
    return createEmptyNativeAudioPluginScanResult();
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeAudioPluginScanResult>('native_audio_plugins_scan', { request });
}

export async function listNativeAudioPlugins(): Promise<NativeAudioPluginScanResult> {
  if (!getPlatformCapabilities().nativeAudioPlugins) {
    return createEmptyNativeAudioPluginScanResult();
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeAudioPluginScanResult>('native_audio_plugins_list');
}
