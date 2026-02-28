<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
</script>

<template>
  <div class="flex flex-col gap-6">
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
          :label="t('videoEditor.settings.mouseTimelineWheelSecondaryShift', 'Secondary wheel + Shift')"
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
                (workspaceStore.userSettings.mouse.timeline.wheelSecondaryShift = v?.value ?? v)
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
</template>
