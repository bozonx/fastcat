/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument } from '~/timeline/types';

function makeEmptyDoc(): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [],
  };
}

describe('timeline/commands master mute', () => {
  it('updates metadata.fastcat.masterMuted', () => {
    const doc = makeEmptyDoc();

    const muted = applyTimelineCommand(doc, { type: 'update_master_muted', muted: true }).next;
    expect(muted.metadata?.fastcat?.masterMuted).toBe(true);

    const unmuted = applyTimelineCommand(muted, { type: 'update_master_muted', muted: false }).next;
    expect(unmuted.metadata?.fastcat?.masterMuted).toBe(false);
  });
});
