<script setup lang="ts">
/**
 * PropertyActionList.vue
 *
 * A unified component for rendering lists of action buttons in property panels.
 * Supports primary/secondary grouping and consistent styling with Nuxt UI.
 */
import { computed } from 'vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

export interface PropertyAction {
  id: string;
  label?: string;
  /** Accessibility title or tooltip */
  title?: string;
  icon?: string;
  color?: 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'danger';
  variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
  disabled?: boolean;
  loading?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

const props = withDefaults(
  defineProps<{
    actions: PropertyAction[];
    /** Whether to render actions as a vertical list of full-width buttons */
    vertical?: boolean;
    /** Size of the buttons */
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Justify content of the buttons */
    justify?: 'start' | 'center' | 'end';
    /** Default variant for buttons */
    variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
    /** Default color for buttons */
    color?:
      | 'neutral'
      | 'primary'
      | 'secondary'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
      | 'danger';
    /** Additional class for the container */
    class?: string;
  }>(),
  {
    vertical: true,
    size: 'sm',
    justify: 'start',
    variant: undefined,
    color: undefined,
    class: undefined,
  },
);

const { getHotkeyLabel, getHotkeyTitle } = useHotkeyLabel();

const ACTION_TO_HOTKEY: Record<string, HotkeyCommandId> = {
  // Common / Clip Actions
  'delete': 'general.delete',
  'rename': 'general.rename',
  'copy': 'general.copy',
  'cut': 'general.cut',
  'toggle-disabled': 'timeline.toggleDisableClip',
  'toggle-muted': 'timeline.toggleMuteClip',
  'toggle-locked': 'timeline.toggleLockClip',
  'copy-parameters': 'timeline.copyClipParameters',
  'paste-parameters': 'timeline.pasteClipParameters',
  'toggleAudioWaveformMode': 'timeline.toggleWaveformMode',
  'toggleShowWaveform': 'timeline.toggleShowWaveform',
  'toggleShowThumbnails': 'timeline.toggleShowThumbnails',
  'freezeFrame': 'timeline.toggleFreezeFrame',
  'resetFreezeFrame': 'timeline.toggleFreezeFrame',
  'createOtioVersion': 'timeline.duplicate',
  
  // Track Actions
  'toggle-video-hidden': 'timeline.toggleVisibilityTrack',
  'toggle-solo': 'timeline.toggleSoloTrack',
  
  // Marker Actions
  'addMarker': 'general.addMarker',
  'prevMarker': 'general.prevMarker',
  'nextMarker': 'general.nextMarker',
};

function getActionTitle(action: PropertyAction): string {
  const cmdId = ACTION_TO_HOTKEY[action.id];
  const baseTitle = action.title || action.label || '';
  if (!cmdId) return baseTitle;
  return getHotkeyTitle(baseTitle, cmdId);
}

function getActionLabel(action: PropertyAction): string | undefined {
  const baseLabel = action.label;
  if (!baseLabel) return undefined;
  const cmdId = ACTION_TO_HOTKEY[action.id];
  if (!cmdId) return baseLabel;
  const label = getHotkeyLabel(cmdId);
  if (!label) return baseLabel;
  return `${baseLabel} (${label})`;
}

const visibleActions = computed(() => props.actions.filter((action) => !action.hidden));

const justifyClass = computed(() => {
  switch (props.justify) {
    case 'center':
      return 'justify-center';
    case 'end':
      return 'justify-end';
    default:
      return 'justify-start';
  }
});
</script>

<template>
  <div
    class="w-full flex"
    :class="[vertical ? 'flex-col gap-2' : 'flex-wrap items-center gap-1', props.class]"
  >
    <UButton
      v-for="action in visibleActions"
      :key="action.id"
      :label="vertical ? getActionLabel(action) : action.label"
      :icon="action.icon"
      :color="
        (action.color === 'danger' ? 'error' : action.color) ||
        (props.color === 'danger' ? 'error' : props.color) ||
        'neutral'
      "
      :variant="action.variant || props.variant || 'soft'"
      :disabled="action.disabled"
      :loading="action.loading"
      :title="vertical ? (action.title || action.label) : getActionTitle(action)"
      :size="size"
      class="transition-all duration-200 hover:bg-ui-bg-hover hover:text-ui-text"
      :class="[vertical ? 'w-full' : '', !action.label && !vertical ? 'px-2' : '', justifyClass]"
      @click="action.onClick"
    >
      <template v-if="$slots[`action-${action.id}`]" #default>
        <slot :name="`action-${action.id}`" :action="action" />
      </template>
    </UButton>
  </div>
</template>
