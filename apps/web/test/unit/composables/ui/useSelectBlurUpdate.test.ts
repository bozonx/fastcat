import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSelectBlurUpdate } from '~/composables/ui/useSelectBlurUpdate';

describe('useSelectBlurUpdate', () => {
  it('emits the value and blurs the active element', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const emit = vi.fn();
    const onUpdate = useSelectBlurUpdate(emit as (e: 'update:modelValue', value: unknown) => void);

    onUpdate('foo');

    expect(emit).toHaveBeenCalledWith('update:modelValue', 'foo');

    await nextTick();
    expect(document.activeElement).not.toBe(input);

    document.body.removeChild(input);
  });
});
