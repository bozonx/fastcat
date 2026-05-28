import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipMetadata from '~/components/timeline/ClipMetadata.vue';

describe('ClipMetadata', () => {
  const track = { kind: 'video' } as any;
  const item = { kind: 'clip', id: 'c1' } as any;

  it('renders missing media overlay', async () => {
    const component = await mountSuspended(ClipMetadata, {
      props: { item, track, isMediaMissing: true, clipWidthPx: 100 },
    });

    expect(component.html()).toContain('bg-red-600');
  });

  it('renders muted icon', async () => {
    const mutedItem = { kind: 'clip', id: 'c1', audioMuted: true } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: mutedItem, track, clipWidthPx: 100 },
    });

    expect(component.html()).toContain('bg-black');
  });

  it('renders disabled icon', async () => {
    const disabledItem = { kind: 'clip', id: 'c1', disabled: true } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: disabledItem, track, clipWidthPx: 100 },
    });

    expect(component.html()).toContain('bg-black');
  });

  it('prioritizes disabled icon over muted icon when both are true', async () => {
    const disabledAndMutedItem = { kind: 'clip', id: 'c1', disabled: true, audioMuted: true } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: disabledAndMutedItem, track, clipWidthPx: 100 },
    });

    expect(component.html()).toContain('w-4 h-4');
    expect(component.html()).not.toContain('w-6 h-6');
  });
});
