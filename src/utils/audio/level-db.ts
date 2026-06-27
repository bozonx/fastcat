/**
 * Level-meter amplitude → dBFS conversion, shared by every `IAudioEngine`'s
 * `getLevels`. The native engine (src-tauri/src/audio/mix.rs `linear_to_level_db`)
 * computes the same value before emitting levels over IPC, so the web and Tauri
 * meters read identically for the same signal. Pinned cross-engine by
 * `shared/parity/audio-level-db.cases.json`.
 */

/** dBFS value reported for silence / sub-threshold levels (meter bottom). */
export const LEVEL_DB_FLOOR = -60;

/** Amplitudes at or below this collapse to {@link LEVEL_DB_FLOOR} instead of
 *  diving toward -∞ dB, keeping an idle meter pinned at the floor. */
export const LEVEL_DB_SILENCE_THRESHOLD = 0.001;

/**
 * Converts a non-negative linear amplitude (an RMS or peak of |samples|) to
 * dBFS. Values strictly above {@link LEVEL_DB_SILENCE_THRESHOLD} map to
 * `20·log10(value)`; everything at or below (incl. 0 and non-finite, which fail
 * the comparison) returns {@link LEVEL_DB_FLOOR}.
 */
export function linearToLevelDb(value: number): number {
  return value > LEVEL_DB_SILENCE_THRESHOLD ? 20 * Math.log10(value) : LEVEL_DB_FLOOR;
}
