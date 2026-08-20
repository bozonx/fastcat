import type { Page } from '@playwright/test';

export interface AudioDecodeProbeResult {
  ok: boolean;
  durationSec: number;
  sampleRate: number;
  channels: number;
  rms: number;
  peak: number;
  error?: string;
}

export interface AudioPlaybackProbeOptions {
  path: string;
  masterGain?: number;
  durationMs?: number;
}

export interface AudioPlaybackProbeResult {
  ok: boolean;
  inputRms: number;
  inputPeak: number;
  outputRms: number;
  outputPeak: number;
  contextState: AudioContextState;
  error?: string;
}

interface AudioProbeWindow {
  __audioProbe?: {
    probeFile: (path: string) => Promise<AudioDecodeProbeResult>;
    playDecodedSample: (options: AudioPlaybackProbeOptions) => Promise<AudioPlaybackProbeResult>;
  };
}

export async function waitForAudioProbe(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as AudioProbeWindow).__audioProbe !== 'undefined',
  );
}

export async function probeAudioFile(page: Page, path: string): Promise<AudioDecodeProbeResult> {
  return await page.evaluate(async (opfsPath) => {
    const probe = (window as unknown as AudioProbeWindow).__audioProbe;
    if (!probe) throw new Error('__audioProbe is not installed');
    return await probe.probeFile(opfsPath);
  }, path);
}

export async function playAudioSample(
  page: Page,
  options: AudioPlaybackProbeOptions,
): Promise<AudioPlaybackProbeResult> {
  return await page.evaluate(async (playbackOptions) => {
    const probe = (window as unknown as AudioProbeWindow).__audioProbe;
    if (!probe) throw new Error('__audioProbe is not installed');
    return await probe.playDecodedSample(playbackOptions);
  }, options);
}
