/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useTimelineHorizontalScrollSync } from '~/composables/timeline/useTimelineHorizontalScrollSync';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';

// Mock requestAnimationFrame
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => cb(0));

describe('useTimelineHorizontalScrollSync', () => {
  let els: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    els = {
      master: ref(document.createElement('div')),
      video: ref(document.createElement('div')),
      audio: ref(document.createElement('div')),
      videoLabels: ref(document.createElement('div')),
      audioLabels: ref(document.createElement('div')),
    };

    // Set initial scroll
    els.master.value.scrollLeft = 0;
    els.video.value.scrollLeft = 0;
    els.audio.value.scrollLeft = 0;
  });

  it('scrollLeftRef tracks master scroll', () => {
    const { onMasterScroll, scrollLeftRef } = useTimelineHorizontalScrollSync(els);

    els.master.value.scrollLeft = 100;
    onMasterScroll();

    expect(scrollLeftRef.value).toBe(100);
  });

  it('syncs vertical scroll between tracks and labels', () => {
    const { onVideoScroll, onVideoLabelsScroll } = useTimelineHorizontalScrollSync(els);

    els.video.value.scrollTop = 50;
    onVideoScroll();
    expect(els.videoLabels.value.scrollTop).toBe(50);

    els.videoLabels.value.scrollTop = 70;
    onVideoLabelsScroll();
    expect(els.video.value.scrollTop).toBe(70);
  });

  it('resets scroll when scrollResetTicket changes', async () => {
    const timelineStore = useTimelineStore();
    useTimelineHorizontalScrollSync(els);

    els.master.value.scrollLeft = 100;
    timelineStore.scrollResetTicket++;

    // Watchers are async
    await Promise.resolve();

    expect(els.master.value.scrollLeft).toBe(0);
  });
});
