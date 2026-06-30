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

const badge = computed(() => getDndBadge(operation.value));

const transform = computed(() => {
  const p = pointer.value;
  if (!p) return 'translate(-9999px, -9999px)';
  // Offset down-right of the pointer so the badge never sits under the cursor.
  return `translate(${p.clientX + 14}px, ${p.clientY + 12}px)`;
});

const previewLabel = computed(() => payload.value?.preview?.label ?? '');
const previewCount = computed(() => payload.value?.preview?.count ?? 0);

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
    <div v-if="active" class="fastcat-dnd-ghost" :style="{ transform }" aria-hidden="true">
      <span class="fastcat-dnd-badge" :class="badgeColorClass">{{ badge.glyph }}</span>
      <span v-if="previewLabel" class="fastcat-dnd-ghost__label">
        {{ previewLabel }}<template v-if="previewCount > 1"> +{{ previewCount - 1 }}</template>
      </span>
      <span v-else-if="badge.label" class="fastcat-dnd-ghost__label">{{ badge.label }}</span>
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
  will-change: transform;
}

.fastcat-dnd-ghost__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.fastcat-dnd-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: #111418;
  font-size: 11px;
  font-weight: 700;
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
