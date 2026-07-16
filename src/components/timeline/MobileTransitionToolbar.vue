<script setup lang="ts">
import { TICKS_PER_SECOND } from '~/utils/time';
import { computed, reactive } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectedTimelineClip } from '~/composables/timeline/useSelectedTimelineClip';
import { getAllTransitionManifests } from '~/transitions';
import type { TransitionCurve } from '~/transitions';
import { useClipTransitions } from '~/composables/properties/useClipTransitions';
import UiSelect from '~/components/ui/UiSelect.vue';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

/** Pixels of horizontal swipe required to add one second of transition. */
const PX_PER_SECOND = 100;
const MIN_DURATION_SEC = 0.1;

const { clip } = useSelectedTimelineClip();

const clipDurationTicks = computed(() =>
  Math.max(0, Math.round(Number(clip.value?.timelineRange?.durationTicks ?? 0))),
);

const defaultDurationTicks = computed(() =>
  Math.max(
    0,
    Math.round(
      Number(
        workspaceStore.userSettings.timeline.defaultTransitionDurationTicks ?? TICKS_PER_SECOND,
      ),
    ),
  ),
);

// No-op selectors: adding a transition from this panel must not steal the clip
// selection nor navigate away to the transition-edit drawer.
const {
  transitionIn,
  transitionOut,
  toggleTransition,
  updateTransitionDuration,
  updateTransitionType,
  updateTransitionCurve,
} = useClipTransitions({
  clip,
  defaultDurationTicks,
  selectTransition: () => {},
  selectTimelineTransition: () => {},
  updateClipTransition: timelineStore.updateClipTransition,
});

const transitionOptions = computed(() =>
  getAllTransitionManifests().map((manifest) => ({
    label: manifest.name,
    value: manifest.type,
    icon: manifest.icon,
  })),
);

const curveOptions = computed<{ label: string; value: TransitionCurve }[]>(() => [
  { label: t('fastcat.timeline.transition.curveLinear'), value: 'linear' },
  { label: t('fastcat.timeline.transition.curveSmooth'), value: 'smooth' },
  { label: t('fastcat.timeline.transition.curveEaseIn'), value: 'ease-in' },
  { label: t('fastcat.timeline.transition.curveEaseOut'), value: 'ease-out' },
]);

function maxDurationSec(edge: 'in' | 'out'): number {
  const other = edge === 'in' ? transitionOut.value : transitionIn.value;
  const otherDurationTicks = Math.max(0, Number(other?.durationTicks ?? 0));
  return Math.max(
    MIN_DURATION_SEC,
    (clipDurationTicks.value - otherDurationTicks) / TICKS_PER_SECOND,
  );
}

function selectValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'value' in value) {
    const nested = (value as Record<string, unknown>).value;
    return typeof nested === 'string' ? nested : undefined;
  }
  return undefined;
}

function updateTypeFromSelect(edge: 'in' | 'out', value: unknown) {
  const selected = selectValue(value);
  if (selected) updateTransitionType(edge, selected);
}

function updateCurveFromSelect(edge: 'in' | 'out', value: unknown) {
  const selected = selectValue(value);
  const curves: readonly TransitionCurve[] = ['linear', 'smooth', 'ease-in', 'ease-out'];
  if (selected && (curves as readonly string[]).includes(selected)) {
    updateTransitionCurve(edge, selected as TransitionCurve);
  }
}

// --- Swipe-to-adjust duration --------------------------------------------
const drag = reactive<{
  edge: 'in' | 'out' | null;
  startX: number;
  startSec: number;
  previewSec: number;
}>({ edge: null, startX: 0, startSec: 0, previewSec: 0 });

function durationSec(edge: 'in' | 'out'): number {
  if (drag.edge === edge) return drag.previewSec;
  const transition = edge === 'in' ? transitionIn.value : transitionOut.value;
  return Math.max(0, Number(transition?.durationTicks ?? 0) / TICKS_PER_SECOND);
}

function getTouchX(event: TouchEvent): number | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? touch.clientX : null;
}

function onDurationStart(edge: 'in' | 'out', event: TouchEvent) {
  const x = getTouchX(event);
  if (x == null) return;
  const transition = edge === 'in' ? transitionIn.value : transitionOut.value;
  if (!transition) return;

  event.preventDefault();
  drag.edge = edge;
  drag.startX = x;
  drag.startSec = Math.max(0, Number(transition.durationTicks ?? 0) / TICKS_PER_SECOND);
  drag.previewSec = drag.startSec;
}

