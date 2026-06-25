import { describe, it, expect, vi } from 'vitest';

import { TrackRuntimeManager } from '~/utils/video-editor/compositor/TrackRuntimeManager';
import type { CompositorTrack } from '~/utils/video-editor/compositor/types';

const toVideoEffects = (v: unknown) => (Array.isArray(v) ? v : undefined);

function makeMockApp(): any {
  const stage = {
    children: [] as any[],
    addChild: vi.fn((child: any) => {
      if (!stage.children.includes(child)) stage.children.push(child);
    }),
  };
  return { stage };
}

describe('TrackRuntimeManager', () => {
  it('getById returns undefined for unknown track', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    expect(mgr.getById('nonexistent')).toBeUndefined();
  });

  it('setAll sets tracks and indexes by id and layer', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const tracks: CompositorTrack[] = [
      { id: 't1', layer: 0, container: {} as any },
      { id: 't2', layer: 1, container: {} as any },
    ];
    mgr.setAll(tracks);
    expect(mgr.all).toHaveLength(2);
    expect(mgr.getById('t1')).toBe(tracks[0]);
    expect(mgr.getById('t2')).toBe(tracks[1]);
  });

  it('setById sets tracks and builds layer index', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const map = new Map<string, CompositorTrack>([
      ['t1', { id: 't1', layer: 1, container: {} as any }],
      ['t2', { id: 't2', layer: 0, container: {} as any }],
    ]);
    mgr.setById(map);
    expect(mgr.all).toHaveLength(2);
    // Should be sorted by layer
    expect(mgr.all[0]!.layer).toBe(0);
    expect(mgr.all[1]!.layer).toBe(1);
  });

  it('getForClip returns track by trackId first', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const track = { id: 't1', layer: 0, container: {} as any } as CompositorTrack;
    mgr.setAll([track]);
    expect(mgr.getForClip({ trackId: 't1', layer: 5 })).toBe(track);
  });

  it('getForClip falls back to layer when trackId not found', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const track = { id: 't1', layer: 3, container: {} as any } as CompositorTrack;
    mgr.setAll([track]);
    expect(mgr.getForClip({ trackId: 'unknown', layer: 3 })).toBe(track);
  });

  it('getForClip returns null when neither trackId nor layer matches', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    mgr.setAll([{ id: 't1', layer: 0, container: {} as any } as CompositorTrack]);
    expect(mgr.getForClip({ trackId: 'unknown', layer: 99 })).toBeNull();
  });

  it('getForClip uses layer only when trackId is undefined', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const track = { id: 't1', layer: 2, container: {} as any } as CompositorTrack;
    mgr.setAll([track]);
    expect(mgr.getForClip({ trackId: undefined, layer: 2 })).toBe(track);
  });

  it('sync creates new track containers and adds them to stage', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const app = makeMockApp();
    mgr.sync(
      [
        { kind: 'track', id: 't1', layer: 0, opacity: 0.5, blendMode: 'normal' },
        { kind: 'track', id: 't2', layer: 1, opacity: 1, blendMode: 'add' },
      ],
      app,
    );
    expect(mgr.all).toHaveLength(2);
    expect(app.stage.addChild).toHaveBeenCalledTimes(2);
    expect(mgr.getById('t1')!.opacity).toBe(0.5);
    expect(mgr.getById('t2')!.blendMode).toBe('add');
  });

  it('sync reuses existing tracks', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const app = makeMockApp();
    // First sync
    mgr.sync([{ kind: 'track', id: 't1', layer: 0, opacity: 0.5 }], app);
    const originalTrack = mgr.getById('t1');

    // Second sync with same track
    mgr.sync([{ kind: 'track', id: 't1', layer: 0, opacity: 0.8 }], app);
    expect(mgr.getById('t1')).toBe(originalTrack);
    expect(mgr.getById('t1')!.opacity).toBe(0.8);
  });

  it('sync disposes removed tracks', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const app = makeMockApp();
    mgr.sync([{ kind: 'track', id: 't1', layer: 0 }], app);
    expect(mgr.all).toHaveLength(1);

    // Sync without t1
    mgr.sync([{ kind: 'track', id: 't2', layer: 1 }], app);
    expect(mgr.getById('t1')).toBeUndefined();
    expect(mgr.all).toHaveLength(1);
  });

  it('sync is a no-op when app is null', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    mgr.sync([{ kind: 'track', id: 't1', layer: 0 }], null);
    expect(mgr.all).toHaveLength(0);
  });

  it('clear removes all tracks and destroys containers', () => {
    const mgr = new TrackRuntimeManager({ toVideoEffects });
    const app = makeMockApp();
    mgr.sync([{ kind: 'track', id: 't1', layer: 0 }], app);
    expect(mgr.all).toHaveLength(1);

    mgr.clear();
    expect(mgr.all).toHaveLength(0);
    expect(mgr.getById('t1')).toBeUndefined();
  });
});
