<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import {
  gatherVideoDiagnostics,
  type VideoDiagnosticsSnapshot,
  type VideoDiagnosticsStatus,
} from '~/utils/settings/videoDiagnostics';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const diagnostics = ref<VideoDiagnosticsSnapshot | null>(null);
const isLoadingDiagnostics = ref(false);

const statusToneClasses: Record<VideoDiagnosticsStatus['tone'], string> = {
  danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  neutral: 'border-ui-border-muted bg-ui-bg-muted/50 text-ui-text',
  success: 'border-green-500/30 bg-green-500/10 text-green-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

const sectionContainerClasses: Record<VideoDiagnosticsStatus['tone'], string> = {
  danger: 'border-red-500/50 bg-red-500/10',
  neutral: 'border-ui-border-muted bg-transparent',
  success: 'border-ui-border-muted bg-transparent',
  warning: 'border-amber-500/50 bg-amber-500/10',
};

async function loadDiagnostics() {
  isLoadingDiagnostics.value = true;

  try {
    diagnostics.value = await gatherVideoDiagnostics({
      createCanvas: () => document.createElement('canvas') as unknown as { getContext: (name: string) => unknown },
      probe: {
        audioBitrate: 128_000,
        audioChannels: 2,
        audioCodec: workspaceStore.userSettings.exportDefaults.encoding.audioCodec,
        audioSampleRate: workspaceStore.userSettings.exportDefaults.encoding.audioSampleRate,
        framerate: workspaceStore.userSettings.projectDefaults.fps,
        height: workspaceStore.userSettings.projectDefaults.height,
        videoBitrate: Math.round(
          workspaceStore.userSettings.exportDefaults.encoding.bitrateMbps * 1_000_000,
        ),
        videoCodec: workspaceStore.userSettings.exportDefaults.encoding.videoCodec,
        width: workspaceStore.userSettings.projectDefaults.width,
      },
    });
  } catch {
    diagnostics.value = null;
  } finally {
    isLoadingDiagnostics.value = false;
  }
}

onMounted(async () => {
  await loadDiagnostics();
});

function resetDefaults() {
  workspaceStore.userSettings.video = { ...DEFAULT_USER_SETTINGS.video };
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.video.performance', 'Performance') }}
      </div>
      <div class="flex items-center gap-2">
        <UButton size="xs" color="neutral" variant="ghost" @click="loadDiagnostics">
          {{ t('videoEditor.settings.video.refreshDiagnostics', 'Refresh diagnostics') }}
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
          {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
        </UButton>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div class="text-sm font-medium text-ui-text-muted">
        {{ t('videoEditor.settings.video.accelerationDiagnostics', 'Acceleration diagnostics') }}
      </div>

      <div
        v-if="diagnostics"
        class="rounded-lg border border-ui-border-muted bg-ui-bg-muted/30 p-4 flex flex-col gap-2"
      >
        <div
          class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium"
          :class="statusToneClasses[diagnostics.summary.tone]"
        >
          {{ diagnostics.summary.label }}
        </div>
        <div
          class="text-sm text-ui-text-muted"
        >
          {{
            t(
              'videoEditor.settings.video.accelerationDiagnosticsHelp',
              'The current app uses WebGL for preview compositing and WebCodecs for browser-side encoding when available.',
            )
          }}
        </div>
      </div>

      <div v-else-if="isLoadingDiagnostics" class="text-sm text-ui-text-muted">
        {{ t('videoEditor.settings.video.loadingDiagnostics', 'Collecting browser media diagnostics…') }}
      </div>

      <div v-else class="text-sm text-ui-text-muted">
        {{
          t(
            'videoEditor.settings.video.unavailableDiagnostics',
            'Diagnostics are unavailable in the current environment.',
          )
        }}
      </div>

      <div v-if="diagnostics" class="flex flex-col gap-4">
        <div
          v-for="section in diagnostics.sections"
          :key="section.title"
          class="rounded-lg border p-4 flex flex-col gap-3"
          :class="sectionContainerClasses[section.status.tone]"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1">
              <div class="text-sm font-medium text-ui-text">
                {{ section.title }}
              </div>
              <div class="text-xs text-ui-text-muted">
                {{ section.description }}
              </div>
            </div>
            <div
              class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
              :class="statusToneClasses[section.status.tone]"
            >
              {{ section.status.label }}
            </div>
          </div>

          <div class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30">
            <div
              v-for="item in section.items"
              :key="`${section.title}-${item.label}`"
              class="flex items-start justify-between gap-4 px-3 py-2.5"
            >
              <span class="text-sm text-ui-text-muted">{{ item.label }}</span>
              <span class="text-sm text-right text-ui-text font-medium break-all">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Settings -->
    <div class="flex flex-col gap-4">
      <label class="flex items-start gap-3 cursor-pointer group">
        <UCheckbox v-model="workspaceStore.userSettings.video.enableFfmpeg" class="mt-0.5" />
        <div class="flex flex-col gap-0.5">
          <span class="text-sm text-ui-text group-hover:text-ui-text-highlight transition-colors">
            {{ t('videoEditor.settings.video.enableFfmpeg', 'Use FFmpeg') }}
          </span>
          <span class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.video.enableFfmpegHelp',
                'Enables FFmpeg for certain video processing operations',
              )
            }}
          </span>
        </div>
      </label>
    </div>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
