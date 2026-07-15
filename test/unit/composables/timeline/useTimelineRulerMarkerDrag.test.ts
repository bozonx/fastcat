/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createTestingPinia } from '@pinia/testing';
import { useTimelineRulerMarkerDrag } from '~/composables/timeline/useTimelineRulerMarkerDrag';
import { timelineUs } from '../../utils/timeline-time';

type Marker = { id: string; timeUs: number; durationUs?: number };

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
});

function setupDrag(markersData: Marker[], selectedIds: string[]) {
  const updateMarker = vi.fn();
  const selectMarker = vi.fn();
  const markers = ref<Marker[]>(markersData);
  let api!: ReturnType<typeof useTimelineRulerMarkerDrag>;

  const Comp = defineComponent({
    setup() {
      api = useTimelineRulerMarkerDrag({
        markers,
        zoom: ref(50),
        fps: ref(30),
        selectMarker,
        updateMarker,
        getSelectedMarkerIds: () => selectedIds,
        snapThresholdPx: ref(8),
        // Keep snapping off so the geometry stays deterministic.
        isSnappingEnabled: ref(false),
        scrollLeft: ref(0),
        getTimeUsFromPointerEvent: () => 0,
      });
      return () => h('div');
    },
  });

  activeWrapper = mount(Comp, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] },
  });

  return { api, updateMarker, selectMarker, markers };
}

function pointerEvent(type: string, clientX: number): PointerEvent {
  return new MouseEvent(type, { clientX, clientY: 0, button: 0, bubbles: true }) as PointerEvent;
}

function displayed(api: ReturnType<typeof useTimelineRulerMarkerDrag>, id: string) {
  return api.displayMarkers.value.find((m) => m.id === id)!;
}

describe('useTimelineRulerMarkerDrag', () => {
  it('selects the marker on pointer down', () => {
    const { api, selectMarker } = setupDrag([{ id: 'a', timeUs: timelineUs(1_000_000) }], ['a']);
    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'a', 'left');
    expect(selectMarker).toHaveBeenCalledWith('a', expect.any(Object));
  });

  it('moves a point marker and commits the new time on release', () => {
    const { api, updateMarker } = setupDrag([{ id: 'a', timeUs: timelineUs(1_000_000) }], ['a']);

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'a', 'left');
    window.dispatchEvent(pointerEvent('pointermove', 400));

    const dm = displayed(api, 'a');
    expect(dm.timeUs).toBeGreaterThan(timelineUs(1_000_000));
    expect(api.hasDragged.value).toBe(true);

    window.dispatchEvent(pointerEvent('pointerup', 400));
    expect(updateMarker).toHaveBeenCalledWith('a', expect.objectContaining({ timeUs: dm.timeUs }));
  });

  it('moves a whole zone with part="move", preserving its duration', () => {
    const { api, updateMarker } = setupDrag(
      [{ id: 'z', timeUs: timelineUs(1_000_000), durationUs: timelineUs(2_000_000) }],
      ['z'],
    );

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'z', 'move');
    window.dispatchEvent(pointerEvent('pointermove', 400));

    const dm = displayed(api, 'z');
    expect(dm.timeUs).toBeGreaterThan(timelineUs(1_000_000));
    expect(dm.durationUs).toBe(timelineUs(2_000_000));

    window.dispatchEvent(pointerEvent('pointerup', 400));
    expect(updateMarker).toHaveBeenCalledWith(
      'z',
      expect.objectContaining({ durationUs: timelineUs(2_000_000) }),
    );
  });

  it('resizes the left edge of a zone (part="left") keeping the end fixed', () => {
    const { api } = setupDrag(
      [{ id: 'z', timeUs: timelineUs(1_000_000), durationUs: timelineUs(2_000_000) }],
      ['z'],
    );
    const endUs = timelineUs(3_000_000);

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'z', 'left');
    window.dispatchEvent(pointerEvent('pointermove', 300));

    const dm = displayed(api, 'z');
    expect(dm.timeUs).toBeGreaterThan(timelineUs(1_000_000));
    expect(dm.durationUs).toBeLessThan(timelineUs(2_000_000));
    // The right edge must not move when dragging the left handle.
    expect(dm.timeUs + (dm.durationUs ?? 0)).toBe(endUs);

    window.dispatchEvent(pointerEvent('pointerup', 300));
  });

  it('resizes the right edge of a zone (part="right") keeping the start fixed', () => {
    const { api } = setupDrag(
      [{ id: 'z', timeUs: timelineUs(1_000_000), durationUs: timelineUs(2_000_000) }],
      ['z'],
    );

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'z', 'right');
    window.dispatchEvent(pointerEvent('pointermove', 400));

    const dm = displayed(api, 'z');
    expect(dm.timeUs).toBe(timelineUs(1_000_000));
    expect(dm.durationUs).toBeGreaterThan(timelineUs(2_000_000));

    window.dispatchEvent(pointerEvent('pointerup', 400));
  });

  it('moves non-lead markers as a whole even when the lead resizes', () => {
    const { api } = setupDrag(
      [
        { id: 'lead', timeUs: timelineUs(1_000_000), durationUs: timelineUs(2_000_000) },
        { id: 'other', timeUs: timelineUs(5_000_000), durationUs: timelineUs(1_000_000) },
      ],
      ['lead', 'other'],
    );

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'lead', 'left');
    window.dispatchEvent(pointerEvent('pointermove', 300));

    const lead = displayed(api, 'lead');
    const other = displayed(api, 'other');

    // Lead resizes from the left (end fixed); the other zone moves whole.
    expect(lead.durationUs).toBeLessThan(timelineUs(2_000_000));
    expect(other.durationUs).toBe(timelineUs(1_000_000));
    expect(other.timeUs).toBeGreaterThan(timelineUs(5_000_000));

    window.dispatchEvent(pointerEvent('pointerup', 300));
  });

  it('cancels the drag gesture and resets state on pointercancel', () => {
    const { api, updateMarker } = setupDrag([{ id: 'a', timeUs: timelineUs(1_000_000) }], ['a']);

    api.onMarkerPointerDown(pointerEvent('pointerdown', 100), 'a', 'left');
    window.dispatchEvent(pointerEvent('pointermove', 400));

    expect(api.draggedMarkerId.value).toBe('a');
    expect(api.hasDragged.value).toBe(true);

    window.dispatchEvent(pointerEvent('pointercancel', 400));

    expect(api.draggedMarkerId.value).toBeNull();
    expect(api.draggedMarkerIds.value).toHaveLength(0);
    expect(updateMarker).toHaveBeenCalled(); // Since pointercancel maps to pointerup handler in our implementation
  });
});
