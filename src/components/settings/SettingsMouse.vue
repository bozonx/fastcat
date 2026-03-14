<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import {
  TIMELINE_WHEEL_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  CLICK_ACTIONS,
  MIDDLE_CLICK_ACTIONS,
  RULER_WHEEL_ACTIONS,
  RULER_CLICK_ACTIONS,
  RULER_DOUBLE_CLICK_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
  DRAG_ACTIONS,
  SHIFT_CLICK_ACTIONS,
} from '~/utils/mouse';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

const commonWheelLabels = computed(() => ({
  scroll_vertical: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
  scroll_horizontal: t('videoEditor.settings.mouseActionScrollHorizontal', 'Horizontal scroll'),
  zoom_horizontal: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
  zoom_vertical: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
  seek_frame: t('videoEditor.settings.mouseActionSeekFrame', 'Seek (1 frame)'),
  seek_second: t('videoEditor.settings.mouseActionSeekSecond', 'Seek (1 second)'),
  none: t('videoEditor.settings.mouseActionNone', 'None'),
  resize_track: t('videoEditor.settings.mouseActionResizeTrack', 'Resize track height'),
  zoom: t('videoEditor.settings.mouseActionZoom', 'Zoom'),
  reset_zoom: t('videoEditor.settings.mouseActionResetZoom', 'Reset zoom'),
  reset_zoom_center: t('videoEditor.settings.mouseActionResetZoomCenter', 'Reset zoom and center'),
  clear_selection: t('videoEditor.settings.mouseActionClearSelection', 'Clear selection'),
  seek: t('videoEditor.settings.mouseActionSeek', 'Set playhead'),
  add_marker: t('videoEditor.settings.mouseActionAddMarker', 'Add marker'),
}));

function getWheelOptions(actions: readonly string[]) {
  const labels = commonWheelLabels.value as Record<string, string>;
  return actions.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
}

const clickActionOptions = computed(() => {
  const labels = commonWheelLabels.value as Record<string, string>;
  return CLICK_ACTIONS.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
});

