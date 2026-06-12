/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { blurOnDropdownMenuClose } from '~/composables/useDropdownMenuBlur';

describe('blurOnDropdownMenuClose', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing when menu opens', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    blurOnDropdownMenuClose(true);
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('blurs a focused button when menu closes', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    blurOnDropdownMenuClose(false);
    await nextTick();

    expect(document.activeElement).not.toBe(button);
    button.remove();
  });

  it('does not blur when active element is not a button', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    blurOnDropdownMenuClose(false);
    await nextTick();

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('does nothing when there is no active element', async () => {
    document.body.focus();
    const previousActive = document.activeElement;

    blurOnDropdownMenuClose(false);
    await nextTick();

    expect(document.activeElement).toBe(previousActive);
  });
});
