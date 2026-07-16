import { describe, expect, it } from 'vitest';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import {
  buildClipParametersPatch,
  createClipParametersSnapshot,
  getApplicableClipParameterGroups,
  getApplicableClipParameterGroupsForTargets,
  hasClipParametersPatch,
  resolveClipParametersApplyTargets,
} from '~/utils/timeline/clip-parameters';
import { timelineTicks } from '../../utils/timeline-time';

function makeClip(patch: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'v1',
    name: 'Clip',
    source: { path: 'source.mp4' },
    sourceDurationTicks: timelineTicks(10_000_000),
    timelineRange: { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(2_000_000) },
    sourceRange: { startTicks: timelineTicks(100_000), durationTicks: timelineTicks(2_000_000) },
    ...patch,
  } as TimelineClipItem;
}

describe('clip parameters clipboard helpers', () => {
  it('copies transferable clip parameters without identity, source or ranges', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        id: 'source-clip',
        trackId: 'v2',
        transform: { scale: { x: 2, y: 2 } },
        opacity: 0.5,
        speed: 1.5,
        effects: [
          { id: 'fx-video', manifestId: 'blur', params: {}, target: 'video' },
          { id: 'fx-audio', manifestId: 'echo', params: {}, target: 'audio' },
        ],
        transitionIn: { type: 'fade', durationTicks: timelineTicks(200_000) },
      }),
    });

    expect(snapshot.groups.transform).toEqual({ transform: { scale: { x: 2, y: 2 } } });
    expect(snapshot.groups.opacity).toEqual({ opacity: 0.5 });
    expect(snapshot.groups.speed).toEqual({ speed: 1.5 });
    expect(snapshot.groups.videoEffects?.effects).toHaveLength(1);
    expect(snapshot.groups.audioEffects?.effects).toHaveLength(1);
    expect(snapshot.groups.transitions?.transitionIn).toEqual({
      type: 'fade',
      durationTicks: timelineTicks(200_000),
    });
    expect(JSON.stringify(snapshot)).not.toContain('source-clip');
    expect(JSON.stringify(snapshot)).not.toContain('source.mp4');
    expect(JSON.stringify(snapshot)).not.toContain('timelineRange');
    expect(JSON.stringify(snapshot)).not.toContain('sourceRange');
  });

  it('filters groups by target compatibility', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        transform: { position: { x: 10, y: 20 } },
        audioGain: 0.5,
        backgroundColor: '#112233',
        style: { fontSize: 42 },
      }),
    });

    const audioTarget = makeClip({ trackId: 'a1' });
    const audioGroups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: audioTarget,
      targetTrackKind: 'audio',
    }).map((group) => group.id);

    expect(audioGroups).toContain('audio');
    expect(audioGroups).not.toContain('transform');
    expect(audioGroups).not.toContain('background');
    expect(audioGroups).not.toContain('text');
  });

  it('builds a patch for selected groups and preserves target effects outside selected groups', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        opacity: 0.25,
        effects: [
          { id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' },
          { id: 'copied-audio', manifestId: 'echo', params: {}, target: 'audio' },
        ],
      }),
    });

    const target = makeClip({
      effects: [
        { id: 'target-video', manifestId: 'bloom', params: {}, target: 'video' },
        { id: 'target-audio', manifestId: 'compressor', params: {}, target: 'audio' },
      ],
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: target,
      targetTrackKind: 'video',
      groups: ['opacity', 'videoEffects'],
    });

    expect(patch.properties.opacity).toBe(0.25);
    expect(patch.properties.effects).toEqual([
      { id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' },
      { id: 'target-audio', manifestId: 'compressor', params: {}, target: 'audio' },
    ]);
  });

  it('does not paste video effects onto an audio-track target (and keeps its own effects)', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        effects: [{ id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' }],
      }),
    });

    const audioTarget = makeClip({
      trackId: 'a1',
      effects: [{ id: 'target-audio', manifestId: 'compressor', params: {}, target: 'audio' }],
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: audioTarget,
      targetTrackKind: 'audio',
      // videoEffects is inapplicable to an audio target; selecting it must not
      // overwrite the target's effects with the source clip's video effects.
      groups: ['videoEffects'],
    });

    expect(patch.properties.effects).toBeUndefined();
    expect(hasClipParametersPatch(patch)).toBe(false);
  });

  it('pastes only applicable audio effects onto an audio target, preserving nothing video', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        effects: [
          { id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' },
          { id: 'copied-audio', manifestId: 'echo', params: {}, target: 'audio' },
        ],
      }),
    });

    const audioTarget = makeClip({ trackId: 'a1' });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: audioTarget,
      targetTrackKind: 'audio',
      groups: ['audioEffects'],
    });

    expect(patch.properties.effects).toEqual([
      { id: 'copied-audio', manifestId: 'echo', params: {}, target: 'audio' },
    ]);
  });

  it('hasClipParametersPatch returns true when properties or transitions exist', () => {
    expect(hasClipParametersPatch({ properties: { opacity: 0.5 } })).toBe(true);
    expect(
      hasClipParametersPatch({ properties: {}, transitionIn: { type: 'fade', durationTicks: 0 } }),
    ).toBe(true);
    expect(hasClipParametersPatch({ properties: {}, transitionOut: null })).toBe(true);
    expect(hasClipParametersPatch({ properties: {} })).toBe(false);
  });

  it('excludes video-only groups for audio track targets', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        transform: { position: { x: 0, y: 0 } },
        opacity: 0.5,
        mask: { path: 'mask.svg' },
        transitionIn: { type: 'fade', durationTicks: timelineTicks(100_000) },
        effects: [{ id: 'fx', manifestId: 'blur', params: {}, target: 'video' }],
      }),
    });

    const groups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: makeClip({ trackId: 'a1' }),
      targetTrackKind: 'audio',
    }).map((g: { id: string }) => g.id);

    expect(groups).not.toContain('transform');
    expect(groups).not.toContain('opacity');
    expect(groups).not.toContain('mask');
    expect(groups).not.toContain('transitions');
    expect(groups).not.toContain('videoEffects');
  });

  it('includes shape only for shape clips, text only for text clips, etc.', () => {
    const shapeSnapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'shape', shapeType: 'rect', fillColor: '#ff0000' }),
    });
    const textSnapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'text', style: { fontSize: 12 } }),
    });
    const bgSnapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'background', backgroundColor: '#000000' }),
    });

    const shapeTarget = makeClip({ clipType: 'shape', trackId: 'v1' });
    const textTarget = makeClip({ clipType: 'text', trackId: 'v1' });
    const bgTarget = makeClip({ clipType: 'background', trackId: 'v1' });

    expect(
      getApplicableClipParameterGroups({
        snapshot: shapeSnapshot,
        targetClip: shapeTarget,
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).toContain('shape');

    expect(
      getApplicableClipParameterGroups({
        snapshot: textSnapshot,
        targetClip: textTarget,
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).toContain('text');

    expect(
      getApplicableClipParameterGroups({
        snapshot: bgSnapshot,
        targetClip: bgTarget,
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).toContain('background');

    // shape/text/background are NOT applicable to each other
    expect(
      getApplicableClipParameterGroups({
        snapshot: shapeSnapshot,
        targetClip: makeClip({ clipType: 'text' }),
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).not.toContain('shape');
  });

  it('includes sourceOrientation as a transform sub-property only for media clips', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'media', sourceOrientation: 90 }),
    });

    const mediaGroups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: makeClip({ clipType: 'media' }),
      targetTrackKind: 'video',
    });
    const transformGroup = mediaGroups.find((g: { id: string }) => g.id === 'transform');

    expect(mediaGroups.map((g: { id: string }) => g.id)).toContain('transform');
    expect(transformGroup?.subProperties?.map((p) => p.id)).toContain(
      'transform:sourceOrientation',
    );

    const textGroups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: makeClip({ clipType: 'text' }),
      targetTrackKind: 'video',
    });
    expect(textGroups.map((g: { id: string }) => g.id)).not.toContain('transform');

    const textTargetPatch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip({ clipType: 'text' }),
      targetTrackKind: 'video',
      groups: ['transform:sourceOrientation'],
    });
    expect(textTargetPatch.properties.sourceOrientation).toBeUndefined();
  });

  it('includes speed only for media and timeline clips', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'media', speed: 2 }),
    });

    expect(
      getApplicableClipParameterGroups({
        snapshot,
        targetClip: makeClip({ clipType: 'media' }),
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).toContain('speed');

    expect(
      getApplicableClipParameterGroups({
        snapshot,
        targetClip: makeClip({ clipType: 'text' }),
        targetTrackKind: 'video',
      }).map((g: { id: string }) => g.id),
    ).not.toContain('speed');
  });

  it('populates subProperties for text, transform, and audio groups', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        clipType: 'text',
        transform: { scale: { x: 2, y: 2 } },
        style: { fontSize: 42, textShadowEnabled: true },
        audioGain: 0.8,
      }),
    });

    const groups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: makeClip({ clipType: 'text' }),
      targetTrackKind: 'video',
    });

    const transformOpt = groups.find((g) => g.id === 'transform');
    expect(transformOpt?.subProperties).toBeDefined();
    expect(transformOpt?.subProperties?.map((p) => p.id)).toContain('transform:scale');

    const textOpt = groups.find((g) => g.id === 'text');
    expect(textOpt?.subProperties).toBeDefined();
    expect(textOpt?.subProperties?.map((p) => p.id)).toContain('text:textShadow');
  });

  it('partially merges transform parameters based on selected sub-properties', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        transform: {
          scale: { x: 2, y: 2 },
          rotationDeg: 45,
          position: { x: 10, y: 20 },
        },
      }),
    });

    const target = makeClip({
      transform: {
        scale: { x: 1, y: 1 },
        rotationDeg: 90,
        position: { x: 0, y: 0 },
      },
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: target,
      targetTrackKind: 'video',
      groups: ['transform:scale', 'transform:position'],
    });

    expect(patch.properties.transform?.scale).toEqual({ x: 2, y: 2 });
    expect(patch.properties.transform?.position).toEqual({ x: 10, y: 20 });
    expect(patch.properties.transform?.rotationDeg).toBe(90); // Preserved!
  });

  it('partially merges text style parameters based on selected sub-properties', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        clipType: 'text',
        style: {
          fontSize: 64,
          color: '#ff0000',
          textShadowEnabled: true,
          textShadowColor: '#000000',
          backgroundEnabled: true,
          backgroundColor: '#ffffff',
        },
      }),
    });

    const target = makeClip({
      clipType: 'text',
      style: {
        fontSize: 32,
        color: '#0000ff',
        textShadowEnabled: false,
        backgroundEnabled: false,
      },
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: target,
      targetTrackKind: 'video',
      groups: ['text:textShadow', 'text:background'],
    });

    expect(patch.properties.style?.fontSize).toBe(32); // Preserved!
    expect(patch.properties.style?.color).toBe('#0000ff'); // Preserved!
    expect(patch.properties.style?.textShadowEnabled).toBe(true);
    expect(patch.properties.style?.textShadowColor).toBe('#000000');
    expect(patch.properties.style?.backgroundEnabled).toBe(true);
    expect(patch.properties.style?.backgroundColor).toBe('#ffffff');
  });

  it('partially merges audio parameters based on selected sub-properties', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'audio',
      clip: makeClip({
        audioGain: 0.5,
        audioBalance: -1,
        audioFadeInTicks: timelineTicks(500_000),
        audioFadesActive: true,
      }),
    });

    const target = makeClip({
      audioGain: 1.0,
      audioBalance: 0,
      audioFadeInTicks: 0,
      audioFadesActive: false,
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: target,
      targetTrackKind: 'audio',
      groups: ['audio:volume', 'audio:fades'],
    });

    expect(patch.properties.audioGain).toBe(0.5);
    expect(patch.properties.audioFadeInTicks).toBe(timelineTicks(500_000));
    expect(patch.properties.audioFadesActive).toBe(true);
    expect(patch.properties.audioBalance).toBeUndefined(); // Preserved!
  });

  it('partially merges mask, shape, hud, transitions and text content', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        clipType: 'hud',
        text: 'Copied text',
        style: { fontSize: 64 },
        mask: { source: { path: 'mask.png' }, mode: 'luma', invert: true },
        maskActive: true,
        shapeType: 'circle',
        fillColor: '#ff0000',
        strokeColor: '#00ff00',
        strokeWidth: 4,
        shapeConfig: { squashX: 20 },
        hudType: 'media_frame',
        background: { scaleX: 2 },
        content: { offsetX: 10 },
        frame: { scaleY: 3 },
        transitionIn: { type: 'fade', durationTicks: timelineTicks(200_000) },
        transitionOut: { type: 'slide', durationTicks: timelineTicks(300_000) },
      }),
    });

    const maskPatch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip({
        mask: { source: { path: 'old-mask.png' }, mode: 'alpha', invert: false },
      }),
      targetTrackKind: 'video',
      groups: ['mask:mode'],
    });
    expect(maskPatch.properties.mask).toEqual({
      source: { path: 'old-mask.png' },
      mode: 'luma',
      invert: false,
    });

    const shapePatch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip({ clipType: 'shape', fillColor: '#0000ff', strokeWidth: 1 }),
      targetTrackKind: 'video',
      groups: ['shape:fill', 'shape:stroke'],
    });
    expect(shapePatch.properties.fillColor).toBe('#ff0000');
    expect(shapePatch.properties.strokeColor).toBe('#00ff00');
    expect(shapePatch.properties.strokeWidth).toBe(4);
    expect(shapePatch.properties.shapeType).toBeUndefined();

    const hudPatch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip({ clipType: 'hud', content: { offsetX: 0 }, frame: { scaleY: 1 } }),
      targetTrackKind: 'video',
      groups: ['hud:content'],
    });
    expect(hudPatch.properties.content).toEqual({ offsetX: 10 });
    expect(hudPatch.properties.background).toBeUndefined();
    expect(hudPatch.properties.frame).toBeUndefined();

    const transitionPatch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip(),
      targetTrackKind: 'video',
      groups: ['transitions:out'],
    });
    expect(transitionPatch.transitionIn).toBeUndefined();
    expect(transitionPatch.transitionOut).toEqual({
      type: 'slide',
      durationTicks: timelineTicks(300_000),
    });

    const textSnapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ clipType: 'text', text: 'Copied text', style: { fontSize: 64 } }),
    });
    const textPatch = buildClipParametersPatch({
      snapshot: textSnapshot,
      targetClip: makeClip({ clipType: 'text', text: 'Old text', style: { fontSize: 20 } }),
      targetTrackKind: 'video',
      groups: ['text:content'],
    });
    expect(textPatch.properties.text).toBe('Copied text');
    expect(textPatch.properties.style).toBeUndefined();
  });

  it('copies keyframe animations as a dedicated group and pastes them onto another clip', () => {
    const animations = {
      opacity: { keyframes: [{ tTicks: 0, value: 0, easing: 'linear' as const }] },
      'transform.rotationDeg': {
        keyframes: [{ tTicks: timelineTicks(500_000), value: 90, easing: 'ease' as const }],
      },
    };
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ animations }),
    });
    expect(snapshot.groups.animation).toEqual({ animations });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: makeClip({ id: 'target' }),
      targetTrackKind: 'video',
      groups: ['animation'],
    });
    expect(patch.properties.animations).toEqual(animations);
  });
});

