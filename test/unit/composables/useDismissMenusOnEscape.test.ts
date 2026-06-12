/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissOpenRekaMenusOnEscape,
  hasOpenRekaMenu,
} from '~/composables/useDismissMenusOnEscape';

describe('useDismissMenusOnEscape', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when escape is pressed without an open menu', () => {
    const pointerDown = vi.fn();
    document.body.addEventListener('pointerdown', pointerDown);
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    dismissOpenRekaMenusOnEscape(event);

    expect(hasOpenRekaMenu()).toBe(false);
    expect(pointerDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('dispatches outside pointerdown when escape is pressed with an open menu', () => {
    const menu = document.createElement('div');
    menu.setAttribute('data-reka-menu-content', '');
    document.body.appendChild(menu);
    const pointerDown = vi.fn();
    document.body.addEventListener('pointerdown', pointerDown);
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    dismissOpenRekaMenusOnEscape(event);

    expect(hasOpenRekaMenu()).toBe(true);
    expect(pointerDown).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
