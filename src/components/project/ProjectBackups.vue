<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

defineProps<{
  compact?: boolean;
}>();

const { locale, t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();

const isReadOnly = computed(() => projectStore.isReadOnly || timelineStore.previewMode);
const isClearBackupsConfirmOpen = ref(false);

const hasBackups = computed(() => {
  return versions.value.some((v) => v.type === 'backup');
});

async function handleClearBackups() {
  isClearBackupsConfirmOpen.value = false;
  await timelineStore.clearAllBackups();
}

onMounted(() => {
  timelineStore.loadBackupVersions();
});

watch(
  () => timelineStore.currentTimelinePath,
  () => {
    timelineStore.loadBackupVersions();
  },
);

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

const versions = computed(() => timelineStore.backupVersions);
</script>

<template>
  <div class="h-full flex flex-col bg-ui-bg-elevated overflow-hidden">
    <!-- Clear Backups Confirmation Modal -->
    <UiConfirmModal
      v-model:open="isClearBackupsConfirmOpen"
      :title="t('videoEditor.projectSettings.clearBackupsTitle')"
      :description="
        t(
          'videoEditor.projectSettings.clearBackupsDescription',
          'This will delete all auto-saved timeline backups for this project. This action cannot be undone.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.clearTempConfirm')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="handleClearBackups"
    />

    <!-- Header with Refresh Button -->
    <div
      class="px-4 py-2.5 border-b border-ui-border flex items-center justify-between bg-ui-bg shrink-0"
    >
      <span class="text-xs text-ui-text-muted font-semibold uppercase tracking-wider">
        {{ t('videoEditor.timeline.backups.title') }}
      </span>
      <div class="flex items-center gap-1.5">
        <!-- Clear Backups Button -->
        <UTooltip
          v-if="hasBackups"
          :text="t('videoEditor.projectSettings.clearBackups')"
        >
          <UButton
            icon="i-heroicons-trash"
            size="xs"
            variant="ghost"
            color="error"
            class="cursor-pointer"
            :disabled="isReadOnly"
            @click="isClearBackupsConfirmOpen = true"
          />
        </UTooltip>
        <!-- Refresh Button -->
        <UButton
          icon="i-heroicons-arrow-path"
          size="xs"
          variant="ghost"
          color="neutral"
          class="cursor-pointer"
          @click="timelineStore.loadBackupVersions()"
        />
      </div>
    </div>

    <!-- Table content -->
    <div class="flex-1 overflow-auto custom-scrollbar">
      <table
        v-if="versions.length > 0"
        class="w-full text-left text-xs border-collapse table-fixed"
      >
        <thead
          class="sticky top-0 bg-ui-bg-elevated/95 backdrop-blur-sm z-10 border-b border-ui-border uppercase tracking-wider text-ui-text-muted font-semibold"
        >
          <tr>
            <th class="px-3 py-2.5 w-1/3">{{ t('videoEditor.timeline.backups.version') }}</th>
            <th class="px-3 py-2.5 w-1/4">{{ t('videoEditor.timeline.backups.date') }}</th>
            <th class="px-3 py-2.5 w-1/6">{{ t('videoEditor.timeline.backups.size') }}</th>
            <th class="px-3 py-2.5 text-right w-1/4">
              {{ t('videoEditor.timeline.backups.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ui-border/40">
          <tr
            v-for="version in versions"
            :key="version.path"
            class="hover:bg-ui-bg-muted/30 transition-colors"
          >
            <!-- Name / Type Badge -->
            <td class="px-3 py-3 align-middle truncate font-medium text-ui-text">
              <div class="flex flex-col gap-1">
                <span class="truncate" :title="version.name">{{ version.name }}</span>
                <div class="flex">
                  <span
                    v-if="version.type === 'main'"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-500/10 text-primary-400 border border-primary-500/20"
                  >
                    {{ t('videoEditor.timeline.backups.mainFile') }}
                  </span>
                  <span
                    v-else-if="version.type === 'autosave'"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  >
                    {{ t('videoEditor.timeline.backups.autosave') }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/10 text-neutral-400 border border-neutral-500/20"
                  >
                    {{ version.label }}
                  </span>
                </div>
              </div>
            </td>

            <!-- Date -->
            <td class="px-3 py-3 align-middle text-ui-text-muted whitespace-nowrap">
              {{ formatDate(version.date) }}
            </td>

            <!-- Size -->
            <td class="px-3 py-3 align-middle text-ui-text-muted font-mono whitespace-nowrap">
              {{ formatSize(version.size) }}
            </td>

            <!-- Actions -->
            <td class="px-3 py-3 align-middle text-right">
              <div class="flex items-center justify-end gap-1.5">
                <!-- Preview / Open -->
                <UTooltip :text="t('videoEditor.timeline.backups.actionsLabel.open')">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-heroicons-eye"
                    class="cursor-pointer"
                    @click="timelineStore.openVersionForPreview(version)"
                  />
                </UTooltip>

                <!-- Restore -->
                <UTooltip :text="t('videoEditor.timeline.backups.actionsLabel.restore')">
                  <UButton
                    size="xs"
                    color="primary"
                    variant="ghost"
                    icon="i-heroicons-arrow-path-20-solid"
                    class="cursor-pointer"
                    :disabled="isReadOnly"
                    @click="timelineStore.restoreVersion(version)"
                  />
                </UTooltip>

                <!-- Delete (only for non-main) -->
                <UTooltip
                  v-if="version.type !== 'main'"
                  :text="t('videoEditor.timeline.backups.actionsLabel.delete')"
                >
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-heroicons-trash"
                    class="cursor-pointer"
                    :disabled="isReadOnly"
                    @click="timelineStore.deleteBackupVersion(version)"
                  />
                </UTooltip>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty State -->
      <UiEmptyState
        v-else
        :message="t('videoEditor.timeline.backups.empty')"
        icon="i-heroicons-archive-box"
        icon-class="w-8 h-8 mx-auto mb-3 opacity-20"
        wrapper-class="h-full flex flex-col items-center justify-center p-8 opacity-40 select-none"
      />
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar {
  scrollbar-width: thin;
}
</style>
