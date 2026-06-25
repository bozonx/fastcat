/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useCloseModel } from '~/composables/ui/useCloseModel';

describe('useCloseModel', () => {
  it('returns a writable computed that reads from getter', () => {
    const isOpen = ref(true);
    const model = useCloseModel(() => isOpen.value, () => {});
    expect(model.value).toBe(true);
    isOpen.value = false;
    expect(model.value).toBe(false);
  });

  it('calls onClose when set to false', () => {
    let closed = false;
    const model = useCloseModel(() => true, () => {
      closed = true;
    });
    model.value = false;
    expect(closed).toBe(true);
  });

  it('does not call onClose when set to true', () => {
    let closed = false;
    const model = useCloseModel(() => false, () => {
      closed = true;
    });
    model.value = true;
    expect(closed).toBe(false);
  });
});
