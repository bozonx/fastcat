import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFocusStore } from '~/stores/focus.store';

describe('debug pinia unwrap', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('unwraps computed', () => {
    const fs = useFocusStore();
    fs.setMainFocus('timeline');
    const v = fs.canUseTimelineHotkeys;
    expect(typeof v).toBe('boolean');
    expect(v).toBe(true);
  });
});
