<script setup lang="ts">
/**
 * Global visual layer for the pointer-DnD engine. Mounted once at the app root.
 *
 * Unlike the old `dragCursor.ts` DOM overlay (positioned from throttled HTML5
 * `dragover` events, so it visibly trailed the cursor and could get stuck), this
 * reads the reactive dnd state — updated on every `pointermove` the engine owns —
 * so the ghost tracks the pointer tightly and is torn down deterministically when
 * the drag ends (the engine always runs cleanup).
 */
import { computed, watch, onBeforeUnmount } from 'vue';
import { useDndState } from '~/composables/dnd/dndState';
import { getDndBadge } from '~/composables/dnd/dndPresentation';

const { active, pointer, operation, payload } = useDndState();
const { t } = useI18n();

const badge = computed(() => getDndBadge(operation.value, t));

const position = computed(() => {
  const p = pointer.value;
  if (!p) return { left: '-9999px', top: '-9999px' };
  // Offset down-right of the pointer so the badge never sits under the cursor.
  return { left: `${Math.round(p.clientX) + 14}px`, top: `${Math.round(p.clientY) + 12}px` };
});

const previewLabel = computed(() => payload.value?.preview?.label ?? '');
const previewCount = computed(() => payload.value?.preview?.count ?? 0);
const actionLabel = computed(() => badge.value.label);
const iconName = computed(() => {
  switch (operation.value) {
    case 'copy':
      return 'lucide:copy-plus';
    case 'move':
      return 'lucide:move-right';
    case 'cancel':
      return 'lucide:ban';
    case 'open-panel':
      return 'lucide:panel-right-open';
    case 'open-tab':
      return 'lucide:panel-top-open';
    case 'timeline-add':
      return 'lucide:plus';
    case 'effect':
      return 'lucide:sparkles';
    case 'transition':
      return 'lucide:between-horizontal-start';
    case 'none':
    default:
      return 'lucide:mouse-pointer-2';
  }
});

const badgeColorClass = computed(() => {
  switch (badge.value.color) {
    case 'green':
      return 'fastcat-dnd-badge--green';
    case 'red':
      return 'fastcat-dnd-badge--red';
    case 'blue':
      return 'fastcat-dnd-badge--blue';
    case 'amber':
    default:
      return 'fastcat-dnd-badge--amber';
  }
});

// Toggle a root cursor class while dragging. Cleanup is guaranteed because the
// engine always flips `active` to false on teardown — no stuck cursor.
const CURSOR_CLASS = 'fastcat-dnd-dragging';
const CANCEL_CLASS = 'fastcat-dnd-cancel';

function syncRootClasses() {
  const root = document.documentElement;
  root.classList.toggle(CURSOR_CLASS, active.value);
  root.classList.toggle(CANCEL_CLASS, active.value && operation.value === 'cancel');
}

watch([active, operation], syncRootClasses, { flush: 'post' });

onBeforeUnmount(() => {
  document.documentElement.classList.remove(CURSOR_CLASS, CANCEL_CLASS);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="fastcat-dnd-ghost" :style="position" aria-hidden="true">
      <span class="fastcat-dnd-badge" :class="badgeColorClass">
        <UIcon :name="iconName" class="fastcat-dnd-badge__icon" />
      </span>
      <span v-if="actionLabel" class="fastcat-dnd-ghost__action">{{ actionLabel }}</span>
      <span v-if="previewLabel" class="fastcat-dnd-ghost__label">
        {{ previewLabel }}<template v-if="previewCount > 1"> +{{ previewCount - 1 }}</template>
      </span>
      <span v-else-if="!actionLabel && badge.label" class="fastcat-dnd-ghost__label">
        {{ badge.label }}
      </span>
    </div>
  </Teleport>
</template>

<style scoped>
.fastcat-dnd-ghost {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483647;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 4px;
  border-radius: 999px;
  background: rgba(17, 20, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  max-width: 320px;
  will-change: left, top;
  transform: translateZ(0);
  -webkit-font-smoothing: antialiased;
}

.fastcat-dnd-ghost__label {
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.78);
}

.fastcat-dnd-ghost__action {
  color: #fff;
}

.fastcat-dnd-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: #111418;
}

.fastcat-dnd-badge__icon {
  width: 11px;
  height: 11px;
}

.fastcat-dnd-badge--green {
  background: #22c55e;
}
.fastcat-dnd-badge--amber {
  background: #f59e0b;
}
.fastcat-dnd-badge--red {
  background: #ef4444;
  color: #fff;
}
.fastcat-dnd-badge--blue {
  background: #3b82f6;
  color: #fff;
}
</style>

<style>
/* Global cursor while an internal pointer-drag is active. Scoped to <html> so it
   overrides element cursors during pointer capture. Removed on teardown. */
html.fastcat-dnd-dragging,
html.fastcat-dnd-dragging * {
  cursor: grabbing !important;
}
html.fastcat-dnd-dragging.fastcat-dnd-cancel,
html.fastcat-dnd-dragging.fastcat-dnd-cancel * {
  cursor: not-allowed !important;
}
</style>
