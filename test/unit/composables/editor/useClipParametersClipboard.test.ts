/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';
import type { ClipParametersApplyTarget } from '~/utils/timeline/clip-parameters';

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

const buildClipParametersPatch = vi.fn(() => ({ properties: {} as Record<string, unknown> }));
const hasClipParametersPatch = vi.fn(() => false);

vi.mock('~/utils/timeline/clip-parameters', () => ({
  getApplicableClipParameterGroups: () => [{ id: 'speed', selectedByDefault: true }],
  buildClipParametersPatch: (...args: unknown[]) => buildClipParametersPatch(...(args as [])),
  createClipParametersSnapshot: () => ({}),
  hasClipParametersPatch: (...args: unknown[]) => hasClipParametersPatch(...(args as [])),
}));

function createComposable(overrides?: {
  resolveApplyTargets?: (target: ClipParametersApplyTarget) => ClipParametersApplyTarget[];
  applyCommands?: ReturnType<typeof vi.fn>;
}) {
  const applyCommands = overrides?.applyCommands ?? vi.fn();
  const scope = effectScope();
  const api = scope.run(() =>
    useClipParametersClipboard({
      clip: ref({ id: 'clip-1', trackId: 'track-1' } as never),
      trackKind: ref('video' as never),
      resolveApplyTargets: overrides?.resolveApplyTargets ?? ((target) => [target]),
      applyCommands,
    }),
  )!;
  return { scope, api, applyCommands };
}

describe('useClipParametersClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildClipParametersPatch.mockReset();
    buildClipParametersPatch.mockReturnValue({ properties: {} });
    hasClipParametersPatch.mockReset();
    hasClipParametersPatch.mockReturnValue(false);
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

  describe('applyClipParameters', () => {
    it('fans one paste out across every resolved target as a single atomic batch', () => {
      const targets: ClipParametersApplyTarget[] = [
        {
          trackId: 'track-1',
          trackKind: 'video',
          clip: { id: 'clip-1', trackId: 'track-1' } as never,
        },
        {
          trackId: 'track-1',
          trackKind: 'video',
          clip: { id: 'clip-2', trackId: 'track-1' } as never,
        },
        {
          trackId: 'track-2',
          trackKind: 'video',
          clip: { id: 'clip-3', trackId: 'track-2' } as never,
        },
      ];
      // Each target yields a non-empty property + transition patch.
      buildClipParametersPatch.mockReturnValue({
        properties: { opacity: 0.5 },
        transitionIn: null,
      } as never);
      hasClipParametersPatch.mockReturnValue(true);

      const { scope, api, applyCommands } = createComposable({
        resolveApplyTargets: () => targets,
      });

      api.applyClipParameters(['opacity', 'transitions']);

      // Single atomic apply — one undo entry for the whole multi-clip paste.
      expect(applyCommands).toHaveBeenCalledTimes(1);
      const cmds = applyCommands.mock.calls[0]![0] as Array<{ type: string; itemId: string }>;
      // One properties command + one transition command per target.
      expect(cmds).toHaveLength(6);
      expect(cmds.filter((c) => c.type === 'update_clip_properties').map((c) => c.itemId)).toEqual([
        'clip-1',
        'clip-2',
        'clip-3',
      ]);
      expect(cmds.filter((c) => c.type === 'update_clip_transition').map((c) => c.itemId)).toEqual([
        'clip-1',
        'clip-2',
        'clip-3',
      ]);

      scope.stop();
    });

    it('skips targets whose per-clip patch is empty and does not apply when nothing remains', () => {
      const targets: ClipParametersApplyTarget[] = [
        {
          trackId: 'track-1',
          trackKind: 'video',
          clip: { id: 'clip-1', trackId: 'track-1' } as never,
        },
        {
          trackId: 'track-1',
          trackKind: 'audio',
          clip: { id: 'clip-2', trackId: 'track-1' } as never,
        },
      ];
      buildClipParametersPatch.mockReturnValue({ properties: {} });
      hasClipParametersPatch.mockReturnValue(false);

      const { scope, api, applyCommands } = createComposable({
        resolveApplyTargets: () => targets,
      });

      api.applyClipParameters(['transform']);

      expect(applyCommands).not.toHaveBeenCalled();

      scope.stop();
    });
  });
});
