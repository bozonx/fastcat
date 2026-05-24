/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';

const clipboardPayload = {
  source: 'clipParameters' as const,
  snapshot: {},
};

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    clipboardPayload,
    setClipboardPayload: vi.fn(),
  }),
}));

vi.mock('~/utils/timeline/clip-parameters', () => ({
  getApplicableClipParameterGroups: () => [{ id: 'speed', selectedByDefault: true }],
  buildClipParametersPatch: () => ({ properties: {} }),
  createClipParametersSnapshot: () => ({}),
  hasClipParametersPatch: () => false,
}));

import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';

function createComposable() {
  const scope = effectScope();
  const api = scope.run(() =>
    useClipParametersClipboard({
      clip: ref({ id: 'clip-1', trackId: 'track-1' } as never),
      trackKind: ref('video' as never),
      updateClipProperties: vi.fn(),
      updateClipTransition: vi.fn(),
    }),
  )!;
  return { scope, api };
}

describe('useClipParametersClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers opening the paste modal to a macrotask so it survives a closing menu layer', () => {
    const { scope, api } = createComposable();

    api.openPasteClipParameters();
    // Must NOT open synchronously: opening inside a context-menu onSelect handler
    // races with Reka closing the menu, causing the modal to "reopen" on first close.
    expect(api.isPasteParametersModalOpen.value).toBe(false);

    vi.runAllTimers();
    expect(api.isPasteParametersModalOpen.value).toBe(true);

    scope.stop();
  });

  it('clears a pending open when the scope is disposed before it fires', () => {
    const { scope, api } = createComposable();

    api.openPasteClipParameters();
    scope.stop();
    vi.runAllTimers();

    expect(api.isPasteParametersModalOpen.value).toBe(false);
  });
});
