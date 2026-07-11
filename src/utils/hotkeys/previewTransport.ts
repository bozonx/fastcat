import type { HotkeyCommandId } from './defaultHotkeys';

export type PreviewRoute =
  | {
      kind: 'action';
      action:
        | 'toggle'
        | 'toggle1'
        | 'toStart'
        | 'toEnd'
        | 'speedUpForward'
        | 'speedDownForward'
        | 'pauseReset';
    }
  | { kind: 'step'; frames: number }
  | { kind: 'setSpeed'; speed: number }
  | { kind: 'volume'; delta: number }
  | { kind: 'mute' };

export const PREVIEW_TRANSPORT_ROUTES: Partial<Record<HotkeyCommandId, PreviewRoute | 'block'>> = {
  'playback.toggle': { kind: 'action', action: 'toggle' },
  'playback.toggle1': { kind: 'action', action: 'toggle1' },
  'playback.play1ResetSpeed': { kind: 'setSpeed', speed: 1 },
  'timeline.globalToStart': { kind: 'action', action: 'toStart' },
  'timeline.globalToEnd': { kind: 'action', action: 'toEnd' },

  'general.mute': { kind: 'mute' },
  'general.volumeUp': { kind: 'volume', delta: 0.05 },
  'general.volumeDown': { kind: 'volume', delta: -0.05 },

  'general.addMarker': 'block',
  'general.prevMarker': 'block',
  'general.nextMarker': 'block',
  'timeline.setSelectionIn': 'block',
  'timeline.setSelectionOut': 'block',
  'playback.jumpPrevBoundary': 'block',
  'playback.jumpNextBoundary': 'block',
  'playback.jumpPrevBoundaryTrack': 'block',
  'playback.jumpNextBoundaryTrack': 'block',
  'general.snapshot': 'block',
  'monitor.center': 'block',

  'playback.stepForward': { kind: 'step', frames: 1 },
  'playback.stepBackward': { kind: 'step', frames: -1 },
  'playback.stepForwardLarge': { kind: 'step', frames: 30 },
  'playback.stepBackwardLarge': { kind: 'step', frames: -30 },
  'playback.speedUpForward': { kind: 'action', action: 'speedUpForward' },
  'playback.speedDown': { kind: 'action', action: 'speedDownForward' },

  'playback.shuttleReverse': 'block',
  'playback.shuttleStop': { kind: 'action', action: 'pauseReset' },
  'playback.shuttleForward': { kind: 'action', action: 'speedUpForward' },

  'playback.forward0_5': { kind: 'setSpeed', speed: 0.5 },
  'playback.backward0_5': 'block',
  'playback.forward0_75': { kind: 'setSpeed', speed: 0.75 },
  'playback.backward0_75': 'block',
  'playback.forward1_25': { kind: 'setSpeed', speed: 1.25 },
  'playback.backward1_25': 'block',
  'playback.forward1_5': { kind: 'setSpeed', speed: 1.5 },
  'playback.backward1_5': 'block',
  'playback.forward1_75': { kind: 'setSpeed', speed: 1.75 },
  'playback.backward1_75': 'block',
  'playback.forward2': { kind: 'setSpeed', speed: 2 },
  'playback.backward2': 'block',
  'playback.forward3': { kind: 'setSpeed', speed: 3 },
  'playback.backward3': 'block',
  'playback.forward5': { kind: 'setSpeed', speed: 5 },
  'playback.backward5': 'block',
};

export function resolvePreviewTransport(cmdId: HotkeyCommandId): PreviewRoute | 'block' | null {
  return PREVIEW_TRANSPORT_ROUTES[cmdId] ?? null;
}
