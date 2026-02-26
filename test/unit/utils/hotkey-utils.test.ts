import { describe, expect, it } from 'vitest';

import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';

describe('hotkeyUtils', () => {
  it('treats text inputs as editable', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isEditableTarget(input)).toBe(true);
  });

  it('treats textarea as editable', () => {
    const textarea = document.createElement('textarea');
    expect(isEditableTarget(textarea)).toBe(true);
  });

  it('treats contenteditable as editable', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    expect(isEditableTarget(div)).toBe(true);
  });

  it('does not treat select as editable', () => {
    const select = document.createElement('select');
    expect(isEditableTarget(select)).toBe(false);
  });

  it('does not treat buttons as editable', () => {
    const button = document.createElement('button');
    expect(isEditableTarget(button)).toBe(false);
  });

  it('does not treat checkbox input as editable', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(isEditableTarget(input)).toBe(false);
  });
});
