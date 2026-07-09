/**
 * Shared playback-speed grid used by the monitor speed control and the
 * speed-cycle timeline hotkeys (F / D). Keeping a single source of truth
 * guarantees the hotkeys walk exactly the same steps the monitor UI exposes.
 */

/**
 * Positive playback speeds offered by the monitor speed menu, ascending.
 * Negative variants are derived from this list.
 */
export const PLAYBACK_SPEED_VALUES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 5];

/**
 * Full signed speed grid used for step traversal (mouse wheel + F/D hotkeys),
 * ordered from most-negative to most-positive. Zero is intentionally excluded
 * (transport speed can never be 0 — that would mean stopped).
 */
export const WHEEL_SPEED_VALUES: readonly number[] = [
  ...[...PLAYBACK_SPEED_VALUES].reverse().map((v) => -v),
  ...PLAYBACK_SPEED_VALUES,
];

/** Compact label for a signed transport speed (e.g. "1x", "-2x"). */
export function formatSpeedLabel(speed: number): string {
  const abs = Math.abs(speed);
  const prefix = speed < 0 ? '-' : '';
  return `${prefix}${abs}x`;
}

export type PlaybackSpeedStep = 'up' | 'down';

/**
 * Move one position along {@link WHEEL_SPEED_VALUES} from `currentSpeed`.
 *
 * Behaviour:
 * - If `currentSpeed` is not exactly on the grid, it is snapped to the nearest
 *   grid value in the step's direction before advancing, so off-grid values
 *   (e.g. a custom 1.3x) converge onto the grid.
 * - Clamped at the grid edges: 'up' stays at the max (5), 'down' at the min (-5).
 */
export function stepPlaybackSpeed(currentSpeed: number, step: PlaybackSpeedStep): number {
  const list = WHEEL_SPEED_VALUES;
  const exactIndex = list.indexOf(currentSpeed);

  if (exactIndex >= 0) {
    const next = step === 'up' ? exactIndex + 1 : exactIndex - 1;
    return list[Math.min(list.length - 1, Math.max(0, next))]!;
  }

  // Off-grid: snap to the nearest grid neighbour in the step direction.
  if (step === 'up') {
    const above = list.find((v) => v > currentSpeed);
    return above ?? list[list.length - 1]!;
  }
  const below = [...list].reverse().find((v) => v < currentSpeed);
  return below ?? list[0]!;
}