describe('resolveClipParametersApplyTargets', () => {
  const clipA = makeClip({ id: 'a', trackId: 'v1' });
  const clipB = makeClip({ id: 'b', trackId: 'v1' });
  const clipC = makeClip({ id: 'c', trackId: 'v2' });
  const doc = {
    tracks: [
      { id: 'v1', kind: 'video', items: [clipA, clipB] },
      { id: 'v2', kind: 'video', items: [clipC] },
    ],
  } as unknown as TimelineDocument;

  const target = { trackId: 'v1', trackKind: 'video' as const, clip: clipA };

  it('stays single-clip when only one item is selected', () => {
    const result = resolveClipParametersApplyTargets({
      doc,
      selectedItemIds: ['a'],
      target,
    });
    expect(result).toEqual([target]);
  });

  it('stays single-clip when the target is not part of the selection', () => {
    const result = resolveClipParametersApplyTargets({
      doc,
      selectedItemIds: ['b', 'c'],
      target,
    });
    expect(result).toEqual([target]);
  });

  it('fans out across the whole selection when the target is in a multi-selection', () => {
    const result = resolveClipParametersApplyTargets({
      doc,
      selectedItemIds: ['a', 'b', 'c'],
      target,
    });
    expect(result.map((t) => t.clip.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((t) => t.trackId)).toEqual(['v1', 'v1', 'v2']);
  });

  it('skips selection ids that no longer resolve to a clip', () => {
    const result = resolveClipParametersApplyTargets({
      doc,
      selectedItemIds: ['a', 'missing', 'c'],
      target,
    });
    expect(result.map((t) => t.clip.id)).toEqual(['a', 'c']);
  });

  it('falls back to the target when the doc is null', () => {
    const result = resolveClipParametersApplyTargets({
      doc: null,
      selectedItemIds: ['a', 'b'],
      target,
    });
    expect(result).toEqual([target]);
  });

  it('returns no targets for a locked single clip so the atomic paste is skipped', () => {
    const lockedClip = makeClip({ id: 'a', trackId: 'v1', locked: true });
    const lockedDoc = {
      tracks: [{ id: 'v1', kind: 'video', items: [lockedClip] }],
    } as unknown as TimelineDocument;

    const result = resolveClipParametersApplyTargets({
      doc: lockedDoc,
      selectedItemIds: ['a'],
      target: { trackId: 'v1', trackKind: 'video', clip: lockedClip },
    });
    expect(result).toEqual([]);
  });

  it('skips locked clips in a fan-out instead of aborting the whole paste', () => {
    const lockedB = makeClip({ id: 'b', trackId: 'v1', locked: true });
    const mixedDoc = {
      tracks: [
        { id: 'v1', kind: 'video', items: [clipA, lockedB] },
        { id: 'v2', kind: 'video', items: [clipC] },
      ],
    } as unknown as TimelineDocument;

    const result = resolveClipParametersApplyTargets({
      doc: mixedDoc,
      selectedItemIds: ['a', 'b', 'c'],
      target,
    });
    expect(result.map((t) => t.clip.id)).toEqual(['a', 'c']);
  });
});

describe('getApplicableClipParameterGroupsForTargets', () => {
  it('unions applicable groups across a mixed selection', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        clipType: 'text',
        opacity: 0.5,
        transform: { position: { x: 1, y: 2 } },
        style: { fontSize: 12 },
      }),
    });

    // A text clip contributes text (+transform/opacity); a media clip on a video
    // track also accepts transform/opacity but not text. The union must expose
    // every group that at least one target can receive.
    const groups = getApplicableClipParameterGroupsForTargets({
      snapshot,
      targets: [
        { trackId: 'v1', trackKind: 'video', clip: makeClip({ clipType: 'text' }) },
        { trackId: 'v1', trackKind: 'video', clip: makeClip({ clipType: 'media' }) },
      ],
    }).map((g) => g.id);

    expect(groups).toContain('transform');
    expect(groups).toContain('opacity');
    expect(groups).toContain('text');
  });

  it('returns nothing when there are no targets or no snapshot', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({ opacity: 0.5 }),
    });
    expect(getApplicableClipParameterGroupsForTargets({ snapshot, targets: [] })).toEqual([]);
    expect(
      getApplicableClipParameterGroupsForTargets({
        snapshot: null,
        targets: [{ trackId: 'v1', trackKind: 'video', clip: makeClip() }],
      }),
    ).toEqual([]);
  });
});
