export interface MonitorPreviewSizeParams {
  sceneWidth: number;
  sceneHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio?: number;
  manualScale?: number;
  autoMaxLongEdge?: number;
}

export const MONITOR_AUTO_MAX_LONG_EDGE = 960;

export function resolveMonitorPreviewSize(params: MonitorPreviewSizeParams): {
  width: number;
  height: number;
  scale: number;
} {
  const sceneWidth = Math.max(2, Math.round(params.sceneWidth) || 1920);
  const sceneHeight = Math.max(2, Math.round(params.sceneHeight) || 1080);
  const sceneLongEdge = Math.max(sceneWidth, sceneHeight);
  const manualValue = Number(params.manualScale);
  const manualScale = manualValue > 1 ? manualValue / sceneHeight : manualValue;
  const scale =
    Number.isFinite(manualScale) && manualScale > 0
      ? Math.min(1, manualScale)
      : Math.min(
          1,
          Math.max(
            2,
            Math.min(
              params.autoMaxLongEdge ?? MONITOR_AUTO_MAX_LONG_EDGE,
              Math.max(params.viewportWidth, params.viewportHeight) *
                Math.max(1, params.devicePixelRatio ?? 1),
            ),
          ) / sceneLongEdge,
        );

  return {
    width: Math.max(2, Math.round(sceneWidth * scale)),
    height: Math.max(2, Math.round((sceneHeight * scale) / 2) * 2),
    scale,
  };
}
