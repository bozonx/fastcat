import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppClipboard } from '~/composables/useAppClipboard';
import * as clipboardStore from '~/stores/clipboard.store';

vi.mock('~/stores/clipboard.store', () => ({
  useClipboardStore: vi.fn()
}));

describe('useAppClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the clipboard store', () => {
    const mockStore = {
      clip: null,
      copyClip: vi.fn(),
      pasteClip: vi.fn()
    };
    (clipboardStore.useClipboardStore as any).mockReturnValue(mockStore);

    const result = useAppClipboard();

    expect(clipboardStore.useClipboardStore).toHaveBeenCalled();
    expect(result).toBe(mockStore);
  });
});
