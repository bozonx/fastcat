/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { createTimelineHistoryDebounceModule } from '~/stores/timeline/history-debounce';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

function makeDoc(): TimelineDocument {
  return {
    tracks: [],
    timebase: { fps: 30 },
    durationTicks: 0,
  } as unknown as TimelineDocument;
}

function makeCmd(type: string = 'trim_item'): TimelineCommand {
  return { type, trackId: 't1', itemId: 'c1' } as unknown as TimelineCommand;
}

describe('createTimelineHistoryDebounceModule', () => {
  let historyPush: ReturnType<typeof vi.fn>;
  let clearTimeoutSpy: ReturnType<typeof vi.fn>;
  let setTimeoutSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    historyPush = vi.fn();
    clearTimeoutSpy = vi.fn();
    setTimeoutSpy = vi.fn(() => 42);
    vi.stubGlobal('window', {
      clearTimeout: clearTimeoutSpy,
      setTimeout: setTimeoutSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes with null pending debounced history', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    expect(mod.pendingDebouncedHistory.value).toBeNull();
  });

  it('pushHistory immediate calls historyStore.push', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc = makeDoc();
    const cmd = makeCmd('trim_item');
    mod.pushHistory(cmd, doc);
    expect(historyPush).toHaveBeenCalledWith(
      'timeline',
      'trim_item',
      doc,
      'videoEditor.fileManager.history.entries.trimClip',
    );
  });

  it('pushHistory immediate flushes pending debounced history first', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc1 = makeDoc();
    const cmd1 = makeCmd('trim_item');
    // Start a debounced push
    mod.pushHistory(cmd1, doc1, { historyMode: 'debounced' });
    expect(mod.pendingDebouncedHistory.value).not.toBeNull();
    // Now do an immediate push — should flush first
    const doc2 = makeDoc();
    const cmd2 = makeCmd('split_item');
    mod.pushHistory(cmd2, doc2);
    // First call is the flush, second is the immediate
    expect(historyPush).toHaveBeenCalledTimes(2);
  });

  it('pushHistory debounced sets pending and schedules timer', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc = makeDoc();
    const cmd = makeCmd('trim_item');
    mod.pushHistory(cmd, doc, { historyMode: 'debounced', historyDebounceMs: 500 });
    expect(mod.pendingDebouncedHistory.value).not.toBeNull();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it('pushHistory debounced replaces pending and keeps original snapshot', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc1 = makeDoc();
    const cmd1 = makeCmd('trim_item');
    mod.pushHistory(cmd1, doc1, { historyMode: 'debounced', historyDebounceMs: 300 });
    const firstSnapshot = mod.pendingDebouncedHistory.value!.snapshot;
    // Push a second debounced command
    const cmd2 = makeCmd('split_item');
    mod.pushHistory(cmd2, makeDoc(), { historyMode: 'debounced', historyDebounceMs: 300 });
    // Snapshot should be preserved from the first pending
    expect(mod.pendingDebouncedHistory.value!.snapshot).toBe(firstSnapshot);
    // Command should be the new one
    expect(mod.pendingDebouncedHistory.value!.cmd).toStrictEqual(cmd2);
  });

  it('clearPendingDebouncedHistory clears pending and timer', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    mod.pushHistory(makeCmd(), makeDoc(), { historyMode: 'debounced' });
    expect(mod.pendingDebouncedHistory.value).not.toBeNull();
    mod.clearPendingDebouncedHistory();
    expect(mod.pendingDebouncedHistory.value).toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('clearPendingDebouncedHistory does nothing when no pending', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    mod.clearPendingDebouncedHistory();
    expect(mod.pendingDebouncedHistory.value).toBeNull();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('flushPendingDebouncedHistory pushes pending to history', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc = makeDoc();
    mod.pushHistory(makeCmd('trim_item'), doc, { historyMode: 'debounced' });
    mod.flushPendingDebouncedHistory();
    expect(historyPush).toHaveBeenCalledWith(
      'timeline',
      'trim_item',
      doc,
      'videoEditor.fileManager.history.entries.trimClip',
    );
    expect(mod.pendingDebouncedHistory.value).toBeNull();
  });

  it('flushPendingDebouncedHistory preserves the pending label key', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const doc = makeDoc();
    const cmd = makeCmd('update_clip_properties') as unknown as TimelineCommand;
    (cmd as Record<string, unknown>).properties = { audioGain: 1.25 };

    mod.pushHistory(cmd, doc, { historyMode: 'debounced' });
    mod.flushPendingDebouncedHistory();

    expect(historyPush).toHaveBeenCalledWith(
      'timeline',
      'update_clip_properties',
      doc,
      'videoEditor.fileManager.history.entries.updateClipGain',
    );
  });

  it('flushPendingDebouncedHistory does nothing when no pending', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    mod.flushPendingDebouncedHistory();
    expect(historyPush).not.toHaveBeenCalled();
  });

  it('pushHistory uses custom labelKey when provided', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    mod.pushHistory(makeCmd(), makeDoc(), { labelKey: 'custom.label' });
    expect(historyPush).toHaveBeenCalledWith(
      'timeline',
      expect.any(String),
      expect.any(Object),
      'custom.label',
    );
  });

  it('pushHistory uses update_clip_properties label for that command type', () => {
    const mod = createTimelineHistoryDebounceModule({ historyStore: { push: historyPush } });
    const cmd = makeCmd('update_clip_properties') as unknown as TimelineCommand;
    // Add properties to the command
    (cmd as Record<string, unknown>).properties = { audioGain: 1.5 };
    mod.pushHistory(cmd, makeDoc());
    expect(historyPush).toHaveBeenCalledWith(
      'timeline',
      'update_clip_properties',
      expect.any(Object),
      'videoEditor.fileManager.history.entries.updateClipGain',
    );
  });
});
