/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFriendlyTimeAgo } from '~/composables/useFriendlyTimeAgo';
import { useI18n } from 'vue-i18n';
import { ref } from 'vue';

const mockT = vi.fn();
const mockLocale = ref('en-US');

describe('useFriendlyTimeAgo', () => {
  beforeEach(() => {
    vi.mocked(useI18n).mockReturnValue({
      t: mockT,
      locale: mockLocale,
    } as any);

    mockLocale.value = 'en-US';
    mockT.mockImplementation((key, val) => {
      if (typeof val === 'object' && val !== null && 'time' in val) {
        return `${key}:${val.time}`;
      }
      if (typeof val === 'number') {
        return `${key}:${val}`;
      }
      return key;
    });
  });

  afterEach(() => {
    // Restore the default mock from vitest.setup.ts
    vi.mocked(useI18n).mockImplementation(
      () =>
        ({
          t: (key: string, params?: string | Record<string, unknown>) =>
            typeof params === 'string' ? params : key,
          locale: ref('en-US'),
        }) as any,
    );
  });

  it('should return fallback for null or undefined dates', () => {
    const timeAgo1 = useFriendlyTimeAgo(null, 'No Date');
    expect(timeAgo1.value).toBe('No Date');

    const timeAgo2 = useFriendlyTimeAgo(undefined, '-');
    expect(timeAgo2.value).toBe('-');
  });

  it('should return fallback for invalid dates', () => {
    const timeAgo = useFriendlyTimeAgo('invalid date string', '—');
    expect(timeAgo.value).toBe('—');
  });

  it('should format relative time for justNow', () => {
    const now = new Date();
    const timeAgo = useFriendlyTimeAgo(now);

    expect(timeAgo.value).toBe('timeAgo.justNow');
    expect(mockT).toHaveBeenCalledWith('timeAgo.justNow');
  });

  it('should format relative time for minutes, hours, days', () => {
    const now = Date.now();

    // 5 minutes ago
    const date5m = new Date(now - 300000);
    const timeAgo5m = useFriendlyTimeAgo(date5m);
    expect(timeAgo5m.value).toBe('timeAgo.ago:timeAgo.minute:5');

    // 3 hours ago
    const date3h = new Date(now - 3 * 3600 * 1000);
    const timeAgo3h = useFriendlyTimeAgo(date3h);
    expect(timeAgo3h.value).toBe('timeAgo.ago:timeAgo.hour:3');

    // 2 days ago
    const date2d = new Date(now - 2 * 24 * 3600 * 1000);
    const timeAgo2d = useFriendlyTimeAgo(date2d);
    expect(timeAgo2d.value).toBe('timeAgo.ago:timeAgo.day:2');
  });
});