function onDurationMove(event: TouchEvent) {
  if (!drag.edge) return;
  const x = getTouchX(event);
  if (x == null) return;

  event.preventDefault();
  const deltaSec = (x - drag.startX) / PX_PER_SECOND;
  const next = drag.startSec + deltaSec;
  drag.previewSec = Math.min(maxDurationSec(drag.edge), Math.max(MIN_DURATION_SEC, next));
}

function onDurationEnd() {
  if (!drag.edge) return;
  const edge = drag.edge;
  const finalSec = drag.previewSec;
  drag.edge = null;
  updateTransitionDuration(edge, finalSec);
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}
</script>

<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-60 bg-ui-bg/95 backdrop-blur border-t border-ui-border px-3 pt-3 pb-safe select-none shadow-2xl rounded-t-2xl outline outline-white/5"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-3 px-1">
      <UButton
        icon="i-heroicons-chevron-left"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('back')"
      />

      <span class="text-xs font-bold text-ui-text uppercase tracking-wider">
        {{ t('fastcat.timeline.transitions') }}
      </span>

      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="gray"
        size="sm"
        class="shrink-0 bg-white/5 active:bg-white/10"
        @click="emit('close')"
      />
    </div>

    <!-- Two columns: left (IN) / right (OUT) transition -->
    <div
      class="grid grid-cols-2 gap-px bg-ui-border/60 rounded-xl border border-ui-border/80 overflow-hidden shadow-inner mb-2"
    >
      <template v-for="edge in ['in', 'out'] as const" :key="edge">
        <div class="bg-ui-bg-elevated/60 p-2.5 flex flex-col gap-2 min-h-32">
          <div class="flex items-center justify-between">
            <span
              class="text-[9px] uppercase font-black tracking-wider leading-none"
              :class="
                (edge === 'in' ? transitionIn : transitionOut)
                  ? 'text-blue-400'
                  : 'text-ui-text-muted'
              "
            >
              {{ edge === 'in' ? 'IN' : 'OUT' }}
            </span>
            <UButton
              v-if="edge === 'in' ? transitionIn : transitionOut"
              size="2xs"
              color="red"
              variant="ghost"
              icon="i-heroicons-trash"
              @click="void (clip && toggleTransition(edge))"
            />
          </div>

          <!-- Empty: add button -->
          <button
            v-if="!(edge === 'in' ? transitionIn : transitionOut)"
            type="button"
            class="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ui-border/70 active:bg-blue-500/10 transition-colors text-ui-text-muted"
            @click="void (clip && toggleTransition(edge))"
          >
            <UIcon name="i-heroicons-plus" class="w-6 h-6" />
            <span class="text-[10px] font-semibold uppercase tracking-wide">
              {{
                edge === 'in'
                  ? t('fastcat.timeline.transition.addInLabel')
                  : t('fastcat.timeline.transition.addOutLabel')
              }}
            </span>
          </button>

          <!-- Present: type, curve, duration swipe -->
          <template v-else>
            <UiSelect
              :model-value="(edge === 'in' ? transitionIn : transitionOut)?.type"
              :items="transitionOptions"
              value-key="value"
              label-key="label"
              size="xs"
              full-width
              @update:model-value="(v: unknown) => updateTypeFromSelect(edge, v)"
            />

            <UiSelect
              :model-value="(edge === 'in' ? transitionIn : transitionOut)?.curve ?? 'linear'"
              :items="curveOptions"
              value-key="value"
              label-key="label"
              size="xs"
              full-width
              @update:model-value="(v: unknown) => updateCurveFromSelect(edge, v)"
            />

            <!-- Swipe to adjust duration -->
            <div
              class="mt-auto flex items-center justify-between gap-1.5 h-10 px-2 rounded-lg bg-ui-bg-muted border border-ui-border/60 touch-none active:bg-blue-500/10 transition-colors"
              :class="{ 'ring-1 ring-blue-400/60': drag.edge === edge }"
              @touchstart="onDurationStart(edge, $event)"
              @touchmove="onDurationMove"
              @touchend="onDurationEnd"
              @touchcancel="onDurationEnd"
            >
              <UIcon
                name="i-heroicons-chevron-left"
                class="w-3.5 h-3.5 text-ui-text-muted shrink-0"
              />
              <span class="text-xs font-mono font-bold text-ui-text tabular-nums">
                {{ formatSeconds(durationSec(edge)) }}
              </span>
              <UIcon
                name="i-heroicons-chevron-right"
                class="w-3.5 h-3.5 text-ui-text-muted shrink-0"
              />
            </div>
          </template>
        </div>
      </template>
    </div>

    <div v-if="clip" class="px-2 pb-1 flex justify-center">
      <span class="text-[8px] text-ui-text-muted uppercase font-bold tracking-[0.2em] truncate">
        {{ clip.name }}
      </span>
    </div>
  </div>
</template>
