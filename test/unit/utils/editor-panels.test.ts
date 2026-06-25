/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createEditorPanelEventListeners } from '~/utils/editor-panels';

describe('createEditorPanelEventListeners', () => {
  it('creates listeners for all editor panel events', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);

    expect(listeners.topResize).toBeDefined();
    expect(listeners.verticalResize).toBeDefined();
    expect(listeners.dragStart).toBeDefined();
    expect(listeners.dragOver).toBeDefined();
    expect(listeners.dragLeave).toBeDefined();
    expect(listeners.drop).toBeDefined();
    expect(listeners.dragEnd).toBeDefined();
    expect(listeners.focus).toBeDefined();
    expect(listeners.close).toBeDefined();
    expect(listeners.moveToView).toBeDefined();
    expect(listeners.topReset).toBeDefined();
    expect(listeners.verticalReset).toBeDefined();
    expect(listeners.panelPointerDown).toBeDefined();
  });

  it('forwards topResize event', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    const event = { size: 100 };
    listeners.topResize(event);
    expect(emit).toHaveBeenCalledWith('topResize', event);
  });

  it('forwards verticalResize event with colId and view', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    const event = { size: 200 };
    listeners.verticalResize(event, 'col-1', 'cut');
    expect(emit).toHaveBeenCalledWith('verticalResize', event, 'col-1', 'cut');
  });

  it('forwards dragStart event', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    const event = { type: 'dragstart' } as DragEvent;
    listeners.dragStart(event, 'panel-1');
    expect(emit).toHaveBeenCalledWith('dragStart', event, 'panel-1');
  });

  it('forwards focus event', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    listeners.focus('panel-1');
    expect(emit).toHaveBeenCalledWith('focus', 'panel-1');
  });

  it('forwards dragEnd event with no args', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    listeners.dragEnd();
    expect(emit).toHaveBeenCalledWith('dragEnd');
  });

  it('forwards panelPointerDown event', () => {
    const emit = vi.fn();
    const listeners = createEditorPanelEventListeners(emit);
    const event = { type: 'pointerdown' } as PointerEvent;
    listeners.panelPointerDown(event, 'panel-1', 'sound');
    expect(emit).toHaveBeenCalledWith('panelPointerDown', event, 'panel-1', 'sound');
  });
});
