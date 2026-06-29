import { clampNumber } from '~/utils/math';

export function clampAudioParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  return clampNumber(value, min, max) ?? defaultValue;
}

/** Lowest/highest output-gain multiplier accepted by both audio engines. */
export const GAIN_MIN = 0;
export const GAIN_MAX = 10;

/**
 * Clamp a monitor/listening volume multiplier to the shared `[0, 10]` range. This
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
 * `shared/parity/audio-master-gain.cases.json`. The master-gain UI slider tops
 * out at +12 dB (≈3.98×), so this cap only ever engages for an out-of-range
 * payload value — but it must engage identically on both engines.
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
