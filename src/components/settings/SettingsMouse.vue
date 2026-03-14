<script setup lang="ts">
import SettingsMouseSection from '~/components/settings/SettingsMouseSection.vue';
import SettingsMouseSelectRow from '~/components/settings/SettingsMouseSelectRow.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import {
  DRAG_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MOUSE_HORIZONTAL_MOVEMENT_ACTIONS,
  RULER_CLICK_ACTIONS,
  RULER_WHEEL_ACTIONS,
  SHIFT_CLICK_ACTIONS,
  TIMELINE_WHEEL_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
} from '~/utils/mouse';

type MouseSettings = typeof DEFAULT_USER_SETTINGS.mouse;
type MouseCategory = keyof MouseSettings;

interface SelectOption {
  label: string;
  value: string;
}

interface MouseRowConfig {
  key: string;
  label: string;
  options: SelectOption[];
}

interface MouseSectionConfig {
  key: MouseCategory;
  title: string;
  rows: MouseRowConfig[];
  infoItems: string[];
  infoTitle?: string;
  infoColumns?: boolean;
}

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

const defaultLabel = computed(() => t('common.default', 'Default'));

const commonWheelLabels = computed<Record<string, string>>(() => ({
  scroll_vertical: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
  scroll_horizontal: t('videoEditor.settings.mouseActionScrollHorizontal', 'Horizontal scroll'),
  zoom_horizontal: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
  zoom_vertical: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
  seek_frame: t('videoEditor.settings.mouseActionSeekFrame', 'Seek (1 frame)'),
  seek_second: t('videoEditor.settings.mouseActionSeekSecond', 'Seek (1 second)'),
  none: t('videoEditor.settings.mouseActionNone', 'None'),
  resize_track: t('videoEditor.settings.mouseActionResizeTrack', 'Resize track height'),
  zoom: t('videoEditor.settings.mouseActionZoom', 'Zoom'),
}));

const commonClickLabels = computed<Record<string, string>>(() => ({
  seek: t('videoEditor.settings.mouseActionSeek', 'Set playhead'),
  add_marker: t('videoEditor.settings.mouseActionAddMarker', 'Add marker'),
  reset_zoom: t('videoEditor.settings.mouseActionResetZoom', 'Reset zoom'),
  clear_selection: t('videoEditor.settings.mouseActionClearSelection', 'Clear selection'),
  select_area: t('videoEditor.settings.mouseActionSelectArea', 'Select area'),
  none: t('videoEditor.settings.mouseActionNone', 'None'),
}));

const commonDragLabels = computed<Record<string, string>>(() => ({
  pan: t('videoEditor.settings.mouseActionPan', 'Pan'),
  move_playhead: t('videoEditor.settings.mouseActionMovePlayhead', 'Move playhead'),
  select_area: t('videoEditor.settings.mouseActionSelectArea', 'Select area'),
  none: t('videoEditor.settings.mouseActionNone', 'None'),
}));

const commonHorizontalMovementLabels = computed<Record<string, string>>(() => ({
  move_playhead: t('videoEditor.settings.mouseActionMovePlayhead', 'Move playhead'),
  none: t('videoEditor.settings.mouseActionNone', 'None'),
}));

function formatOptions(actions: readonly string[], labels: Record<string, string>): SelectOption[] {
  return actions.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
}

