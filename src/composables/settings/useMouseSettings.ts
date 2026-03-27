import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import {
  CLIP_DRAG_ACTIONS,
  DRAG_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MOUSE_HORIZONTAL_MOVEMENT_ACTIONS,
  RULER_WHEEL_ACTIONS,
  SHIFT_CLICK_ACTIONS,
  TIMELINE_CLICK_ACTIONS,
  TIMELINE_WHEEL_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
} from '~/utils/mouse';
import { LAYER_OPTIONS, type LayerKey } from '~/utils/hotkeys/layerUtils';

export type MouseSettings = typeof DEFAULT_USER_SETTINGS.mouse;
export type MouseCategory = keyof MouseSettings;

export interface SelectOption {
  label: string;
  value: string;
}

export interface MouseRowConfig {
  key: string;
  label: string;
  options: SelectOption[];
}

export interface MouseSectionConfig {
  key: MouseCategory;
  title: string;
  rows: MouseRowConfig[];
  infoItems: string[];
  infoTitle?: string;
  infoColumns?: boolean;
}

export function useMouseSettings() {
  const { t } = useI18n();
  const workspaceStore = useWorkspaceStore();

  const modifier1Name = computed(() => {
    const val = workspaceStore.userSettings.hotkeys.layer1 ?? 'Shift';
    return LAYER_OPTIONS.find((opt) => opt.value === val)?.label || val;
  });

  const modifier2Name = computed(() => {
    const val = workspaceStore.userSettings.hotkeys.layer2 ?? 'Control';
    return LAYER_OPTIONS.find((opt) => opt.value === val)?.label || val;
  });

  function updateLayer1(val: LayerKey) {
    if (!val) return;
    void workspaceStore.batchUpdateUserSettings((draft) => {
      draft.hotkeys.layer1 = val;
    });
  }

  function updateLayer2(val: LayerKey) {
    if (!val) return;
    void workspaceStore.batchUpdateUserSettings((draft) => {
      draft.hotkeys.layer2 = val;
    });
  }

  const defaultLabel = computed(() => t('common.default'));

  const commonWheelLabels = computed<Record<string, string>>(() => ({
    scroll_vertical: t('videoEditor.settings.mouseActionScrollVertical'),
    scroll_horizontal: t('videoEditor.settings.mouseActionScrollHorizontal'),
    zoom_horizontal: t('videoEditor.settings.mouseActionZoomHorizontal'),
    zoom_vertical: t('videoEditor.settings.mouseActionZoomVertical'),
    seek_frame: t('videoEditor.settings.mouseActionSeekFrame'),
    seek_second: t('videoEditor.settings.mouseActionSeekSecond'),
    none: t('videoEditor.settings.mouseActionNone'),
    resize_track: t('videoEditor.settings.mouseActionResizeTrack'),
    zoom: t('videoEditor.settings.mouseActionZoom'),
  }));

  const commonClickLabels = computed<Record<string, string>>(() => ({
    seek: t('videoEditor.settings.mouseActionSeek'),
    add_marker: t('videoEditor.settings.mouseActionAddMarker'),
    reset_zoom: t('videoEditor.settings.mouseActionResetZoom'),
    fit_zoom: t('videoEditor.settings.mouseActionFitZoom'),
    clear_selection: t('videoEditor.settings.mouseActionClearSelection'),
    select_item: t('videoEditor.settings.mouseActionSelectItem'),
    select_multiple: t('videoEditor.settings.mouseActionSelectMultiple'),
    select_area: t('videoEditor.settings.mouseActionSelectArea'),
    none: t('videoEditor.settings.mouseActionNone'),
  }));

  const commonDragLabels = computed<Record<string, string>>(() => ({
    pan: t('videoEditor.settings.mouseActionPan'),
    move_playhead: t('videoEditor.settings.mouseActionMovePlayhead'),
    select_area: t('videoEditor.settings.mouseActionSelectArea'),
    none: t('videoEditor.settings.mouseActionNone'),
  }));

  const commonHorizontalMovementLabels = computed<Record<string, string>>(() => ({
    move_playhead: t('videoEditor.settings.mouseActionMovePlayhead'),
    none: t('videoEditor.settings.mouseActionNone'),
  }));

  const clipDragLabels = computed<Record<string, string>>(() => ({
    toggle_clip_move_mode: t('videoEditor.settings.mouseActionToggleClipMoveMode'),
    pseudo_overlap: t('videoEditor.settings.mouseActionPseudoOverlap'),
    free_mode: t('videoEditor.settings.mouseActionFreeMode'),
    copy: t('videoEditor.settings.mouseActionCopy'),
    toggle_snap: t('videoEditor.settings.mouseActionToggleSnap'),
    none: t('videoEditor.settings.mouseActionNone'),
  }));

  function formatOptions(
    actions: readonly string[],
    labels: Record<string, string>,
  ): SelectOption[] {
    return actions.map((action) => ({
      label: labels[action] || action,
      value: action,
    }));
  }

  const rulerWheelOptions = computed(() =>
    formatOptions(RULER_WHEEL_ACTIONS, commonWheelLabels.value),
  );
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
  const timelineClickActionOptions = computed(() =>
    formatOptions(TIMELINE_CLICK_ACTIONS, commonClickLabels.value),
  );
  const dragOptions = computed(() => formatOptions(DRAG_ACTIONS, commonDragLabels.value));
  const mouseHorizontalMovementOptions = computed(() =>
    formatOptions(MOUSE_HORIZONTAL_MOVEMENT_ACTIONS, commonHorizontalMovementLabels.value),
  );
  const clipDragOptions = computed(() => formatOptions(CLIP_DRAG_ACTIONS, clipDragLabels.value));
  const monitorMiddleClickOptions = computed(() =>
    formatOptions(MONITOR_CLICK_ACTIONS, {
      fit: t('videoEditor.settings.mouseActionFit'),
      reset_zoom: t('videoEditor.settings.mouseActionResetZoom'),
      reset_zoom_center: t('videoEditor.settings.mouseActionResetZoomCenter'),
      center: t('videoEditor.settings.mouseActionCenter'),
      none: t('videoEditor.settings.mouseActionNone'),
    }),
  );
  const monitorMiddleDragOptions = computed(() =>
    formatOptions(MONITOR_DRAG_ACTIONS, {
      pan: t('videoEditor.settings.mouseActionPan'),
      none: t('videoEditor.settings.mouseActionNone'),
    }),
  );
  const trackHeadersClickOptions = computed(() =>
    formatOptions(TRACK_HEADERS_CLICK_ACTIONS, {
      select_track: t('videoEditor.settings.mouseActionSelectTrack'),
      select_all_clips: t('videoEditor.settings.mouseActionSelectAllClips'),
      none: t('videoEditor.settings.mouseActionNone'),
    }),
  );

  const sectionConfigs = computed(
    () =>
      [
        {
          key: 'ruler',
          title: t('videoEditor.settings.mouseRuler'),
          rows: [
            {
              key: 'wheel',
              label: t('videoEditor.settings.mouseTimelineWheel'),
              options: rulerWheelOptions.value,
            },
            {
              key: 'wheelShift',
              label: t('videoEditor.settings.mouseTimelineWheelShift', {
                modifier1: modifier1Name.value,
              }),
              options: rulerWheelOptions.value,
            },
            {
              key: 'wheelSecondary',
              label: t('videoEditor.settings.mouseTimelineWheelSecondary'),
              options: rulerWheelOptions.value,
            },
            {
              key: 'wheelSecondaryShift',
              label: t('videoEditor.settings.mouseTimelineWheelSecondaryShift', {
                modifier1: modifier1Name.value,
              }),
              options: rulerWheelOptions.value,
            },
            {
              key: 'drag',
              label: t('videoEditor.settings.mouseTimelineDrag'),
              options: dragOptions.value,
            },
            {
              key: 'dragShift',
              label: t('videoEditor.settings.mouseRulerDragShift', {
                modifier1: modifier1Name.value,
              }),
              options: dragOptions.value,
            },
            {
              key: 'middleDrag',
              label: t('videoEditor.settings.mouseTimelineMiddleDrag'),
              options: dragOptions.value,
            },
            {
              key: 'click',
              label: t('videoEditor.settings.mouseRulerClick'),
              options: clickActionOptions.value,
            },
            {
              key: 'shiftClick',
              label: t('videoEditor.settings.mouseTimelineShiftClick', {
                modifier1: modifier1Name.value,
              }),
              options: shiftClickActionOptions.value,
            },
            {
              key: 'middleClick',
              label: t('videoEditor.settings.mouseTimelineMiddleClick'),
              options: clickActionOptions.value,
            },
            {
              key: 'doubleClick',
              label: t('videoEditor.settings.mouseRulerDoubleClick'),
              options: clickActionOptions.value,
            },
            {
              key: 'horizontalMovement',
              label: t('videoEditor.settings.mouseHorizontalMovement'),
              options: mouseHorizontalMovementOptions.value,
            },
          ],
          infoItems: [t('videoEditor.settings.mouseHardcodedLeftClick')],
        },
        {
          key: 'timeline',
          title: t('videoEditor.settings.mouseTimeline'),
          rows: [
            {
              key: 'wheel',
              label: t('videoEditor.settings.mouseTimelineWheel'),
              options: timelineWheelOptions.value,
            },
            {
              key: 'wheelShift',
              label: t('videoEditor.settings.mouseTimelineWheelShift', {
                modifier1: modifier1Name.value,
              }),
              options: timelineWheelOptions.value,
            },
            {
              key: 'wheelSecondary',
              label: t('videoEditor.settings.mouseTimelineWheelSecondary'),
              options: timelineWheelOptions.value,
            },
            {
              key: 'wheelSecondaryShift',
              label: t('videoEditor.settings.mouseTimelineWheelSecondaryShift', {
                modifier1: modifier1Name.value,
              }),
              options: timelineWheelOptions.value,
            },
            {
              key: 'middleDrag',
              label: t('videoEditor.settings.mouseTimelineMiddleDrag'),
              options: dragOptions.value,
            },
            {
              key: 'clipDragShift',
              label: t('videoEditor.settings.mouseTimelineClipDragShift', {
                modifier1: modifier1Name.value,
              }),
              options: clipDragOptions.value,
            },
            {
              key: 'clipDragCtrl',
              label: t('videoEditor.settings.mouseTimelineClipDragCtrl', {
                modifier2: modifier2Name.value,
              }),
              options: clipDragOptions.value,
            },
            {
              key: 'clipDragRight',
              label: t('videoEditor.settings.mouseTimelineClipDragRight'),
              options: clipDragOptions.value,
            },
            {
              key: 'click',
              label: t('videoEditor.settings.mouseTimelineClick'),
              options: timelineClickActionOptions.value,
            },
            {
              key: 'shiftClick',
              label: t('videoEditor.settings.mouseTimelineShiftClick', {
                modifier1: modifier1Name.value,
              }),
              options: timelineClickActionOptions.value,
            },
            {
              key: 'middleClick',
              label: t('videoEditor.settings.mouseTimelineMiddleClick'),
              options: timelineClickActionOptions.value,
            },
            {
              key: 'horizontalMovement',
              label: t('videoEditor.settings.mouseHorizontalMovement'),
              options: mouseHorizontalMovementOptions.value,
            },
          ],
          infoTitle: t('videoEditor.settings.mouseHardcodedTitle'),
          infoColumns: true,
          infoItems: [
            t('videoEditor.settings.mouseHardcodedLeftDrag'),
            t('videoEditor.settings.mouseHardcodedLeftClick'),
            t('videoEditor.settings.mouseHardcodedShiftClick', { modifier1: modifier1Name.value }),
            t('videoEditor.settings.mouseHardcodedRazorClick'),
            t('videoEditor.settings.mouseHardcodedRazorShiftClick', {
              modifier1: modifier1Name.value,
            }),
            t('videoEditor.settings.mouseHardcodedRazorCtrlClick', {
              modifier2: modifier2Name.value,
            }),
          ],
        },
        {
          key: 'trackHeaders',
          title: t('videoEditor.settings.mouseTrackHeaders'),
          rows: [
            {
              key: 'wheel',
              label: t('videoEditor.settings.mouseTimelineWheel'),
              options: trackHeadersWheelOptions.value,
            },
            {
              key: 'wheelShift',
              label: t('videoEditor.settings.mouseTimelineWheelShift', {
                modifier1: modifier1Name.value,
              }),
              options: trackHeadersWheelOptions.value,
            },
            {
              key: 'wheelSecondary',
              label: t('videoEditor.settings.mouseTimelineWheelSecondary'),
              options: trackHeadersWheelOptions.value,
            },
            {
              key: 'wheelSecondaryShift',
              label: t('videoEditor.settings.mouseTimelineWheelSecondaryShift', {
                modifier1: modifier1Name.value,
              }),
              options: trackHeadersWheelOptions.value,
            },
            {
              key: 'click',
              label: t('videoEditor.settings.mouseTrackHeadersClick'),
              options: trackHeadersClickOptions.value,
            },
            {
              key: 'middleClick',
              label: t('videoEditor.settings.mouseTrackHeadersMiddleClick'),
              options: trackHeadersClickOptions.value,
            },
            {
              key: 'doubleClick',
              label: t('videoEditor.settings.mouseTrackHeadersDoubleClick'),
              options: trackHeadersClickOptions.value,
            },
          ],
          infoItems: [t('videoEditor.settings.mouseHardcodedDblClickTrackHeader')],
        },
        {
          key: 'monitor',
          title: t('videoEditor.settings.mouseMonitor'),
          rows: [
            {
              key: 'wheel',
              label: t('videoEditor.settings.mouseMonitorWheel'),
              options: monitorWheelOptions.value,
            },
            {
              key: 'wheelShift',
              label: t('videoEditor.settings.mouseMonitorWheelShift', {
                modifier1: modifier1Name.value,
              }),
              options: monitorWheelOptions.value,
            },
            {
              key: 'wheelSecondary',
              label: t('videoEditor.settings.mouseTimelineWheelSecondary'),
              options: monitorWheelOptions.value,
            },
            {
              key: 'wheelSecondaryShift',
              label: t('videoEditor.settings.mouseTimelineWheelSecondaryShift', {
                modifier1: modifier1Name.value,
              }),
              options: monitorWheelOptions.value,
            },
            {
              key: 'middleDrag',
              label: t('videoEditor.settings.mouseTimelineMiddleDrag'),
              options: monitorMiddleDragOptions.value,
            },
            {
              key: 'middleClick',
              label: t('videoEditor.settings.mouseMonitorMiddleClick'),
              options: monitorMiddleClickOptions.value,
            },
            {
              key: 'doubleClick',
              label: t('videoEditor.settings.mouseMonitorDoubleClick'),
              options: monitorMiddleClickOptions.value,
            },
          ],
          infoItems: [t('videoEditor.settings.mouseHardcodedDblClickMonitor')],
        },
      ] satisfies MouseSectionConfig[],
  );

  function resetDefaults() {
    workspaceStore.userSettings.mouse.ruler = { ...DEFAULT_USER_SETTINGS.mouse.ruler };
    workspaceStore.userSettings.mouse.timeline = { ...DEFAULT_USER_SETTINGS.mouse.timeline };
    workspaceStore.userSettings.mouse.trackHeaders = {
      ...DEFAULT_USER_SETTINGS.mouse.trackHeaders,
    };
    workspaceStore.userSettings.mouse.monitor = { ...DEFAULT_USER_SETTINGS.mouse.monitor };
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

  return {
    modifier1Name,
    modifier2Name,
    updateLayer1,
    updateLayer2,
    defaultLabel,
    sectionConfigs,
    resetDefaults,
    getSettingValue,
    updateSetting,
    isDefault,
    isModified,
  };
}
