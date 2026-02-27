<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import AppModal from '~/components/ui/AppModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import {
  hotkeyFromKeyboardEvent,
  isEditableTarget,
  normalizeHotkeyCombo,
} from '~/utils/hotkeys/hotkeyUtils';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

type SettingsSection =
  | 'user.general'
  | 'user.hotkeys'
  | 'user.mouse'
  | 'user.optimization'
  | 'user.export'
  | 'workspace.storage';

const activeSection = ref<SettingsSection>('user.general');

const isCapturingHotkey = ref(false);
const captureTargetCommandId = ref<HotkeyCommandId | null>(null);
const capturedCombo = ref<string | null>(null);
const isDuplicateConfirmOpen = ref(false);
const duplicateWarningText = ref('');

const isClearWorkspaceVardataConfirmOpen = ref(false);

async function confirmClearWorkspaceVardata() {
  isClearWorkspaceVardataConfirmOpen.value = false;
  await workspaceStore.clearVardata();
}

function getCommandTitle(cmdId: HotkeyCommandId): string {
  return DEFAULT_HOTKEYS.commands.find((c) => c.id === cmdId)?.title ?? cmdId;
}

function getCommandGroupTitle(groupId: string): string {
  if (groupId === 'general') return t('videoEditor.settings.hotkeysGroupGeneral', 'General');
  if (groupId === 'playback') return t('videoEditor.settings.hotkeysGroupPlayback', 'Playback');
  if (groupId === 'timeline') return t('videoEditor.settings.hotkeysGroupTimeline', 'Timeline');
  return groupId;
}

function getCurrentBindings(cmdId: HotkeyCommandId): string[] {
  const overrides = workspaceStore.userSettings.hotkeys.bindings[cmdId];
  if (Array.isArray(overrides)) return overrides;
  return DEFAULT_HOTKEYS.bindings[cmdId] ?? [];
}

function setBindings(cmdId: HotkeyCommandId, next: string[]) {
  workspaceStore.userSettings.hotkeys.bindings[cmdId] = [...next];
}

function removeBinding(cmdId: HotkeyCommandId, combo: string) {
  const next = getCurrentBindings(cmdId).filter((c) => c !== combo);
  setBindings(cmdId, next);
}

function findDuplicateOwner(combo: string, targetCmdId: HotkeyCommandId): HotkeyCommandId | null {
  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
  for (const cmd of DEFAULT_HOTKEYS.commands) {
    if (cmd.id === targetCmdId) continue;
    const bindings = effective[cmd.id];
    if (bindings.includes(combo)) return cmd.id;
  }
  return null;
}

function finishCapture() {
  isCapturingHotkey.value = false;
  captureTargetCommandId.value = null;
}

function startCapture(cmdId: HotkeyCommandId) {
  if (isCapturingHotkey.value) return;
  isCapturingHotkey.value = true;
  captureTargetCommandId.value = cmdId;
  capturedCombo.value = null;

  const handler = (e: KeyboardEvent) => {
    if (!isCapturingHotkey.value) {
      window.removeEventListener('keydown', handler, true);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      window.removeEventListener('keydown', handler, true);
      finishCapture();
      return;
    }

    if (isEditableTarget(e.target)) {
      return;
    }

    const comboRaw = hotkeyFromKeyboardEvent(e);
    const combo = comboRaw ? normalizeHotkeyCombo(comboRaw) : null;
    if (!combo) return;

    e.preventDefault();
    window.removeEventListener('keydown', handler, true);
    capturedCombo.value = combo;

    const target = captureTargetCommandId.value;
    if (!target) {
      finishCapture();
      return;
    }

    const owner = findDuplicateOwner(combo, target);
    if (owner) {
      duplicateWarningText.value = `${combo} is already assigned to ${getCommandTitle(owner)}.`;
      isDuplicateConfirmOpen.value = true;
      return;
    }

    const next = [...getCurrentBindings(target), combo];
    setBindings(target, Array.from(new Set(next)));
    finishCapture();
  };

  window.addEventListener('keydown', handler, true);
}

function confirmAddDuplicate() {
  const target = captureTargetCommandId.value;
  const combo = capturedCombo.value;
  if (!target || !combo) {
    isDuplicateConfirmOpen.value = false;
    finishCapture();
    return;
  }

  const next = [...getCurrentBindings(target), combo];
  setBindings(target, Array.from(new Set(next)));
  isDuplicateConfirmOpen.value = false;
  finishCapture();
}

const hotkeyGroups = computed(() => {
  const groupIds = Array.from(new Set(DEFAULT_HOTKEYS.commands.map((c) => c.groupId)));
  return groupIds.map((groupId) => ({
    id: groupId,
    title: getCommandGroupTitle(groupId),
    commands: DEFAULT_HOTKEYS.commands.filter((c) => c.groupId === groupId),
  }));
});

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

