export function normalizeHexColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[0] ?? '0';
    const g = raw[1] ?? '0';
    const b = raw[2] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}`.toLowerCase() : fallback.toLowerCase();
}

export function hexToRgb01(value: unknown, fallback = '#000000'): [number, number, number] {
  const hex = normalizeHexColor(value, fallback).slice(1);
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function hexToRgbUint(value: unknown, fallback = '#000000'): number {
  const hex = normalizeHexColor(value, fallback).slice(1);
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}
