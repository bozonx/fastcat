/**
 * Shared playback-speed grid used by the monitor speed control and the
 * speed-cycle hotkey commands. Keeping a single source of truth
 * guarantees the hotkeys walk exactly the same steps the monitor UI exposes.
 */

/**
 * Positive playback speeds offered by the monitor speed menu, ascending.
 * Negative variants are derived from this list.
 */
export const PLAYBACK_SPEED_VALUES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 5];

/**
 * Full signed speed grid used for step traversal (mouse wheel + speed-cycle hotkeys),
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

/**
 * Speeds the classic J/K/L shuttle walks through, ascending. Unlike the full
 * grid this skips the sub-1x values: a shuttle press always starts at 1x and
 * only ever accelerates from there.
 */
export const SHUTTLE_SPEED_VALUES: readonly number[] = [1, 2, 3, 5];

export type ShuttleDirection = 'forward' | 'backward';

/**
 * Next signed speed for a J (backward) or L (forward) shuttle press.
 *
 * Classic NLE behaviour: the first press in a direction snaps to 1x in that
 * direction — including when the transport is already running the *other* way,
 * so J acts as a brake on a forward shuttle before it reverses. Further presses
 * in the same direction climb {@link SHUTTLE_SPEED_VALUES}, clamped at 5x.
 */
export function nextShuttleSpeed(
  currentSpeed: number,
  isPlaying: boolean,
  direction: ShuttleDirection,
): number {
  const sign = direction === 'backward' ? -1 : 1;
  const alreadyShuttling = isPlaying && Math.sign(currentSpeed) === sign;
  if (!alreadyShuttling) return sign;

  const magnitude = Math.abs(currentSpeed);
  const above = SHUTTLE_SPEED_VALUES.find((v) => v > magnitude);
  return sign * (above ?? SHUTTLE_SPEED_VALUES[SHUTTLE_SPEED_VALUES.length - 1]!);
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
