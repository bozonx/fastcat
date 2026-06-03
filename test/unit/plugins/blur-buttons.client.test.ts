import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import blurButtonsPlugin from '~/plugins/blur-buttons.client';

describe('blur-buttons.client plugin', () => {
  let button: HTMLButtonElement;
  let excludedButton: HTMLButtonElement;
  let normalDiv: HTMLDivElement;

  beforeEach(() => {
    // Set up elements in DOM
    button = document.createElement('button');
    button.textContent = 'Normal Button';
    document.body.appendChild(button);

    excludedButton = document.createElement('button');
    excludedButton.textContent = 'Dropdown Trigger';
    excludedButton.setAttribute('aria-haspopup', 'true');
    document.body.appendChild(excludedButton);

    normalDiv = document.createElement('div');
    normalDiv.textContent = 'Not a button';
    document.body.appendChild(normalDiv);

    // Initialize plugin
    blurButtonsPlugin({} as any);
  });

  afterEach(() => {
    // Clean up DOM
    button.remove();
    excludedButton.remove();
    normalDiv.remove();
  });

  it('blurs the button when clicked with a pointer (mouse)', () => {
    button.focus();
    expect(document.activeElement).toBe(button);

    // Simulate pointer click
    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    button.dispatchEvent(event);

    expect(document.activeElement).not.toBe(button);
  });

  it('does not blur the button when clicked via keyboard (no pointerType)', () => {
    button.focus();
    expect(document.activeElement).toBe(button);

    // Simulate keyboard click (pointerType is empty)
    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      pointerType: '',
    });
    button.dispatchEvent(event);

    expect(document.activeElement).toBe(button);
  });

  it('does not blur excluded buttons (e.g. with aria-haspopup)', () => {
    excludedButton.focus();
    expect(document.activeElement).toBe(excludedButton);

    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    excludedButton.dispatchEvent(event);

    expect(document.activeElement).toBe(excludedButton);
  });

  it('does nothing when non-button elements are clicked', () => {
    normalDiv.focus();
    // note: divs aren't normally focusable unless they have tabindex,
    // but we just test that no errors are thrown and focus behaves normally
    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    normalDiv.dispatchEvent(event);
  });
});
