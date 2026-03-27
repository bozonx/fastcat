// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDefaultCutPanelsForOrientation } from '~/stores/editor-view.store';

describe('buildDefaultCutPanelsForOrientation', () => {
  it('puts monitor below properties on the right stack in landscape', () => {
    const cols = buildDefaultCutPanelsForOrientation('landscape');
    const withMonitor = cols.find((c) => c.panels.some((p) => p.type === 'monitor'));
    expect(withMonitor?.panels.map((p) => p.type)).toEqual(['properties', 'monitor']);
  });

  it('puts monitor in the right column in portrait', () => {
    const cols = buildDefaultCutPanelsForOrientation('portrait');
    expect(cols.length).toBe(2);
    expect(cols[1]?.panels[0]?.type).toBe('monitor');
    expect(cols[0]?.panels.map((p) => p.type)).toEqual(['fileManager', 'properties']);
  });
});
