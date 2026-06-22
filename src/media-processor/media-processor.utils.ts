export function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeW = width > 0 ? width : 16;
  const safeH = height > 0 ? height : 9;
  const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
  return {
    width: Math.max(2, Math.round(safeW * scale)),
    height: Math.max(2, Math.round(safeH * scale)),
  };
}
