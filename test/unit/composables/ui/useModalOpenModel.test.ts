/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';

describe('useModalOpenModel', () => {
  it('returns a writable computed that reads from props.open', () => {
    const props = { open: true };
    const emit = vi.fn();
    const model = useModalOpenModel(props, emit);
    expect(model.value).toBe(true);
  });

  it('calls emit update:open when set', () => {
    const props = { open: false };
    const emit = vi.fn();
    const model = useModalOpenModel(props, emit);
    model.value = true;
    expect(emit).toHaveBeenCalledWith('update:open', true);
  });

  it('reflects changes in props.open', () => {
    const open = ref(false);
    const props = {
      get open() {
        return open.value;
      },
    };
    const emit = vi.fn();
    const model = useModalOpenModel(props, emit);
    expect(model.value).toBe(false);
    open.value = true;
    expect(model.value).toBe(true);
  });
});
