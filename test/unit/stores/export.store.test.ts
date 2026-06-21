// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useExportStore } from '~/stores/export.store';

describe('export.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('initializes with default values', () => {
    const store = useExportStore();
    expect(store.isExporting).toBe(false);
    expect(store.exportProgress).toBe(0);
    expect(store.exportError).toBeNull();
    expect(store.exportPhase).toBeNull();
    expect(store.exportWarnings).toEqual([]);
    expect(store.exportDurationMs).toBeNull();
    expect(store.lastExportStatus).toBeNull();
    expect(store.cancelRequested).toBe(false);
    expect(store.activeExportTaskId).toBeNull();
  });

  describe('resetExportProcessState', () => {
    it('resets all state properties to default values', () => {
      const store = useExportStore();
      
      store.isExporting = false;
      store.exportProgress = 50;
      store.exportError = 'some error';
      store.exportPhase = 'encoding';
      store.exportWarnings = ['warn1'];
      store.exportDurationMs = 12000;
      store.lastExportStatus = 'error';
      store.cancelRequested = true;
      store.activeExportTaskId = 'task-id-123';

      store.resetExportProcessState();

      expect(store.exportProgress).toBe(0);
      expect(store.exportError).toBeNull();
      expect(store.exportPhase).toBeNull();
      expect(store.exportWarnings).toEqual([]);
      expect(store.exportDurationMs).toBeNull();
      expect(store.lastExportStatus).toBeNull();
      expect(store.cancelRequested).toBe(false);
      expect(store.activeExportTaskId).toBeNull();
    });

    it('does not reset activeExportTaskId if isExporting is true', () => {
      const store = useExportStore();
      
      store.isExporting = true;
      store.activeExportTaskId = 'task-id-123';
      store.exportProgress = 80;

      store.resetExportProcessState();

      expect(store.exportProgress).toBe(0);
      expect(store.activeExportTaskId).toBe('task-id-123');
    });
  });
});
