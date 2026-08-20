import { clampNumber } from '~/utils/math';

export function clampAudioParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  return clampNumber(value, min, max) ?? defaultValue;
}

/** Lowest/highest user-facing monitor/listening gain multiplier. */
export const GAIN_MIN = 0;
export const GAIN_MAX = 2;

/**
 * Clamp a monitor/listening volume multiplier to the shared `[0, 2]` range. This
 * is a playback-only level (how loud you hear the mix) and is not baked into the
 * exported file, so it is not subject to the master limiter. Non-finite input
 * falls back to unity gain so a bad value can never silence or blow up the output.
 *
 * The master gain (which IS baked into the output) uses the tighter
 * {@link sanitizeMasterGain} bound instead.
 */
export function clampGain(volume: unknown): number {
  return clampAudioParam(volume, GAIN_MIN, GAIN_MAX, 1);
}

/**
 * Upper bound for master gain (~+18 dB). Above this the soft-clip limiter would
 * simply flatten the entire mix into distortion, so we cap rather than trust an
 * arbitrarily large value coming from the UI / scene payload.
 *
 * Cross-engine parity contract: mirrors the native `sanitize_master_gain`
 * (src-tauri/src/audio/mix.rs, `MAX_MASTER_GAIN`), pinned by
 * `shared/parity/audio-master-gain.cases.json`. User-facing monitor/master
 * controls are intentionally tighter and top out at 200%, so this cap mostly
 * protects old project data and out-of-range scene payloads.
 */
export const MASTER_GAIN_MAX = 8;

/**
 * Clamp a master gain multiplier (baked into the rendered/exported mix) to
 * `[0, 8]`, mapping any non-finite value to unity gain. Identical contract on the
 * web and native audio engines.
 */
export function sanitizeMasterGain(gain: unknown): number {
  return clampAudioParam(gain, GAIN_MIN, MASTER_GAIN_MAX, 1);
}
