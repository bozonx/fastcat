import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';

// useAppClipboard wraps a pinia store; stub it so the composable is exercised in
// isolation without standing up the real clipboard store.
const clipboardState: { clipboardPayload: unknown; setClipboardPayload: ReturnType<typeof vi.fn> } =
  {
    clipboardPayload: null,
    setClipboardPayload: vi.fn(),
  };
vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => clipboardState,
}));

type AnyClip = Record<string, unknown>;

function makeClip(overrides: AnyClip = {}): any {
  return {
    id: 'clip1',
    trackId: 'v1',
    kind: 'clip',
    clipType: 'media',
    name: 'Clip 1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    source: { path: '/media/video.mp4' },
    ...overrides,
  };
}

function makeTrack(overrides: AnyClip = {}): any {
  return { id: 'v1', kind: 'video', items: [], ...overrides };
}

function makeDoc(tracks: any[], fps = 30): any {
  return { tracks, timebase: { fps } };
}

function makeTimelineStore(overrides: AnyClip = {}): any {
  return {
    timelineDoc: makeDoc([makeTrack({ items: [makeClip()] })]),
    selectedItemIds: ['clip1'],
    fps: 30,
    currentTime: 0,
    applyTimeline: vi.fn(() => []),
    batchApplyTimeline: vi.fn(() => []),
    loadTimeline: vi.fn(async () => {}),
    loadTimelineMetadata: vi.fn(),
    updateClipProperties: vi.fn(),
    unlinkAudioFromVideo: vi.fn(),
    renameItem: vi.fn(),
    selectTimelineItems: vi.fn(),
    updateTrackProperties: vi.fn(),
    deleteFirstSelectedItem: vi.fn(),
    rippleDeleteFirstSelectedItem: vi.fn(),
    pasteClips: vi.fn(async () => []),
    ...overrides,
  };
}

function build(options: { clip?: any; trackKind?: 'video' | 'audio'; timelineStore?: any } = {}) {
  const timelineStore = options.timelineStore ?? makeTimelineStore();
  const clip = options.clip ?? makeClip();
  const uiStore = {
    selectedFsEntry: null,
    mediaReplaceTarget: null,
    isMediaReplaceModalOpen: false,
    notifyFileManagerUpdate: vi.fn(),
    triggerScrollToFileTreeEntry: vi.fn(),
    triggerOpenAutoMontage: vi.fn(),
    triggerSpeedModal: vi.fn(),
  } as any;
  const actions = useClipPropertiesActions({
    clip: ref(clip),
    trackKind: ref(options.trackKind ?? 'video'),
    timelineStore,
    projectStore: {
      currentView: 'cut',
      projectSettings: {},
      openTimelineFile: vi.fn(async () => {}),
      goToFiles: vi.fn(),
      goToCut: vi.fn(),
    } as any,
    uiStore,
    fileManagerStore: { openFolder: vi.fn() } as any,
    selectionStore: { selectFsEntry: vi.fn(), selectTimelineItem: vi.fn() } as any,
    focusStore: { setTempFocus: vi.fn() } as any,
    fileManager: {
      loadProjectDirectory: vi.fn(async () => {}),
      findEntryByPath: vi.fn(),
      toggleDirectory: vi.fn(async () => {}),
    } as any,
    setActiveTab: vi.fn(),
    inDevelopmentFeaturesEnabled: ref(true),
  });
  return { actions, timelineStore, clip, uiStore };
}

