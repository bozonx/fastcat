export function usToS(us: number): number {
  return us / 1_000_000;
}

export function sToUs(s: number): number {
  return Math.round(s * 1_000_000);
}
