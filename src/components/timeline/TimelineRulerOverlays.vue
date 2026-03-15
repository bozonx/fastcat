<script setup lang="ts">
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
  (e: 'select-marker', markerId: string, event?: MouseEvent): void;
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
    <UContextMenu v-if="selectionRangePoint" :items="selectionRangeMenuItems">
      <div
        class="absolute inset-y-0 pointer-events-auto z-30"
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
        <button
          type="button"
          class="absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-ew-resize bg-selection-range/70"
          :aria-label="selectionStartHandleLabel"
          @pointerdown.stop="emit('selection-range-pointerdown', $event, 'left')"
        />
        <button
          type="button"
          class="absolute inset-y-0 right-0 w-2 translate-x-1/2 cursor-ew-resize bg-selection-range/70"
          :aria-label="selectionEndHandleLabel"
          @pointerdown.stop="emit('selection-range-pointerdown', $event, 'right')"
        />
      </div>
    </UContextMenu>

    <div
      v-for="point in markerPoints"
      :key="point.id"
      class="absolute bottom-0 h-full pointer-events-auto"
      :style="{ left: `${point.x}px`, width: point.isZone ? `${point.width}px` : 'auto' }"
    >
      <div
        v-if="point.isZone"
        class="absolute inset-y-0 left-0 w-full bg-primary-500/20 border-l border-r border-primary-500/50 pointer-events-none"
        :style="
          point.color
            ? { backgroundColor: `${point.color}33`, borderColor: `${point.color}80` }
            : {}
        "
      />

      <div class="absolute bottom-0 left-0">
        <UContextMenu
          :items="point.isZone ? getZoneMarkerMenuItems(point.id) : getMarkerMenuItems(point.id)"
        >
          <UTooltip :text="truncateTooltip(point.text)" :disabled="!point.text">
            <button
              type="button"
              class="-translate-x-1 relative z-10"
              :class="getMarkerButtonClass(point)"
              :style="point.color ? { color: point.color } : {}"
              :aria-label="point.isZone ? zoneMarkerStartLabel : markerLabel"
              @dblclick.stop.prevent="emit('select-marker', point.id)"
              @pointerdown.stop="emit('marker-pointerdown', $event, point.id)"
              @contextmenu.stop
              @click="emit('select-marker', point.id, $event)"
            >
              <svg
                width="10"
                height="14"
                viewBox="0 0 10 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0H10V9L5 14L0 9V0Z" :fill="point.color ?? '#3b82f6'" />
              </svg>
            </button>
          </UTooltip>
        </UContextMenu>
      </div>

      <div v-if="point.isZone" class="absolute bottom-0 right-0">
        <UContextMenu :items="getZoneMarkerMenuItems(point.id)">
          <UTooltip :text="truncateTooltip(point.text)" :disabled="!point.text">
            <button
              type="button"
              class="translate-x-1 relative z-10"
              :class="getMarkerButtonClass(point)"
              :style="point.color ? { color: point.color } : {}"
              :aria-label="zoneMarkerEndLabel"
              @dblclick.stop.prevent="emit('select-marker', point.id)"
              @pointerdown.stop="emit('marker-pointerdown', $event, point.id, 'right')"
              @contextmenu.stop
              @click="emit('select-marker', point.id, $event)"
            >
              <svg
                width="10"
                height="14"
                viewBox="0 0 10 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0H10V9L5 14L0 9V0Z" :fill="point.color ?? '#3b82f6'" />
              </svg>
            </button>
          </UTooltip>
        </UContextMenu>
      </div>
    </div>
  </div>
</template>
