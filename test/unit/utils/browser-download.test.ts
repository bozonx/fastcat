import { describe, expect, it, vi } from 'vitest';
import { triggerBrowserFileDownload } from '~/utils/browser-download';

describe('triggerBrowserFileDownload', () => {
  it('clicks a temporary download link and revokes the object URL', () => {
    vi.useFakeTimers();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    triggerBrowserFileDownload(new Blob(['hello']), 'clip.mp4');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="clip.mp4"]')).toBeNull();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');

    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    vi.useRealTimers();
  });
});