const dragOptions = computed(() => {
  const labels: Record<string, string> = {
    pan: t('videoEditor.settings.mouseActionPan', 'Pan'),
    move_playhead: t('videoEditor.settings.mouseActionMovePlayhead', 'Move playhead'),
    select_area: t('videoEditor.settings.mouseActionSelectArea', 'Select area'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  };
  return DRAG_ACTIONS.map((action) => ({ label: labels[action] || action, value: action }));
});

const rulerWheelOptions = computed(() => getWheelOptions(RULER_WHEEL_ACTIONS));
const timelineWheelOptions = computed(() => getWheelOptions(TIMELINE_WHEEL_ACTIONS));
const trackHeadersWheelOptions = computed(() => getWheelOptions(TRACK_HEADERS_WHEEL_ACTIONS));
const monitorWheelOptions = computed(() => getWheelOptions(MONITOR_WHEEL_ACTIONS));

const monitorMiddleClickOptions = computed(() => {
  const labels = commonWheelLabels.value as Record<string, string>;
  return MONITOR_CLICK_ACTIONS.map((action) => ({
    label: labels[action] || (action === 'none' ? t('videoEditor.settings.mouseActionNone', 'None') : action),
    value: action,
  }));
});

const monitorMiddleDragOptions = computed(() => {
  const labels = dragOptions.value.reduce(
    (acc, curr) => {
      acc[curr.value] = curr.label;
      return acc;
    },
    {} as Record<string, string>,
  );
  return MONITOR_DRAG_ACTIONS.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
});

function resetDefaults() {
  workspaceStore.userSettings.mouse.ruler = { ...DEFAULT_USER_SETTINGS.mouse.ruler };
  workspaceStore.userSettings.mouse.timeline = { ...DEFAULT_USER_SETTINGS.mouse.timeline };
  workspaceStore.userSettings.mouse.trackHeaders = { ...DEFAULT_USER_SETTINGS.mouse.trackHeaders };
  workspaceStore.userSettings.mouse.monitor = { ...DEFAULT_USER_SETTINGS.mouse.monitor };
  isResetConfirmOpen.value = false;
}

function isDefault(category: keyof typeof DEFAULT_USER_SETTINGS.mouse, key: string, value: string) {
  return (DEFAULT_USER_SETTINGS.mouse[category] as any)[key] === value;
}

function isModified(category: keyof typeof DEFAULT_USER_SETTINGS.mouse, key: string) {
  return (
    (workspaceStore.userSettings.mouse[category] as any)[key] !==
    (DEFAULT_USER_SETTINGS.mouse[category] as any)[key]
  );
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetMouseSettingsConfirmTitle', 'Reset mouse settings?')"
      :description="
        t(
          'videoEditor.settings.resetMouseSettingsConfirmDesc',
          'This will restore all mouse actions to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.resetMouseSettingsConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="text-sm font-semibold text-ui-text">
        {{ t('videoEditor.settings.userMouse', 'Mouse') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.settings.mouseRuler', 'Ruler') }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <!-- Wheels Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'wheel') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.wheel"
                    :items="rulerWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) => (workspaceStore.userSettings.mouse.ruler.wheel = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'wheel', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'wheelShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.wheelShift"
                    :items="rulerWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.wheelShift = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'wheelShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'wheelSecondary') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.wheelSecondary"
                    :items="rulerWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.wheelSecondary = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'wheelSecondary', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'wheelSecondaryShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{
                      t(
                        'videoEditor.settings.mouseTimelineWheelSecondaryShift',
                        'Secondary wheel + Shift',
                      )
                    }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.wheelSecondaryShift"
                    :items="rulerWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.wheelSecondaryShift =
                          v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'wheelSecondaryShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <!-- Drags Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'drag') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineDrag', 'Left button drag') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.drag"
                    :items="dragOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) => (workspaceStore.userSettings.mouse.ruler.drag = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'drag', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'dragShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseRulerDragShift', 'Left button drag + Shift') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.dragShift"
                    :items="dragOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.dragShift = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'dragShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'middleDrag') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.middleDrag"
                    :items="dragOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.middleDrag = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'middleDrag', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <!-- Clicks Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'click') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseRulerClick', 'Single Click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.click"
                    :items="clickActionOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) => (workspaceStore.userSettings.mouse.ruler.click = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'click', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'shiftClick') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineShiftClick', 'Shift + Click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.shiftClick"
                    :items="clickActionOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.shiftClick = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'shiftClick', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'middleClick') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle button click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.middleClick"
                    :items="clickActionOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.middleClick = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'middleClick', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('ruler', 'doubleClick') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseRulerDoubleClick', 'Double click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.ruler.doubleClick"
                    :items="clickActionOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.ruler.doubleClick = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('ruler', 'doubleClick', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.settings.mouseTimeline', 'Timeline') }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <!-- Wheels Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'wheel') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.wheel"
                    :items="timelineWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) => (workspaceStore.userSettings.mouse.timeline.wheel = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'wheel', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'wheelShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.wheelShift"
                    :items="timelineWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.wheelShift = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'wheelShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'wheelSecondary') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.wheelSecondary"
                    :items="timelineWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.wheelSecondary = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'wheelSecondary', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'wheelSecondaryShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{
                      t(
                        'videoEditor.settings.mouseTimelineWheelSecondaryShift',
                        'Secondary wheel + Shift',
                      )
                    }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.wheelSecondaryShift"
                    :items="timelineWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.wheelSecondaryShift =
                          v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'wheelSecondaryShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <!-- Drags Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'middleDrag') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.middleDrag"
                    :items="dragOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.middleDrag = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'middleDrag', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <!-- Clicks Group -->
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('timeline', 'middleClick') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle button click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.middleClick"
                    :items="clickActionOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.middleClick = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('timeline', 'middleClick', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.settings.mouseTrackHeaders', 'Track Headers') }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('trackHeaders', 'wheel') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.trackHeaders.wheel"
                    :items="trackHeadersWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.trackHeaders.wheel = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('trackHeaders', 'wheel', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('trackHeaders', 'wheelShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.trackHeaders.wheelShift"
                    :items="trackHeadersWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.trackHeaders.wheelShift = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('trackHeaders', 'wheelShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('trackHeaders', 'wheelSecondary') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.trackHeaders.wheelSecondary"
                    :items="trackHeadersWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.trackHeaders.wheelSecondary =
                          v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('trackHeaders', 'wheelSecondary', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('trackHeaders', 'wheelSecondaryShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{
                      t(
                        'videoEditor.settings.mouseTimelineWheelSecondaryShift',
                        'Secondary wheel + Shift',
                      )
                    }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.trackHeaders.wheelSecondaryShift"
                    :items="trackHeadersWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.trackHeaders.wheelSecondaryShift =
                          v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('trackHeaders', 'wheelSecondaryShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <div class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.settings.mouseMonitor', 'Monitor') }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'wheel') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseMonitorWheel', 'Wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.wheel"
                    :items="monitorWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) => (workspaceStore.userSettings.mouse.monitor.wheel = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'wheel', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'wheelShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.wheelShift"
                    :items="monitorWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.wheelShift = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'wheelShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'wheelSecondary') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.wheelSecondary"
                    :items="monitorWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.wheelSecondary = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'wheelSecondary', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'wheelSecondaryShift') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{
                      t(
                        'videoEditor.settings.mouseTimelineWheelSecondaryShift',
                        'Secondary wheel + Shift',
                      )
                    }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.wheelSecondaryShift"
                    :items="monitorWheelOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.wheelSecondaryShift =
                          v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'wheelSecondaryShift', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'middleDrag') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.middleDrag"
                    :items="monitorMiddleDragOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.middleDrag = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'middleDrag', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td
                  class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50"
                  :class="{ 'bg-yellow-400/10': isModified('monitor', 'middleClick') }"
                >
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseMonitorMiddleClick', 'Middle button click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.middleClick"
                    :items="monitorMiddleClickOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.middleClick = v?.value ?? v)
                    "
                  >
                    <template #item-label="{ item }">
                      <span class="flex items-center gap-2">
                        {{ item.label }}
                        <span
                          v-if="isDefault('monitor', 'middleClick', item.value)"
                          class="text-[10px] opacity-50 font-normal italic"
                        >
                          ({{ t('common.default', 'Default') }})
                        </span>
                      </span>
                    </template>
                  </USelectMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="text-[10px] text-ui-text-muted italic px-1">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .fastcat/user.settings.json') }}
    </div>
  </div>
</template>
