/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useExportState } from '~/composables/timeline/export/core/useExportState';

vi.mock('~/stores/export.store', () => ({
  useExportStore: () => ({
    isExporting: false,
    exportProgress: 0,
    exportError: null,
    exportPhase: 'idle',
    exportWarnings: [],
    exportDurationMs: 0,
    lastExportStatus: null,
    cancelRequested: false,
    activeExportTaskId: null,
    resetExportProcessState: vi.fn(),
  }),
}));

vi.mock('pinia', () => ({
  storeToRefs: vi.fn((store: Record<string, unknown>) => {
    const refs: Record<string, { value: unknown }> = {};
    for (const key of Object.keys(store)) {
      refs[key] = { value: store[key] };
    }
    return refs;
  }),
}));

describe('useExportState', () => {
  it('returns reactive export state refs', () => {
    const result = useExportState();
    expect(result.isExporting).toBeDefined();
    expect(result.exportProgress).toBeDefined();
    expect(result.exportError).toBeDefined();
    expect(result.exportPhase).toBeDefined();
    expect(result.exportWarnings).toBeDefined();
    expect(result.exportDurationMs).toBeDefined();
    expect(result.lastExportStatus).toBeDefined();
    expect(result.cancelRequested).toBeDefined();
    expect(result.activeExportTaskId).toBeDefined();
    expect(typeof result.resetExportState).toBe('function');
  });
});
