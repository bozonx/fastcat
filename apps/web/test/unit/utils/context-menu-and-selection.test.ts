import { describe, expect, it, vi } from 'vitest';

describe('Context Menu & Text Selection Blocking Logic', () => {
  function preventContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const isEditable = target.closest(
      'input, textarea, [contenteditable="true"], .allow-native-context-menu',
    );
    if (isEditable) return;

    e.preventDefault();
  }

  it('prevents native context menu on non-editable elements', () => {
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-timeline-toolbar', 'true');
    document.body.appendChild(toolbar);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    toolbar.dispatchEvent(event);
    preventContextMenu(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    document.body.removeChild(toolbar);
  });

  it('does not prevent native context menu on editable elements', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    Object.defineProperty(event, 'target', { value: input, writable: false });
    preventContextMenu(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('allows custom context menu handlers on elements (e.g. clips and files) before window bubble listener', () => {
    const clipHandlerSpy = vi.fn();
    const windowListener = (e: MouseEvent) => {
      preventContextMenu(e);
    };

    window.addEventListener('contextmenu', windowListener);

    const clip = document.createElement('div');
    document.body.appendChild(clip);

    clip.addEventListener('contextmenu', (e) => {
      if (!e.defaultPrevented) {
        clipHandlerSpy();
        e.preventDefault();
      }
    });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    clip.dispatchEvent(event);

    expect(clipHandlerSpy).toHaveBeenCalled();

    window.removeEventListener('contextmenu', windowListener);
    document.body.removeChild(clip);
  });
});