describe('useClipPropertiesActions', () => {
  beforeEach(() => {
    clipboardState.clipboardPayload = null;
    clipboardState.setClipboardPayload = vi.fn();
  });

  describe('isFreePosition', () => {
    it('is false for frame-aligned clips', () => {
      const { actions } = build();
      expect(actions.isFreePosition.value).toBe(false);
    });

    it('is true when start/duration are not frame-aligned', () => {
      const clip = makeClip({ timelineRange: { startUs: 1234, durationUs: 5_000_001 } });
      const { actions } = build({ clip });
      expect(actions.isFreePosition.value).toBe(true);
    });
  });

  describe('handleDeleteClip', () => {
    it('dispatches delete_items and removes the id from the selection', () => {
      const timelineStore = makeTimelineStore({ selectedItemIds: ['clip1', 'other'] });
      const { actions } = build({ timelineStore });

      actions.handleDeleteClip();

      expect(timelineStore.applyTimeline).toHaveBeenCalledWith({
        type: 'delete_items',
        trackId: 'v1',
        itemIds: ['clip1'],
      });
      expect(timelineStore.selectedItemIds).toEqual(['other']);
    });
  });



  describe('toggle handlers', () => {
    it.each([
      ['handleToggleDisabled', 'disabled'],
      ['handleToggleLocked', 'locked'],
      ['handleToggleMuted', 'audioMuted'],
    ] as const)('%s flips %s via updateClipProperties', (method, prop) => {
      const clip = makeClip({ [prop]: false });
      const { actions, timelineStore } = build({ clip });

      (actions as any)[method]();

      expect(timelineStore.updateClipProperties).toHaveBeenCalledWith('v1', 'clip1', {
        [prop]: true,
      });
    });
  });

  describe('handleFreezeFrame', () => {
    it('stores the clamped playhead offset relative to the clip start', () => {
      const clip = makeClip({ timelineRange: { startUs: 1_000_000, durationUs: 4_000_000 } });
      const timelineStore = makeTimelineStore({ currentTime: 2_500_000 });
      const { actions } = build({ clip, timelineStore });

      actions.handleFreezeFrame();

      expect(timelineStore.updateClipProperties).toHaveBeenCalledWith('v1', 'clip1', {
        freezeFrameSourceUs: 1_500_000,
      });
    });

    it('does not store freeze frame if playhead is outside the clip range', () => {
      const clip = makeClip({ timelineRange: { startUs: 0, durationUs: 1_000_000 } });
      const timelineStore = makeTimelineStore({ currentTime: 9_000_000 });
      const { actions } = build({ clip, timelineStore });

      actions.handleFreezeFrame();

      expect(timelineStore.updateClipProperties).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveFromGroup', () => {
    it('clears linkedGroupId when the clip is grouped', () => {
      const clip = makeClip({ linkedGroupId: 'grp-1' });
      const { actions, timelineStore } = build({ clip });

      actions.handleRemoveFromGroup();

      expect(timelineStore.updateClipProperties).toHaveBeenCalledWith('v1', 'clip1', {
        linkedGroupId: undefined,
      });
    });

    it('is a no-op when the clip has no group', () => {
      const { actions, timelineStore } = build();
      actions.handleRemoveFromGroup();
      expect(timelineStore.updateClipProperties).not.toHaveBeenCalled();
    });
  });

  describe('handlePaste', () => {
    it('pastes timeline clipboard items at the playhead and clears the clipboard on cut', () => {
      clipboardState.clipboardPayload = {
        source: 'timeline',
        operation: 'cut',
        items: [{ id: 'x' }],
      };
      const timelineStore = makeTimelineStore({ currentTime: 7_000_000 });
      const { actions } = build({ timelineStore });

      actions.handlePaste();

      expect(timelineStore.pasteClips).toHaveBeenCalledWith([{ id: 'x' }], {
        insertStartUs: 7_000_000,
      });
      expect(clipboardState.setClipboardPayload).toHaveBeenCalledWith(null);
    });

    it('does nothing for a non-timeline payload', () => {
      clipboardState.clipboardPayload = { source: 'clipParameters', snapshot: {} };
      const { actions, timelineStore } = build();
      actions.handlePaste();
      expect(timelineStore.pasteClips).not.toHaveBeenCalled();
    });
  });



    it('exposes media-specific actions for media clips', () => {
      const { actions } = build();
      const ids = actions.otherActionsList.value.map((a) => a.id);
      expect(ids).toEqual(
        expect.arrayContaining(['replaceMedia', 'showInFileManager', 'autoMontage']),
      );
    });

    it('triggers replaceMedia action setting correct expectedType', () => {
      // 1. Video clip on a video track
      const { actions: videoActions, uiStore: videoUiStore } = build({ trackKind: 'video' });
      const replaceVideoAction = videoActions.otherActionsList.value.find(
        (a) => a.id === 'replaceMedia',
      );
      expect(replaceVideoAction).toBeTruthy();
      replaceVideoAction?.onClick();
      expect(videoUiStore.mediaReplaceTarget).toEqual({
        trackId: 'v1',
        itemId: 'clip1',
        expectedType: ['video'],
      });
      expect(videoUiStore.isMediaReplaceModalOpen).toBe(true);

      // 2. Image clip on a video track
      const imageClip = makeClip({ isImage: true });
      const { actions: imageActions, uiStore: imageUiStore } = build({
        trackKind: 'video',
        clip: imageClip,
      });
      const replaceImageAction = imageActions.otherActionsList.value.find(
        (a) => a.id === 'replaceMedia',
      );
      expect(replaceImageAction).toBeTruthy();
      replaceImageAction?.onClick();
      expect(imageUiStore.mediaReplaceTarget).toEqual({
        trackId: 'v1',
        itemId: 'clip1',
        expectedType: ['image'],
      });
      expect(imageUiStore.isMediaReplaceModalOpen).toBe(true);

      // 3. Audio clip on an audio track
      const audioClip = makeClip({ trackId: 'a1' });
      const { actions: audioActions, uiStore: audioUiStore } = build({
        trackKind: 'audio',
        clip: audioClip,
      });
      const replaceAudioAction = audioActions.otherActionsList.value.find(
        (a) => a.id === 'replaceMedia',
      );
      expect(replaceAudioAction).toBeTruthy();
      replaceAudioAction?.onClick();
      expect(audioUiStore.mediaReplaceTarget).toEqual({
        trackId: 'a1',
        itemId: 'clip1',
        expectedType: ['audio', 'video'],
      });
      expect(audioUiStore.isMediaReplaceModalOpen).toBe(true);
    });

    it('includes speed action for speed-controllable clips and triggers modal', () => {
      const { actions, uiStore } = build();
      const speedAction = actions.otherActionsList.value.find((a) => a.id === 'speed');
      expect(speedAction).toBeTruthy();
      expect(speedAction?.label).toContain('fastcat.timeline.speed');

      speedAction?.onClick();
      expect(uiStore.triggerSpeedModal).toHaveBeenCalledWith('v1', 'clip1', 1);
    });

    it('includes reverse action for video clips but not for audio clips', () => {
      const video = build({ trackKind: 'video' });
      expect(video.actions.otherActionsList.value.some((a) => a.id === 'reverse-speed')).toBe(true);

      const audio = build({ trackKind: 'audio', clip: makeClip({ trackId: 'a1' }) });
      expect(audio.actions.otherActionsList.value.some((a) => a.id === 'reverse-speed')).toBe(
        false,
      );
    });

    it('disables speed and reverse actions when freeze frame is active', () => {
      const clip = makeClip({ freezeFrameSourceUs: 500_000 });
      const { actions } = build({ clip });
      const speedAction = actions.otherActionsList.value.find((a) => a.id === 'speed');
      const reverseAction = actions.otherActionsList.value.find((a) => a.id === 'reverse-speed');

      expect(speedAction?.disabled).toBe(true);
      expect(reverseAction?.disabled).toBe(true);
    });

    it('disables freezeFrame action when playhead is outside the clip', () => {
      const clip = makeClip({ timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } });
      const timelineStore = makeTimelineStore({ currentTime: 500_000 });
      const { actions } = build({ clip, timelineStore });

      const freezeAction = actions.otherActionsList.value.find((a) => a.id === 'freezeFrame');
      expect(freezeAction?.disabled).toBe(true);
    });

    it('includes rename after paste-parameters in other actions', () => {
      const { actions } = build();
      const ids = actions.otherActionsList.value.map((a) => a.id);
      const pasteParametersIndex = ids.indexOf('paste-parameters');
      const renameIndex = ids.indexOf('rename');
      expect(renameIndex).toBeGreaterThan(-1);
      expect(renameIndex).toBeGreaterThan(pasteParametersIndex);
    });

    it('includes toggleShowThumbnails for media video clips', () => {
      const { actions } = build({ trackKind: 'video' });
      expect(actions.otherActionsList.value.some((a) => a.id === 'toggleShowThumbnails')).toBe(
        true,
      );
    });

    it.each(['adjustment', 'text', 'background'] as const)(
      'hides toggleShowThumbnails for %s clips',
      (clipType) => {
        const clip = makeClip({ clipType });
        const { actions } = build({ clip, trackKind: 'video' });
        expect(actions.otherActionsList.value.some((a) => a.id === 'toggleShowThumbnails')).toBe(
          false,
        );
      },
    );
  });

  describe('commonActionsList', () => {
    it('does not include rename in common actions', () => {
      const { actions } = build();
      expect(actions.commonActionsList.value.some((a) => a.id === 'rename')).toBe(false);
    });

    it('includes a mute toggle for audio-bearing clips and omits it otherwise', () => {
      const withAudio = build({ trackKind: 'audio', clip: makeClip({ trackId: 'a1' }) });
      expect(withAudio.actions.commonActionsList.value.some((a) => a.id === 'toggle-muted')).toBe(
        true,
      );

      const textClip = makeClip({ clipType: 'text' });
      const noAudio = build({ trackKind: 'video', clip: textClip });
      expect(noAudio.actions.commonActionsList.value.some((a) => a.id === 'toggle-muted')).toBe(
        false,
      );
    });

    it('updates labels and values reactively when clip props change', () => {
      const clip = ref(makeClip({ disabled: false, audioMuted: false, locked: false }));
      const { actions } = build({ clip });

      const getAction = (id: string) => actions.commonActionsList.value.find((a) => a.id === id);

      expect(getAction('toggle-disabled')?.label).toBe('fastcat.timeline.disableClip');
      expect(getAction('toggle-muted')?.label).toBe('fastcat.timeline.muteClip');
      expect(getAction('toggle-locked')?.label).toBe('fastcat.timeline.lockClip');

      // Update ref value
      clip.value = makeClip({ disabled: true, audioMuted: true, locked: true });

      expect(getAction('toggle-disabled')?.label).toBe('fastcat.timeline.enableClip');
      expect(getAction('toggle-muted')?.label).toBe('fastcat.timeline.unmuteClip');
      expect(getAction('toggle-locked')?.label).toBe('fastcat.timeline.unlockClip');
    });
  });
});