const rulerWheelOptions = computed(() => formatOptions(RULER_WHEEL_ACTIONS, commonWheelLabels.value));
const timelineWheelOptions = computed(() =>
  formatOptions(TIMELINE_WHEEL_ACTIONS, commonWheelLabels.value),
);
const trackHeadersWheelOptions = computed(() =>
  formatOptions(TRACK_HEADERS_WHEEL_ACTIONS, commonWheelLabels.value),
);
const monitorWheelOptions = computed(() =>
  formatOptions(MONITOR_WHEEL_ACTIONS, commonWheelLabels.value),
);
const clickActionOptions = computed(() =>
  formatOptions(RULER_CLICK_ACTIONS, commonClickLabels.value),
);
const shiftClickActionOptions = computed(() =>
  formatOptions(SHIFT_CLICK_ACTIONS, commonClickLabels.value),
);
const dragOptions = computed(() => formatOptions(DRAG_ACTIONS, commonDragLabels.value));
const mouseHorizontalMovementOptions = computed(() =>
  formatOptions(MOUSE_HORIZONTAL_MOVEMENT_ACTIONS, commonHorizontalMovementLabels.value),
);
const monitorMiddleClickOptions = computed(() =>
  formatOptions(MONITOR_CLICK_ACTIONS, {
    reset_zoom: t('videoEditor.settings.mouseActionResetZoom', 'Reset zoom'),
    reset_zoom_center: t('videoEditor.settings.mouseActionResetZoomCenter', 'Reset zoom + center'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  }),
);
const monitorMiddleDragOptions = computed(() =>
  formatOptions(MONITOR_DRAG_ACTIONS, {
    pan: t('videoEditor.settings.mouseActionPan', 'Pan'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  }),
);

const sectionConfigs = computed(() => [
  {
    key: 'ruler',
    title: t('videoEditor.settings.mouseRuler', 'Ruler'),
    rows: [
      {
        key: 'wheel',
        label: t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel'),
        options: rulerWheelOptions.value,
      },
      {
        key: 'wheelShift',
        label: t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift'),
        options: rulerWheelOptions.value,
      },
      {
        key: 'wheelSecondary',
        label: t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel'),
        options: rulerWheelOptions.value,
      },
      {
        key: 'wheelSecondaryShift',
        label: t(
          'videoEditor.settings.mouseTimelineWheelSecondaryShift',
          'Secondary wheel + Shift',
        ),
        options: rulerWheelOptions.value,
      },
      {
        key: 'drag',
        label: t('videoEditor.settings.mouseTimelineDrag', 'Left button drag'),
        options: dragOptions.value,
      },
      {
        key: 'dragShift',
        label: t('videoEditor.settings.mouseRulerDragShift', 'Left button drag + Shift'),
        options: dragOptions.value,
      },
      {
        key: 'middleDrag',
        label: t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag'),
        options: dragOptions.value,
      },
      {
        key: 'click',
        label: t('videoEditor.settings.mouseRulerClick', 'Single Click'),
        options: clickActionOptions.value,
      },
      {
        key: 'shiftClick',
        label: t('videoEditor.settings.mouseTimelineShiftClick', 'Shift + Click'),
        options: shiftClickActionOptions.value,
      },
      {
        key: 'middleClick',
        label: t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle button click'),
        options: clickActionOptions.value,
      },
      {
        key: 'doubleClick',
        label: t('videoEditor.settings.mouseRulerDoubleClick', 'Double click'),
        options: clickActionOptions.value,
      },
      {
        key: 'horizontalMovement',
        label: t('videoEditor.settings.mouseHorizontalMovement', 'Horizontal mouse movement'),
        options: mouseHorizontalMovementOptions.value,
      },
    ],
    infoItems: [t('videoEditor.settings.mouseHardcodedLeftClick')],
  },
  {
    key: 'timeline',
    title: t('videoEditor.settings.mouseTimeline', 'Timeline'),
    rows: [
      {
        key: 'wheel',
        label: t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel'),
        options: timelineWheelOptions.value,
      },
      {
        key: 'wheelShift',
        label: t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift'),
        options: timelineWheelOptions.value,
      },
      {
        key: 'wheelSecondary',
        label: t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel'),
        options: timelineWheelOptions.value,
      },
      {
        key: 'wheelSecondaryShift',
        label: t(
          'videoEditor.settings.mouseTimelineWheelSecondaryShift',
          'Secondary wheel + Shift',
        ),
        options: timelineWheelOptions.value,
      },
      {
        key: 'middleDrag',
        label: t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag'),
        options: dragOptions.value,
      },
      {
        key: 'middleClick',
        label: t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle button click'),
        options: clickActionOptions.value,
      },
      {
        key: 'horizontalMovement',
        label: t('videoEditor.settings.mouseHorizontalMovement', 'Horizontal mouse movement'),
        options: mouseHorizontalMovementOptions.value,
      },
    ],
    infoTitle: t('videoEditor.settings.mouseHardcodedTitle', 'Fixed Functions'),
    infoColumns: true,
    infoItems: [
      t('videoEditor.settings.mouseHardcodedLeftDrag'),
      t('videoEditor.settings.mouseHardcodedShiftDrag'),
      t('videoEditor.settings.mouseHardcodedLeftClick'),
      t('videoEditor.settings.mouseHardcodedShiftClick'),
      t('videoEditor.settings.mouseHardcodedRazorClick'),
      t('videoEditor.settings.mouseHardcodedRazorShiftClick'),
      t('videoEditor.settings.mouseHardcodedRazorCtrlClick'),
    ],
  },
  {
    key: 'trackHeaders',
    title: t('videoEditor.settings.mouseTrackHeaders', 'Track Headers'),
    rows: [
      {
        key: 'wheel',
        label: t('videoEditor.settings.mouseTimelineWheel', 'Primary wheel'),
        options: trackHeadersWheelOptions.value,
      },
      {
        key: 'wheelShift',
        label: t('videoEditor.settings.mouseTimelineWheelShift', 'Primary wheel + Shift'),
        options: trackHeadersWheelOptions.value,
      },
      {
        key: 'wheelSecondary',
        label: t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel'),
        options: trackHeadersWheelOptions.value,
      },
      {
        key: 'wheelSecondaryShift',
        label: t(
          'videoEditor.settings.mouseTimelineWheelSecondaryShift',
          'Secondary wheel + Shift',
        ),
        options: trackHeadersWheelOptions.value,
      },
    ],
    infoItems: [t('videoEditor.settings.mouseHardcodedDblClickTrackHeader')],
  },
  {
    key: 'monitor',
    title: t('videoEditor.settings.mouseMonitor', 'Monitor'),
    rows: [
      {
        key: 'wheel',
        label: t('videoEditor.settings.mouseMonitorWheel', 'Wheel'),
        options: monitorWheelOptions.value,
      },
      {
        key: 'wheelShift',
        label: t('videoEditor.settings.mouseMonitorWheelShift', 'Wheel + Shift'),
        options: monitorWheelOptions.value,
      },
      {
        key: 'wheelSecondary',
        label: t('videoEditor.settings.mouseTimelineWheelSecondary', 'Secondary wheel'),
        options: monitorWheelOptions.value,
      },
      {
        key: 'wheelSecondaryShift',
        label: t(
          'videoEditor.settings.mouseTimelineWheelSecondaryShift',
          'Secondary wheel + Shift',
        ),
        options: monitorWheelOptions.value,
      },
      {
        key: 'middleDrag',
        label: t('videoEditor.settings.mouseTimelineMiddleDrag', 'Middle button drag'),
        options: monitorMiddleDragOptions.value,
      },
      {
        key: 'middleClick',
        label: t('videoEditor.settings.mouseMonitorMiddleClick', 'Middle button click'),
        options: monitorMiddleClickOptions.value,
      },
    ],
    infoItems: [t('videoEditor.settings.mouseHardcodedDblClickMonitor')],
  },
] satisfies MouseSectionConfig[]);

function resetDefaults() {
  workspaceStore.userSettings.mouse.ruler = { ...DEFAULT_USER_SETTINGS.mouse.ruler };
  workspaceStore.userSettings.mouse.timeline = { ...DEFAULT_USER_SETTINGS.mouse.timeline };
  workspaceStore.userSettings.mouse.trackHeaders = { ...DEFAULT_USER_SETTINGS.mouse.trackHeaders };
  workspaceStore.userSettings.mouse.monitor = { ...DEFAULT_USER_SETTINGS.mouse.monitor };
  isResetConfirmOpen.value = false;
}

function getSettingValue(category: MouseCategory, key: string) {
  return (workspaceStore.userSettings.mouse[category] as Record<string, string>)[key] ?? '';
}

function updateSetting(category: MouseCategory, key: string, value: string) {
  (workspaceStore.userSettings.mouse[category] as Record<string, string>)[key] = value;
}

function isDefault(category: MouseCategory, key: string, value: string) {
  return (DEFAULT_USER_SETTINGS.mouse[category] as Record<string, string>)[key] === value;
}

function isModified(category: MouseCategory, key: string) {
  return (
    (workspaceStore.userSettings.mouse[category] as Record<string, string>)[key] !==
    (DEFAULT_USER_SETTINGS.mouse[category] as Record<string, string>)[key]
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
      <SettingsMouseSection
        v-for="section in sectionConfigs"
        :key="section.key"
        :title="section.title"
        :info-title="section.infoTitle"
        :info-items="section.infoItems"
        :info-columns="section.infoColumns"
      >
        <SettingsMouseSelectRow
          v-for="row in section.rows"
          :key="`${section.key}-${row.key}`"
          :label="row.label"
          :model-value="getSettingValue(section.key, row.key)"
          :items="row.options"
          :modified="isModified(section.key, row.key)"
          :default-label="defaultLabel"
          :is-default-value="(value) => isDefault(section.key, row.key, value)"
          @update:model-value="(value) => updateSetting(section.key, row.key, value)"
        />
      </SettingsMouseSection>
    </div>
  </div>
</template>
