<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import { TIMELINE_WHEEL_ACTIONS, MONITOR_WHEEL_ACTIONS, MIDDLE_CLICK_ACTIONS } from '~/utils/mouse';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const timelineWheelOptions = computed(() => {
  const labels: Record<string, string> = {
    scroll_vertical: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
    scroll_horizontal: t('videoEditor.settings.mouseActionScrollHorizontal', 'Horizontal scroll'),
    zoom_horizontal: t('videoEditor.settings.mouseActionZoomHorizontal', 'Horizontal zoom'),
    zoom_vertical: t('videoEditor.settings.mouseActionZoomVertical', 'Vertical zoom'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  };
  return TIMELINE_WHEEL_ACTIONS.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
});

const monitorWheelOptions = computed(() => {
  const labels: Record<string, string> = {
    zoom: t('videoEditor.settings.mouseActionZoom', 'Zoom'),
    scroll_vertical: t('videoEditor.settings.mouseActionScrollVertical', 'Vertical scroll'),
    scroll_horizontal: t('videoEditor.settings.mouseActionScrollHorizontal', 'Horizontal scroll'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  };
  return MONITOR_WHEEL_ACTIONS.map((action) => ({
    label: labels[action] || action,
    value: action,
  }));
});

const middleClickOptions = computed(() => {
  const labels: Record<string, string> = {
    pan: t('videoEditor.settings.mouseActionPan', 'Pan'),
    none: t('videoEditor.settings.mouseActionNone', 'None'),
  };
  return MIDDLE_CLICK_ACTIONS.map((action) => ({ label: labels[action] || action, value: action }));
});

function resetDefaults() {
  workspaceStore.userSettings.mouse.timeline = { ...DEFAULT_USER_SETTINGS.mouse.timeline };
  workspaceStore.userSettings.mouse.monitor = { ...DEFAULT_USER_SETTINGS.mouse.monitor };
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3 px-1">
      <div class="text-sm font-semibold text-ui-text">
        {{ t('videoEditor.settings.userMouse', 'Mouse') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-3">
        <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.settings.mouseTimeline', 'Timeline') }}
        </div>

        <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
          <table class="w-full border-collapse">
            <tbody class="divide-y divide-ui-border">
              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseTimelineMiddleClick', 'Middle click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.timeline.middleClick"
                    :items="middleClickOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.timeline.middleClick = v?.value ?? v)
                    "
                  />
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
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseMonitorWheelShift', 'Wheel + Shift') }}
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
                  />
                </td>
              </tr>

              <tr class="group hover:bg-ui-bg-accent/10 transition-colors">
                <td class="w-[40%] p-3 py-2.5 align-middle border-r border-ui-border/50">
                  <span class="text-sm text-ui-text font-medium leading-tight">
                    {{ t('videoEditor.settings.mouseMonitorMiddleClick', 'Middle click') }}
                  </span>
                </td>
                <td class="p-2 py-2.5 align-middle">
                  <USelectMenu
                    v-model="workspaceStore.userSettings.mouse.monitor.middleClick"
                    :items="middleClickOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                    @update:model-value="
                      (v: any) =>
                        (workspaceStore.userSettings.mouse.monitor.middleClick = v?.value ?? v)
                    "
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="text-[10px] text-ui-text-muted italic px-1">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
