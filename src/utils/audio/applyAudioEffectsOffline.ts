import { buildAudioEffectGraph } from '~/utils/audio/effectGraph';

/**
 * Audio effects processing via native Web Audio API.
 * Uses OfflineAudioContext so it works both in the main thread (preview)
 * and in Web Workers (export). This is the single source of truth for all
 * audio effect rendering — do not add a second implementation.
 */

export interface AudioEffectData {
  id: string;
  type: string;
  enabled: boolean;
  target?: string;
  [key: string]: unknown;
}

export interface ApplyAudioEffectsParams {
  buffer: AudioBuffer;
  effects: AudioEffectData[];
}

export interface ApplyAudioEffectsOfflineParams {
  planes: Float32Array[];
  sampleRate: number;
  frames: number;
  channels: number;
  effects: AudioEffectData[];
}

export interface ApplyAudioEffectsOfflineResult {
  planes: Float32Array[];
  frames: number;
}

/**
 * Applies enabled audio effects to an AudioBuffer via OfflineAudioContext.
 * Used by AudioEngine (preview path, main thread).
 * Returns a new AudioBuffer with effects applied, or the original if none apply.
 */
export async function applyAudioEffects({
  buffer,
  effects,
}: ApplyAudioEffectsParams): Promise<AudioBuffer> {
  const enabledEffects = effects.filter((e) => e.enabled && e.target === 'audio');
  if (enabledEffects.length === 0 || buffer.duration <= 0) return buffer;

  const planes: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    planes.push(new Float32Array(buffer.getChannelData(c)));
  }

  const result = await applyEffectsThroughOfflineContext({
    planes,
    sampleRate: buffer.sampleRate,
    frames: buffer.length,
    channels: buffer.numberOfChannels,
    effects: enabledEffects,
  });

  const tmpCtx = new OfflineAudioContext(buffer.numberOfChannels, result.frames, buffer.sampleRate);
  const out = tmpCtx.createBuffer(buffer.numberOfChannels, result.frames, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const plane = result.planes[c];
    if (plane) out.copyToChannel(new Float32Array(plane), c, 0);
  }
  return out;
}

/**
 * Applies enabled audio effects to raw PCM planes via OfflineAudioContext.
 * Used by AudioMixer (export path, Web Worker).
 * Returns the processed planes. Falls back to original planes on error.
 */
export async function applyAudioEffectsOffline({
  planes,
  sampleRate,
  frames,
  channels,
  effects,
}: ApplyAudioEffectsOfflineParams): Promise<ApplyAudioEffectsOfflineResult> {
  const enabledEffects = effects.filter((e) => e.enabled && e.target === 'audio');
  if (enabledEffects.length === 0 || frames <= 0) {
    return { planes, frames };
  }

  try {
    return await applyEffectsThroughOfflineContext({
      planes,
      sampleRate,
      frames,
      channels,
      effects: enabledEffects,
    });
  } catch (err) {
    console.warn('[applyAudioEffectsOffline] Failed to apply effects, using raw audio', err);
    return { planes, frames };
  }
}

async function applyEffectsThroughOfflineContext({
  planes,
  sampleRate,
  frames,
  channels,
  effects,
}: ApplyAudioEffectsOfflineParams): Promise<ApplyAudioEffectsOfflineResult> {
  const OfflineCtx =
    globalThis.OfflineAudioContext ||
    (globalThis as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) {
    return { planes, frames };
  }

  const offlineCtx = new OfflineCtx(channels, frames, sampleRate);
  const buffer = offlineCtx.createBuffer(channels, frames, sampleRate);

  for (let c = 0; c < channels; c += 1) {
    const plane = planes[c];
    if (!plane) continue;
    buffer.copyToChannel(new Float32Array(plane), c, 0);
  }

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  const { outputNode, destroy } = buildAudioEffectGraph({
    audioContext: offlineCtx,
    sourceNode: source,
    effects,
  });

  outputNode.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();

  destroy();

  const currentPlanes: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) {
    currentPlanes.push(new Float32Array(rendered.getChannelData(c)));
  }

  return { planes: currentPlanes, frames: rendered.length };
}
