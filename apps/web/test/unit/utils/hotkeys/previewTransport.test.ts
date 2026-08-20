import { describe, expect, it } from 'vitest';

import { resolvePreviewTransport } from '~/utils/hotkeys/previewTransport';

describe('previewTransport', () => {
  it('resolves forward transport commands to preview routes', () => {
    expect(resolvePreviewTransport('playback.forward2')).toEqual({
      kind: 'setSpeed',
      speed: 2,
    });
    expect(resolvePreviewTransport('playback.stepForward')).toEqual({
      kind: 'step',
      frames: 1,
    });
    expect(resolvePreviewTransport('general.volumeUp')).toEqual({
      kind: 'volume',
      delta: 0.05,
    });
    expect(resolvePreviewTransport('general.mute')).toEqual({ kind: 'mute' });
  });

  it('blocks reverse and boundary commands in preview focus', () => {
    expect(resolvePreviewTransport('playback.backward2')).toBe('block');
    expect(resolvePreviewTransport('playback.shuttleReverse')).toBe('block');
    expect(resolvePreviewTransport('playback.jumpNextBoundary')).toBe('block');
  });

  it('returns null for non-transport commands', () => {
    expect(resolvePreviewTransport('general.copy')).toBeNull();
    expect(resolvePreviewTransport('general.rename')).toBeNull();
  });
});
