<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
interface MarkerPoint {
  id: string;
  x: number;
  width: number;
  isZone: boolean;
  text: string;
  color: string;
}

interface SelectionRangePoint {
  x: number;
  width: number;
}

interface MenuItem {
  label?: string;
  icon?: string;
  color?: 'red';
  onSelect?: () => void;
}

type MenuGroup = MenuItem[];

const props = defineProps<{
  markerPoints: MarkerPoint[];
  selectionRangePoint: SelectionRangePoint | null;
  selectionRangeMenuItems: MenuGroup[];
  getZoneMarkerMenuItems: (markerId: string) => MenuGroup[];
  getMarkerMenuItems: (markerId: string) => MenuGroup[];
  isMarkerSelected: (markerId: string) => boolean;
  isSelectionRangeSelected: boolean;
  truncateTooltip: (text: string) => string;
  selectionStartHandleLabel: string;
  selectionEndHandleLabel: string;
  markerLabel: string;
  zoneMarkerStartLabel: string;
  zoneMarkerEndLabel: string;
}>();

const emit = defineEmits<{
  (e: 'select-marker', markerId: string, event?: MouseEvent, part?: 'left' | 'right'): void;
  (e: 'marker-pointerdown', event: PointerEvent, markerId: string, part?: 'left' | 'right'): void;
  (e: 'select-selection-range', event?: MouseEvent): void;
  (e: 'selection-range-pointerdown', event: PointerEvent, part: 'move' | 'left' | 'right'): void;
}>();

function getMarkerButtonClass(marker: MarkerPoint) {
  if (props.isMarkerSelected(marker.id)) {
    return marker.color ? 'ring-2 ring-white/50' : 'bg-primary-400 ring-2 ring-primary-400/50';
  }

  return marker.color ? '' : 'bg-primary-500';
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none">
    <!-- 1. Marker Zones (lowest z-index) -->
    <div
      v-for="point in markerPoints.filter((p) => p.isZone)"
      :key="`zone-bg-${point.id}`"
      class="absolute bottom-0 h-full pointer-events-auto z-10"
      :style="{ left: `${point.x}px`, width: `${point.width}px` }"
    >
      <div
        class="absolute inset-y-0 left-0 w-full bg-primary-500/20 border-l border-r border-primary-500/50 pointer-events-none"
        :style="
          point.color
            ? { backgroundColor: `${point.color}33`, borderColor: `${point.color}80` }
            : {}
        "
      />
    </div>

    <!-- 2. Selection Area (middle z-index) -->
    <UContextMenu v-if="selectionRangePoint" :items="selectionRangeMenuItems">
      <div
        class="absolute inset-y-0 pointer-events-auto z-20"
        :style="{
          left: `${selectionRangePoint.x}px`,
          width: `${selectionRangePoint.width}px`,
        }"
        @contextmenu.stop
      >
        <button
          type="button"
          class="absolute inset-y-0 left-0 right-0 border-l border-r bg-selection-range-bg border-selection-range-border shadow-[0_0_0_1px_rgba(var(--color-selection-range),0.25)]"
          :class="isSelectionRangeSelected ? 'ring-2 ring-selection-range/80' : ''"
          @click="emit('select-selection-range', $event)"
          @pointerdown.stop="emit('selection-range-pointerdown', $event, 'move')"
        />
      </div>
    </UContextMenu>

    <!-- 3. Markers (higher z-index) -->
    <div
      v-for="point in markerPoints"
      :key="`marker-${point.id}`"
      class="absolute bottom-0 h-full pointer-events-auto z-30"
      :style="{
        left: `${point.x}px`,
        width: point.isZone ? `${point.width}px` : 'auto',
        pointerEvents: 'none',
      }"
    >
      <!-- 1px hairline from marker center going down through ruler -->
      <div
        class="absolute inset-y-0 left-0 w-px pointer-events-none opacity-50"
        :style="{ backgroundColor: point.color ?? '#eab308' }"
      />

      <div class="absolute bottom-0 left-0 pointer-events-auto">
        <UContextMenu
          :items="point.isZone ? getZoneMarkerMenuItems(point.id) : getMarkerMenuItems(point.id)"
        >
          <UiTooltip :text="truncateTooltip(point.text)" :disabled="!point.text">
            <button
              type="button"
              class="-translate-x-1/2 relative z-30"
              :class="getMarkerButtonClass(point)"
              :style="point.color ? { color: point.color } : {}"
              :aria-label="point.isZone ? zoneMarkerStartLabel : markerLabel"
              @dblclick.stop.prevent="emit('select-marker', point.id, undefined, 'left')"
              @pointerdown.stop="emit('marker-pointerdown', $event, point.id)"
              @contextmenu.stop
              @click="emit('select-marker', point.id, $event, 'left')"
            >
              <!-- 11px wide (odd) for precise centering; shorter + more open angle -->
              <svg
                width="11"
                height="10"
                viewBox="0 0 11 10"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0H11V6L5.5 10L0 6V0Z" :fill="point.color ?? '#3b82f6'" />
              </svg>
            </button>
          </UiTooltip>
        </UContextMenu>
      </div>

      <div v-if="point.isZone" class="absolute bottom-0 right-0 pointer-events-auto">
        <UContextMenu :items="getZoneMarkerMenuItems(point.id)">
          <UiTooltip :text="truncateTooltip(point.text)" :disabled="!point.text">
            <button
              type="button"
              class="translate-x-1/2 relative z-30"
              :class="getMarkerButtonClass(point)"
              :style="point.color ? { color: point.color } : {}"
              :aria-label="zoneMarkerEndLabel"
              @dblclick.stop.prevent="emit('select-marker', point.id, undefined, 'right')"
              @pointerdown.stop="emit('marker-pointerdown', $event, point.id, 'right')"
              @contextmenu.stop
              @click="emit('select-marker', point.id, $event, 'right')"
            >
              <svg
                width="11"
                height="10"
                viewBox="0 0 11 10"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0H11V6L5.5 10L0 6V0Z" :fill="point.color ?? '#3b82f6'" />
              </svg>
            </button>
          </UiTooltip>
        </UContextMenu>
      </div>
    </div>

    <!-- 4. Selection Area Handles (highest z-index) -->
    <div
      v-if="selectionRangePoint"
      class="absolute inset-y-0 pointer-events-none z-40"
      :style="{
        left: `${selectionRangePoint.x}px`,
        width: `${selectionRangePoint.width}px`,
      }"
    >
      <button
        type="button"
        class="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-selection-range/70 pointer-events-auto"
        :aria-label="selectionStartHandleLabel"
        @pointerdown.stop="emit('selection-range-pointerdown', $event, 'left')"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-selection-range/70 pointer-events-auto"
        :aria-label="selectionEndHandleLabel"
        @pointerdown.stop="emit('selection-range-pointerdown', $event, 'right')"
      />
    </div>
  </div>
</template>
