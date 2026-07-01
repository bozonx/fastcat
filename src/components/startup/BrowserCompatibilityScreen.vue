<script setup lang="ts">
import type { BrowserCompatibilityReport } from '~/utils/browser-compatibility';

defineProps<{
  report: BrowserCompatibilityReport;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex min-h-dvh w-full items-center justify-center bg-ui-bg p-6 text-ui-text">
    <section class="w-full max-w-2xl space-y-6">
      <div class="space-y-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-error-500/10">
          <UIcon name="i-heroicons-exclamation-triangle" class="h-7 w-7 text-error-400" />
        </div>
        <div class="space-y-2">
          <h1 class="text-2xl font-semibold">
            {{ t('fastcat.browserCompatibility.title') }}
          </h1>
          <p class="text-sm leading-6 text-ui-text-muted">
            {{ t('fastcat.browserCompatibility.description') }}
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <div
          v-for="check in report.criticalFailures"
          :key="check.id"
          class="rounded-lg border border-error-500/30 bg-error-500/10 p-4"
        >
          <div class="flex items-start gap-3">
            <UIcon name="i-heroicons-x-circle" class="mt-0.5 h-5 w-5 shrink-0 text-error-400" />
            <div class="space-y-1">
              <h2 class="text-sm font-semibold text-error-100">
                {{ t(check.labelKey) }}
              </h2>
              <p class="text-sm leading-5 text-ui-text-muted">
                {{ t(check.descriptionKey) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div v-if="report.warnings.length" class="rounded-lg border border-warning-500/30 p-4">
        <h2 class="mb-3 text-sm font-semibold text-warning-200">
          {{ t('fastcat.browserCompatibility.limitedTitle') }}
        </h2>
        <ul class="space-y-2">
          <li v-for="check in report.warnings" :key="check.id" class="flex items-start gap-2">
            <UIcon
              name="i-heroicons-exclamation-circle"
              class="mt-0.5 h-4 w-4 shrink-0 text-warning-300"
            />
            <span class="text-sm text-ui-text-muted">{{ t(check.labelKey) }}</span>
          </li>
        </ul>
      </div>

      <p class="text-sm text-ui-text-muted">
        {{ t('fastcat.browserCompatibility.recommendation') }}
      </p>
    </section>
  </div>
</template>
