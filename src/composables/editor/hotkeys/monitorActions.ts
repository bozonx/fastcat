import { ref } from 'vue';

const _createStopFrameSnapshot = ref<(() => Promise<void>) | null>(null);
const _createNewTimeline = ref<(() => Promise<void>) | null>(null);
const _centerMonitor = ref<(() => void) | null>(null);

export function registerMonitorActions(input: {
  createStopFrameSnapshot: () => Promise<void>;
  createNewTimeline: () => Promise<void>;
  centerMonitor?: () => void;
}) {
  _createStopFrameSnapshot.value = input.createStopFrameSnapshot;
  _createNewTimeline.value = input.createNewTimeline;
  _centerMonitor.value = input.centerMonitor ?? null;
}

export function useMonitorActions() {
  return {
    createStopFrameSnapshot: _createStopFrameSnapshot,
    createNewTimeline: _createNewTimeline,
    centerMonitor: _centerMonitor,
  };
}
