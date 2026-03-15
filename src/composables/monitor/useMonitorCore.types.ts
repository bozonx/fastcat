import type { Ref } from 'vue';
import type { useProjectStore } from '~/stores/project.store';
import type { FastCatProjectSettings } from '~/utils/project-settings';
import type { TimelineDocument } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';

export interface MonitorTimelineState {
  videoItems: Ref<unknown[]>;
  rawWorkerTimelineClips?: Ref<WorkerTimelineClip[]>;
  rawWorkerAudioClips?: Ref<WorkerTimelineClip[]>;
  workerTimelineClips: Ref<WorkerTimelineClip[]>;
  workerAudioClips: Ref<WorkerTimelineClip[]>;
  safeDurationUs: Ref<number>;
  clipSourceSignature: Ref<number>;
  clipLayoutSignature: Ref<number>;
  audioClipSourceSignature: Ref<number>;
  audioClipLayoutSignature: Ref<number>;
}

export interface MonitorDisplayState {
  containerEl: Ref<HTMLDivElement | null>;
  viewportEl: Ref<HTMLDivElement | null>;
  renderWidth: Ref<number>;
  renderHeight: Ref<number>;
  updateCanvasDisplaySize: () => void;
}

export interface TimelineStoreState {
  duration: number;
  currentTime: number;
  setCurrentTimeUs: (timeUs: number) => void;
  isPlaying: boolean;
  masterGain: number;
  audioMuted: boolean;
  timelineDoc: TimelineDocument | null;
}

export interface MonitorStoreState {
  projectStore: ReturnType<typeof useProjectStore>;
  timelineStore: TimelineStoreState;
  proxyStore: {
    getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
    getProxyFile: (path: string) => Promise<File | null>;
    existingProxies: Ref<Set<string>>;
  };
}

export interface UseMonitorCoreOptions extends MonitorStoreState {
  monitorTimeline: MonitorTimelineState;
  monitorDisplay: MonitorDisplayState;
}
