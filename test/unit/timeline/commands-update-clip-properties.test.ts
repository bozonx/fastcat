/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineTicks } from '../utils/timeline-time';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import { TICKS_PER_SECOND } from '~/utils/time';

function makeDoc(track: TimelineTrack): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [track],
  };
}

describe('timeline/commands update_clip_properties', () => {
  it('updates opacity for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { opacity: 0.25 },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.opacity).toBe(0.25);
  });

  it('updates blendMode for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { blendMode: 'screen' },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.blendMode).toBe('screen');
  });

  it('updates source orientation for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { sourceOrientation: '90' },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.sourceOrientation).toBe('90');
  });

  it('updates transform for a clip and normalizes values', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: {
        transform: {
          scale: { x: 2, y: 3, linked: true },
          rotationDeg: 45,
          position: { x: 10, y: -20 },
          anchor: { preset: 'custom', x: 2, y: -1 },
        },
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transform).toBeDefined();
    expect(clip.transform.scale.x).toBe(2);
    expect(clip.transform.scale.y).toBe(3);
    expect(clip.transform.scale.linked).toBe(true);
    expect(clip.transform.rotationDeg).toBe(45);
    expect(clip.transform.position).toEqual({ x: 10, y: -20 });
    expect(clip.transform.anchor.preset).toBe('custom');
    expect(clip.transform.anchor.x).toBe(2);
    expect(clip.transform.anchor.y).toBe(-1);
  });

  it('preserves transform flip flags', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: {
        transform: {
          flipHorizontal: true,
          flipVertical: false,
        },
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.transform).toEqual({
      flipHorizontal: true,
      flipVertical: false,
    });
  });

  it('updates backgroundColor for a background clip only', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'background',
          id: 'bg1',
          trackId: 'v1',
          name: 'BG',
          backgroundColor: '#000000',
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'bg1',
      properties: { backgroundColor: '#112233' },
    }).next;

    const bg = (next.tracks[0] as TimelineTrack).items.find((it: any) => it.id === 'bg1') as any;
    const media = (next.tracks[0] as TimelineTrack).items.find((it: any) => it.id === 'c1') as any;
    expect(bg.backgroundColor).toBe('#112233');

    const next2 = applyTimelineCommand(next, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { backgroundColor: '#ff00ff' },
    }).next;
    const media2 = (next2.tracks[0] as TimelineTrack).items.find(
      (it: any) => it.id === 'c1',
    ) as any;
    expect(media2.backgroundColor).toBeUndefined();
    expect(media.backgroundColor).toBeUndefined();
  });

  it('updates effects list for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const effects = [
      {
        id: 'e1',
        type: 'color-adjustment',
        enabled: true,
        brightness: 1,
        contrast: 1,
        saturation: 1,
      },
    ];

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { effects },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.effects).toEqual(effects);
  });

  it('updates speed and recomputes timeline duration based on sourceRange duration', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { speed: 2 },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.speed).toBe(2);
    // A non-unit speed must activate the time-warp so it survives OTIO
    // serialization and reaches the playback payload (not just the waveform).
    expect(clip.speedActive).toBe(true);
    expect(clip.timelineRange.durationTicks).toBeGreaterThan(0);
    expect(clip.timelineRange.durationTicks).toBeLessThan(timelineTicks(1_000_000));
  });

  it('activates the time-warp on reverse and clears it back at unity speed', () => {
    const makeReverseDoc = () =>
      makeDoc({
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'c1',
            trackId: 'v1',
            name: 'C1',
            source: { path: 'a.mp4' },
            sourceDurationTicks: timelineTicks(10_000_000),
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          },
        ],
      });

    const apply = (doc: TimelineDocument, speed: number) =>
      applyTimelineCommand(doc, {
        type: 'update_clip_properties',
        trackId: 'v1',
        itemId: 'c1',
        properties: { speed },
      }).next;

    // Reverse (negative speed) must activate the warp so video actually plays
    // backwards and the clip's audio is muted downstream.
    const reversed = (apply(makeReverseDoc(), -1).tracks[0] as TimelineTrack).items[0] as any;
    expect(reversed.speed).toBe(-1);
    expect(reversed.speedActive).toBe(true);

    // Un-reversing back to 1× clears the flag (no time-warp to persist).
    const restored = (apply(makeReverseDoc(), 1).tracks[0] as TimelineTrack).items[0] as any;
    expect(restored.speed).toBe(1);
    expect(restored.speedActive).toBe(false);
  });

  it('keeps sourceRange as the anchor so repeated speed edits do not accumulate drift', () => {
    const makeSpeedDoc = () =>
      makeDoc({
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'c1',
            trackId: 'v1',
            name: 'C1',
            source: { path: 'a.mp4' },
            sourceDurationTicks: timelineTicks(10_000_000),
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          },
        ],
      });

    const applySpeed = (doc: TimelineDocument, speed: number) =>
      applyTimelineCommand(doc, {
        type: 'update_clip_properties',
        trackId: 'v1',
        itemId: 'c1',
        properties: { speed },
      }).next;

    // Walk through several speeds and back to 1. Because the source range is the
    // anchor (speed only re-derives the timeline duration from it), returning to
    // a speed must reproduce the same timeline duration regardless of the path.
    let doc = makeSpeedDoc();
    for (const speed of [3, 0.5, 4, 2, 1]) {
      doc = applySpeed(doc, speed);
    }
    const clip = (doc.tracks[0] as TimelineTrack).items[0] as any;

    // The source window must never change as a side effect of speed edits.
    expect(clip.sourceRange).toEqual({ startTicks: 0, durationTicks: timelineTicks(1_000_000) });
    expect(clip.speed).toBe(1);
    // Back at unity speed the timeline duration equals the (unchanged) source.
    expect(clip.timelineRange.durationTicks).toBe(timelineTicks(1_000_000));
  });

  it('proportionally shrinks audio fades when they would overlap on the same clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
          audioFadeOutTicks: timelineTicks(3_000_000),
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { audioFadeInTicks: timelineTicks(4_000_000) },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.audioFadeInTicks).toBe(timelineTicks(2_000_000));
    expect(clip.audioFadeOutTicks).toBe(timelineTicks(3_000_000));
    expect(clip.audioFadeInTicks + clip.audioFadeOutTicks).toBe(timelineTicks(5_000_000));
  });

  it('ripples subsequent clips when slowing down would cause overlap', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { speed: 0.5 },
    }).next;

    const track = next.tracks[0] as TimelineTrack;
    const c1 = track.items.find((it: any) => it.id === 'c1') as any;
    const c2 = track.items.find((it: any) => it.id === 'c2') as any;

    expect(c1.speed).toBe(0.5);
    expect(c1.timelineRange.durationTicks).toBe(timelineTicks(2_000_000));
    expect(c2.timelineRange.startTicks).toBe(timelineTicks(2_000_000));
  });

  it('preserves exact adjacency when a speed ripple starts off the frame grid', () => {
    const frameTicks = TICKS_PER_SECOND / 30;
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: 4 * frameTicks,
          timelineRange: { startTicks: 1, durationTicks: frameTicks },
          sourceRange: { startTicks: 0, durationTicks: 2 * frameTicks },
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 4 * frameTicks,
          timelineRange: { startTicks: frameTicks + 1, durationTicks: frameTicks },
          sourceRange: { startTicks: 0, durationTicks: frameTicks },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { speed: 0.5 },
    }).next;

    const clips = next.tracks[0]!.items.filter((item: any) => item.kind === 'clip') as any[];
    const c1 = clips.find((item) => item.id === 'c1');
    const c2 = clips.find((item) => item.id === 'c2');

    expect(c2.timelineRange.startTicks).toBe(c1.timelineRange.startTicks + c1.timelineRange.durationTicks);
    expect(c2.timelineRange.startTicks).toBe(4 * frameTicks + 1);
  });

  it('preserves audio fade lengths when clip duration increases', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) },
          audioFadeInTicks: timelineTicks(1_000_000),
          audioFadeOutTicks: timelineTicks(1_500_000),
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: {
        timelineRange: { startTicks: 0, durationTicks: timelineTicks(6_000_000) },
        sourceRange: { startTicks: 0, durationTicks: timelineTicks(6_000_000) },
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.timelineRange.durationTicks).toBe(timelineTicks(6_000_000));
    expect(clip.audioFadeInTicks).toBe(timelineTicks(1_000_000));
    expect(clip.audioFadeOutTicks).toBe(timelineTicks(1_500_000));
  });

  it('sanitizes style for a text clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'text',
          id: 't1',
          trackId: 'v1',
          name: 'T1',
          text: 'Hello',
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        } as any,
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 't1',
      properties: {
        style: {
          width: 333.8,
          height: 222.2,
          fontSize: 12.4,
          verticalAlign: 'bottom',
          lineHeight: 2,
          letterSpacing: 5,
          colorAlpha: 1.5,
          textShadowEnabled: true,
          textShadowColor: '  #000000  ',
          textShadowAlpha: 0.3,
          textShadowBlur: 6,
          textShadowOffsetX: -2,
          textShadowOffsetY: 4,
          backgroundEnabled: true,
          backgroundColor: '  #112233  ',
          backgroundAlpha: -1,
          backgroundRadius: 8,
          backgroundShadowEnabled: true,
          backgroundShadowColor: '  #445566  ',
          backgroundShadowAlpha: 0.6,
          backgroundShadowBlur: 12,
          backgroundShadowSpread: 2,
          backgroundShadowOffsetX: 1,
          backgroundShadowOffsetY: 5,
          borderEnabled: true,
          borderColor: '  #abcdef  ',
          borderAlpha: 0.4,
          borderWidth: 3,
          paddingLinked: false,
          padding: { x: 10, y: 20 },
          unknown: 'x',
        } as any,
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.style).toEqual({
      width: 334,
      height: 222,
      fontSize: 12,
      verticalAlign: 'bottom',
      lineHeight: 2,
      letterSpacing: 5,
      colorAlpha: 1,
      textShadowEnabled: true,
      textShadowColor: '#000000',
      textShadowAlpha: 0.3,
      textShadowBlur: 6,
      textShadowOffsetX: -2,
      textShadowOffsetY: 4,
      backgroundEnabled: true,
      backgroundColor: '#112233',
      backgroundAlpha: 0,
      backgroundRadius: 8,
      backgroundShadowEnabled: true,
      backgroundShadowColor: '#445566',
      backgroundShadowAlpha: 0.6,
      backgroundShadowBlur: 12,
      backgroundShadowSpread: 2,
      backgroundShadowOffsetX: 1,
      backgroundShadowOffsetY: 5,
      borderEnabled: true,
      borderColor: '#abcdef',
      borderAlpha: 0.4,
      borderWidth: 3,
      paddingLinked: false,
      padding: { top: 20, right: 10, bottom: 20, left: 10 },
    });
  });

  it('drops invalid style fields for a text clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'text',
          id: 't1',
          trackId: 'v1',
          name: 'T1',
          text: 'Hello',
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
        } as any,
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 't1',
      properties: {
        style: {
          verticalAlign: 'nope',
          lineHeight: Infinity,
          letterSpacing: 'a',
          backgroundColor: '   ',
          colorBlendMode: 'overlay',
          backgroundBlendMode: 42,
          padding: { top: 0, left: 0, right: 0, bottom: 0 },
        } as any,
      },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.style).toBeUndefined();
  });

  it('updates showWaveform on a clip directly', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'Video Clip',
          source: { path: 'video.mp4' },
          sourceDurationTicks: timelineTicks(10_000_000),
          timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
          sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
          showWaveform: true,
        } as any,
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { showWaveform: false },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.showWaveform).toBe(false);
  });
});
