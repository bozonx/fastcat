/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { blurOnDropdownMenuClose } from '~/composables/useDropdownMenuBlur';

describe('blurOnDropdownMenuClose', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when menu opens', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    blurOnDropdownMenuClose(true);
    vi.advanceTimersByTime(50);

    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('blurs a focused button when menu closes', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    blurOnDropdownMenuClose(false);
    vi.advanceTimersByTime(50);

    expect(document.activeElement).not.toBe(button);
    button.remove();
  });

  it('does not blur when active element is not a button', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    blurOnDropdownMenuClose(false);
    vi.advanceTimersByTime(50);

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('does nothing when there is no active element', () => {
    document.body.focus();
    const previousActive = document.activeElement;

    blurOnDropdownMenuClose(false);
    vi.advanceTimersByTime(50);

    expect(document.activeElement).toBe(previousActive);
  });
});