const videoCodecSupport = ref<Record<string, boolean>>({});
const isLoadingCodecSupport = ref(false);

const videoCodecOptions = computed(() =>
  resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
);

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return;
  isLoadingCodecSupport.value = true;
  try {
    videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    const selected = workspaceStore.userSettings.exportDefaults.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find(
        (opt) => videoCodecSupport.value[opt.value],
      );
      if (firstSupported)
        workspaceStore.userSettings.exportDefaults.encoding.videoCodec = firstSupported.value;
    }
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

loadCodecSupport();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const proxyLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.proxyStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.proxyStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const cacheLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.cacheStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.cacheStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const thumbnailsLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes = Math.round(
      n * 1024 * 1024 * 1024,
    );
  },
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.title', 'Editor settings')"
    :ui="{
      content: 'sm:max-w-4xl h-[90vh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <UiConfirmModal
      v-model:open="isDuplicateConfirmOpen"
      :title="t('videoEditor.settings.hotkeysDuplicateTitle', 'Duplicate hotkey')"
      :description="duplicateWarningText"
      :confirm-text="t('videoEditor.settings.hotkeysDuplicateConfirm', 'Add anyway')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="confirmAddDuplicate"
    />

    <UiConfirmModal
      v-model:open="isClearWorkspaceVardataConfirmOpen"
      :title="t('videoEditor.settings.clearTempWorkspaceTitle', 'Clear temporary files')"
      :description="
        t(
          'videoEditor.settings.clearTempWorkspaceDescription',
          'This will delete all generated proxies, thumbnails and cached data in this workspace.',
        )
      "
      :confirm-text="t('videoEditor.settings.clearTempWorkspaceConfirm', 'Clear')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearWorkspaceVardata"
    />

    <div class="flex flex-1 min-h-0 w-full h-full">
      <div class="w-56 shrink-0 p-6 bg-ui-bg border-r border-ui-border overflow-y-auto">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.userSection', 'User settings') }}
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userGeneral', 'General')"
              :disabled="activeSection === 'user.general'"
              @click="activeSection = 'user.general'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userHotkeys', 'Hotkeys')"
              :disabled="activeSection === 'user.hotkeys'"
              @click="activeSection = 'user.hotkeys'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userMouse', 'Mouse')"
              :disabled="activeSection === 'user.mouse'"
              @click="activeSection = 'user.mouse'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userOptimization', 'Optimization')"
              :disabled="activeSection === 'user.optimization'"
              @click="activeSection = 'user.optimization'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userExport', 'Export')"
              :disabled="activeSection === 'user.export'"
              @click="activeSection = 'user.export'"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.workspaceSection', 'Workspace settings') }}
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.workspaceStorage', 'Storage')"
              :disabled="activeSection === 'workspace.storage'"
              @click="activeSection = 'workspace.storage'"
            />
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0 p-6 overflow-y-auto">
        <div v-if="activeSection === 'user.general'" class="flex flex-col gap-4">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.userGeneral', 'General') }}
          </div>

          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.openLastProjectOnStart" />
            <span class="text-sm text-ui-text">
              {{ t('videoEditor.settings.openLastProjectOnStart', 'Open last project on start') }}
            </span>
          </label>

          <UFormField
            :label="t('videoEditor.settings.stopFramesQuality', 'Stop frame quality')"
            :help="t('videoEditor.settings.stopFramesQualityHint', 'WebP quality (1-100)')"
          >
            <UInput
              v-model.number="workspaceStore.userSettings.stopFrames.qualityPercent"
              type="number"
              min="1"
              max="100"
              step="1"
            />
          </UFormField>

          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.hotkeys'" class="flex flex-col gap-6">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.settings.userHotkeys', 'Hotkeys') }}
            </div>
            <div v-if="isCapturingHotkey" class="text-xs text-ui-text-muted">
              {{
                t(
                  'videoEditor.settings.hotkeysCaptureHint',
                  'Press a key combination (Esc to cancel)',
                )
              }}
            </div>
          </div>

          <div class="flex flex-col gap-6">
            <div v-for="group in hotkeyGroups" :key="group.id" class="flex flex-col gap-3">
              <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
                {{ group.title }}
              </div>

              <div class="flex flex-col gap-3">
                <div
                  v-for="cmd in group.commands"
                  :key="cmd.id"
                  class="p-3 rounded border border-ui-border"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-sm text-ui-text">
                      {{ cmd.title }}
                    </div>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="isCapturingHotkey"
                      :label="
                        isCapturingHotkey && captureTargetCommandId === cmd.id
                          ? t('videoEditor.settings.hotkeysCapturing', 'Listening...')
                          : t('videoEditor.settings.hotkeysAdd', 'Add')
                      "
                      @click="startCapture(cmd.id)"
                    />
                  </div>

                  <div class="mt-3 flex flex-wrap gap-2">
                    <div
                      v-for="combo in getCurrentBindings(cmd.id)"
                      :key="combo"
                      class="inline-flex items-center gap-2 px-2 py-1 rounded bg-ui-bg-accent"
                    >
                      <span class="text-xs font-mono text-ui-text">{{ combo }}</span>
                      <UButton
                        size="2xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-heroicons-x-mark"
                        :aria-label="t('common.remove', 'Remove')"
                        @click="removeBinding(cmd.id, combo)"
                      />
                    </div>

                    <div
                      v-if="getCurrentBindings(cmd.id).length === 0"
                      class="text-xs text-ui-text-muted"
                    >
                      {{ t('videoEditor.settings.hotkeysNotSet', 'Not set') }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.mouse'" class="flex flex-col gap-6">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.userMouse', 'Mouse') }}
          </div>

          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4">
              <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
                {{ t('videoEditor.settings.mouseTimeline', 'Timeline') }}
              </div>

              <UFormField :label="t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel')">
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.timeline.wheel"
                  :items="[
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
                      value: 'zoom_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
                      value: 'zoom_vertical',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) => (workspaceStore.userSettings.mouse.timeline.wheel = v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift')"
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.timeline.wheelShift"
                  :items="[
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
                      value: 'zoom_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
                      value: 'zoom_vertical',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.timeline.wheelShift = v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel')"
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.timeline.wheelSecondary"
                  :items="[
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
                      value: 'zoom_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
                      value: 'zoom_vertical',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.timeline.wheelSecondary = v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="
                  t(
                    'videoEditor.settings.mouseTimelineWheelSecondaryShift',
                    'Secondary wheel + Shift',
                  )
                "
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.timeline.wheelSecondaryShift"
                  :items="[
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
                      value: 'zoom_horizontal',
                    },
                    {
                      label: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
                      value: 'zoom_vertical',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.timeline.wheelSecondaryShift =
                        v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle click')"
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.timeline.middleClick"
                  :items="[
                    { label: t('videoEditor.settings.mouseActionPan', 'Pan'), value: 'pan' },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.timeline.middleClick = v?.value ?? v)
                  "
                />
              </UFormField>
            </div>

            <div class="flex flex-col gap-4">
              <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
                {{ t('videoEditor.settings.mouseMonitor', 'Monitor') }}
              </div>

              <UFormField :label="t('videoEditor.settings.mouseMonitorWheel', 'Wheel')">
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.monitor.wheel"
                  :items="[
                    { label: t('videoEditor.settings.mouseActionZoom', 'Zoom'), value: 'zoom' },
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) => (workspaceStore.userSettings.mouse.monitor.wheel = v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="t('videoEditor.settings.mouseMonitorWheelShift', 'Wheel + Shift')"
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.monitor.wheelShift"
                  :items="[
                    { label: t('videoEditor.settings.mouseActionZoom', 'Zoom'), value: 'zoom' },
                    {
                      label: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
                      value: 'scroll_vertical',
                    },
                    {
                      label: t(
                        'videoEditor.settings.mouseActionScrollHorizontal',
                        'Horizontal scroll',
                      ),
                      value: 'scroll_horizontal',
                    },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.monitor.wheelShift = v?.value ?? v)
                  "
                />
              </UFormField>

              <UFormField
                :label="t('videoEditor.settings.mouseMonitorMiddleClick', 'Middle click')"
              >
                <USelectMenu
                  v-model="workspaceStore.userSettings.mouse.monitor.middleClick"
                  :items="[
                    { label: t('videoEditor.settings.mouseActionPan', 'Pan'), value: 'pan' },
                    { label: t('videoEditor.settings.mouseActionNone', 'None'), value: 'none' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  @update:model-value="
                    (v: any) =>
                      (workspaceStore.userSettings.mouse.monitor.middleClick = v?.value ?? v)
                  "
                />
              </UFormField>
            </div>
          </div>

          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.optimization'" class="flex flex-col gap-6">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.userOptimization', 'Optimization') }}
          </div>

          <div
            class="p-3 bg-primary-950/40 text-primary-200 rounded text-sm border border-primary-800/30"
          >
            {{
              t(
                'videoEditor.settings.proxyInfo',
                'Proxy files are used to improve playback performance in the editor. They are generated in WebM format with VP9 video codec and Opus audio codec.',
              )
            }}
          </div>

          <UFormField :label="t('videoEditor.settings.proxyResolution', 'Proxy resolution')">
            <USelectMenu
              v-model="workspaceStore.userSettings.optimization.proxyResolution"
              :items="[
                { label: '360p', value: '360p' },
                { label: '480p', value: '480p' },
                { label: '720p', value: '720p' },
                { label: '1080p', value: '1080p' },
              ]"
              value-key="value"
              label-key="label"
              class="w-full"
              @update:model-value="
                (v: any) =>
                  (workspaceStore.userSettings.optimization.proxyResolution = v?.value ?? v)
              "
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.proxyVideoBitrate', 'Video bitrate (Mbps)')"
            :help="
              t(
                'videoEditor.settings.proxyVideoBitrateHelp',
                'Higher bitrate means better quality but larger file size',
              )
            "
          >
            <UInput
              v-model.number="workspaceStore.userSettings.optimization.proxyVideoBitrateMbps"
              type="number"
              inputmode="numeric"
              min="0.1"
              max="50"
              step="0.1"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="t('videoEditor.settings.proxyAudioBitrate', 'Audio bitrate (kbps)')">
            <UInput
              v-model.number="workspaceStore.userSettings.optimization.proxyAudioBitrateKbps"
              type="number"
              inputmode="numeric"
              min="32"
              max="512"
              step="32"
              class="w-full"
            />
          </UFormField>

          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.optimization.proxyCopyOpusAudio" />
            <span class="text-sm text-ui-text">
              {{
                t(
                  'videoEditor.settings.proxyCopyOpusAudio',
                  'Copy Opus audio directly without re-encoding',
                )
              }}
            </span>
          </label>

          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.optimization.autoCreateProxies" />
            <span class="text-sm text-ui-text">
              {{
                t(
                  'videoEditor.settings.autoCreateProxies',
                  'Automatically create proxies when adding media to the timeline',
                )
              }}
            </span>
          </label>

          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.export'" class="flex flex-col gap-6">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.userExport', 'Export') }}
          </div>

          <MediaResolutionSettings
            v-model:width="workspaceStore.userSettings.exportDefaults.width"
            v-model:height="workspaceStore.userSettings.exportDefaults.height"
            v-model:fps="workspaceStore.userSettings.exportDefaults.fps"
            v-model:resolution-format="workspaceStore.userSettings.exportDefaults.resolutionFormat"
            v-model:orientation="workspaceStore.userSettings.exportDefaults.orientation"
            v-model:aspect-ratio="workspaceStore.userSettings.exportDefaults.aspectRatio"
            v-model:is-custom-resolution="
              workspaceStore.userSettings.exportDefaults.isCustomResolution
            "
            :disabled="false"
          />

          <MediaEncodingSettings
            v-model:output-format="workspaceStore.userSettings.exportDefaults.encoding.format"
            v-model:video-codec="workspaceStore.userSettings.exportDefaults.encoding.videoCodec"
            v-model:bitrate-mbps="workspaceStore.userSettings.exportDefaults.encoding.bitrateMbps"
            v-model:exclude-audio="workspaceStore.userSettings.exportDefaults.encoding.excludeAudio"
            v-model:audio-codec="workspaceStore.userSettings.exportDefaults.encoding.audioCodec"
            v-model:audio-bitrate-kbps="
              workspaceStore.userSettings.exportDefaults.encoding.audioBitrateKbps
            "
            :disabled="false"
            :has-audio="true"
            :is-loading-codec-support="isLoadingCodecSupport"
            :format-options="formatOptions"
            :video-codec-options="videoCodecOptions"
          />

          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else class="flex flex-col gap-4">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.workspaceStorage', 'Storage') }}
          </div>

          <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="text-sm font-medium text-ui-text">
                {{ t('videoEditor.settings.clearTempWorkspace', 'Clear temporary files') }}
              </div>
              <div class="text-xs text-ui-text-muted">
                {{
                  t(
                    'videoEditor.settings.clearTempWorkspaceHint',
                    'Removes all files from vardata in this workspace',
                  )
                }}
              </div>
            </div>

            <UButton
              color="warning"
              variant="soft"
              icon="i-heroicons-trash"
              :label="t('videoEditor.settings.clearTempWorkspaceAction', 'Clear')"
              @click="isClearWorkspaceVardataConfirmOpen = true"
            />
          </div>

          <UFormField
            :label="t('videoEditor.settings.proxyLimit', 'Proxy storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.proxyLimitHelp',
                'Total limit for all proxy files in this workspace',
              )
            "
          >
            <UInput
              v-model.number="proxyLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.cacheLimit', 'Cache storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.cacheLimitHelp',
                'Total limit for cached data in this workspace',
              )
            "
          >
            <UInput
              v-model.number="cacheLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.thumbnailsLimit', 'Thumbnails storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.thumbnailsLimitHelp',
                'Total limit for generated thumbnails in this workspace',
              )
            "
          >
            <UInput
              v-model.number="thumbnailsLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <div class="text-xs text-ui-text-muted">
            {{
              t('videoEditor.settings.workspaceSavedNote', 'Saved to .gran/workspace.settings.json')
            }}
          </div>
        </div>
      </div>
    </div>
  </AppModal>
</template>
