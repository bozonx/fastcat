export function clampAudioParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : defaultValue;
}
