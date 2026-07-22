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

  it('prevents native context menu on non-editable elements like timeline toolbar', () => {
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

    // Simulate dispatching on input
    Object.defineProperty(event, 'target', { value: input, writable: false });
    preventContextMenu(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('window capture phase listener catches contextmenu before stopPropagation stops bubbling', () => {
    const windowPreventDefaultSpy = vi.fn();
    const windowListener = (e: MouseEvent) => {
      preventContextMenu(e);
      if (e.defaultPrevented) {
        windowPreventDefaultSpy();
      }
    };

    window.addEventListener('contextmenu', windowListener, { capture: true });

    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);

    // Child element that calls stopPropagation
    toolbar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    toolbar.dispatchEvent(event);

    expect(windowPreventDefaultSpy).toHaveBeenCalled();

    window.removeEventListener('contextmenu', windowListener, { capture: true });
    document.body.removeChild(toolbar);
  });
});
