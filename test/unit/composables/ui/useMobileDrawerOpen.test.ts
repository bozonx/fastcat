/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useMobileDrawerOpen } from '~/composables/ui/useMobileDrawerOpen';

describe('useMobileDrawerOpen', () => {
  it('returns a writable computed that reads from props.isOpen', () => {
    const props = { isOpen: true };
    const emit = vi.fn();
    const model = useMobileDrawerOpen(props, emit);
    expect(model.value).toBe(true);
  });

  it('calls emit close when set to false', () => {
    const props = { isOpen: true };
    const emit = vi.fn();
    const model = useMobileDrawerOpen(props, emit);
    model.value = false;
    expect(emit).toHaveBeenCalledWith('close');
  });

  it('does not call emit close when set to true', () => {
    const props = { isOpen: false };
    const emit = vi.fn();
    const model = useMobileDrawerOpen(props, emit);
    model.value = true;
    expect(emit).not.toHaveBeenCalled();
  });
});
