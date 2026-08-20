import { ref } from 'vue';

// Module-level singleton: shared hover state for the timeline ruler
const _hoveredMarkerId = ref<string | null>(null);

export function useTimelineHoverState() {
  return {
    hoveredMarkerId: _hoveredMarkerId,
  };
}
