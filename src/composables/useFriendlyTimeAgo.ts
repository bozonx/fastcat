import { computed, toValue } from 'vue';
import { useTimeAgo, type UseTimeAgoMessages } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import type { MaybeRefOrGetter } from 'vue';

/**
 * Returns a reactive human-friendly relative time string (e.g. "5 minutes ago", "just now").
 * Supports locale switches dynamically.
 */
export function useFriendlyTimeAgo(
  dateInput: MaybeRefOrGetter<Date | number | string | null | undefined>,
  fallback = '—',
) {
  const { t } = useI18n();

  const parsedDate = computed(() => {
    const val = typeof dateInput === 'function' ? dateInput() : toValue(dateInput);
    if (!val) return null;
    const date = val instanceof Date ? val : new Date(val);
    return isNaN(date.getTime()) ? null : date;
  });

  const timeAgo = useTimeAgo(
    computed(() => parsedDate.value ?? new Date()),
    {
      get messages(): UseTimeAgoMessages {
        return {
          justNow: t('timeAgo.justNow'),
          past: (n) => t('timeAgo.ago', { time: n }),
          future: (n) => t('timeAgo.in', { time: n }),
          month: (n) => t('timeAgo.month', n),
          year: (n) => t('timeAgo.year', n),
          week: (n) => t('timeAgo.week', n),
          day: (n) => t('timeAgo.day', n),
          hour: (n) => t('timeAgo.hour', n),
          minute: (n) => t('timeAgo.minute', n),
          second: (n) => t('timeAgo.second', n),
          invalid: fallback,
        };
      },
    },
  );

  return computed(() => {
    if (!parsedDate.value) return fallback;
    return timeAgo.value;
  });
}
