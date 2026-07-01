import type { Page } from '@playwright/test';
import { opfsEntryExists, readTextFileFromOpfs } from './virtual-fs';
import type { E2eProject } from '../../e2e/fixtures/workspace';

/**
 * Reads the *persisted* OTIO timeline document straight from OPFS and exposes a
 * flattened, assertion-friendly view of it.
 *
 * This is what keeps the web specs honest end-to-end tests rather than
 * re-implemented unit tests: instead of poking at Vue store internals, a spec
 * drives the real UI, lets the app serialize through its normal save path, and
 * then verifies the ground-truth `.otio` file the user would actually reopen.
 *
 * OTIO tracks are *sequential* — a child's timeline position is the sum of the
 * durations of its preceding siblings. We compute that here so callers can
 * assert on timeline start/duration without depending on fastcat-private
 * roundtrip metadata.
 */

export type OtioItemType = 'clip' | 'gap' | 'transition';

export interface TimelineItemView {
  type: OtioItemType;
  name: string;
  /** In/out point into the source media (microseconds). */
  sourceStartUs: number;
  sourceDurationUs: number;
  /** Position on the timeline, derived positionally (microseconds). */
  timelineStartUs: number;
  timelineDurationUs: number;
  /** Media URL for clips (undefined for gaps / missing references). */
  targetUrl?: string;
}

export interface TimelineTrackView {
  name: string;
  kind: 'Video' | 'Audio';
  items: TimelineItemView[];
  clips: TimelineItemView[];
}

export interface TimelineDocView {
  name: string;
  tracks: TimelineTrackView[];
  videoTracks: TimelineTrackView[];
  audioTracks: TimelineTrackView[];
  /** Every clip across every track, in track order. */
  allClips: TimelineItemView[];
}

interface RawRational {
  value?: number;
  rate?: number;
}
interface RawRange {
  start_time?: RawRational;
  duration?: RawRational;
}
interface RawChild {
  OTIO_SCHEMA?: string;
  name?: string;
  source_range?: RawRange;
  media_reference?: { OTIO_SCHEMA?: string; target_url?: string };
}
interface RawTrack {
  OTIO_SCHEMA?: string;
  name?: string;
  kind?: string;
  children?: RawChild[];
}
interface RawTimeline {
  OTIO_SCHEMA?: string;
  name?: string;
  tracks?: { children?: RawTrack[] };
}

function rationalToUs(r: RawRational | undefined): number {
  if (!r || typeof r.value !== 'number' || typeof r.rate !== 'number' || r.rate === 0) return 0;
  return Math.round((r.value / r.rate) * 1e6);
}

function classify(schema: string | undefined): OtioItemType {
  if (schema?.startsWith('Gap')) return 'gap';
  if (schema?.startsWith('Transition')) return 'transition';
  return 'clip';
}

function parseTrack(raw: RawTrack): TimelineTrackView {
  const items: TimelineItemView[] = [];
  let cursorUs = 0;

  for (const child of raw.children ?? []) {
    const type = classify(child.OTIO_SCHEMA);
    const sourceStartUs = rationalToUs(child.source_range?.start_time);
    const durationUs = rationalToUs(child.source_range?.duration);

    // Transitions overlap their neighbours and do not advance the cursor; base
    // specs don't create them, but we stay correct if one slips in.
    const timelineDurationUs = type === 'transition' ? 0 : durationUs;

    items.push({
      type,
      name: child.name ?? '',
      sourceStartUs,
      sourceDurationUs: durationUs,
      timelineStartUs: cursorUs,
      timelineDurationUs,
      targetUrl:
        child.media_reference?.OTIO_SCHEMA?.startsWith('ExternalReference') === true
          ? child.media_reference?.target_url
          : undefined,
    });

    cursorUs += timelineDurationUs;
  }

  const kind = raw.kind === 'Audio' ? 'Audio' : 'Video';
  return {
    name: raw.name ?? '',
    kind,
    items,
    clips: items.filter((i) => i.type === 'clip'),
  };
}

export function parseTimelineDoc(json: string): TimelineDocView {
  const raw = JSON.parse(json) as RawTimeline;
  const tracks = (raw.tracks?.children ?? []).map(parseTrack);
  return {
    name: raw.name ?? '',
    tracks,
    videoTracks: tracks.filter((t) => t.kind === 'Video'),
    audioTracks: tracks.filter((t) => t.kind === 'Audio'),
    allClips: tracks.flatMap((t) => t.clips),
  };
}

/** Reads and parses the project's persisted timeline from OPFS. */
export async function readTimelineDoc(page: Page, project: E2eProject): Promise<TimelineDocView> {
  const json = await readTextFileFromOpfs(page, project.timelinePath);
  return parseTimelineDoc(json);
}

/**
 * Polls the persisted timeline until `predicate` holds — use after a UI edit to
 * wait for the app's debounced autosave to flush, so assertions read a settled
 * document rather than racing the save.
 */
export async function waitForTimelineDoc(
  page: Page,
  project: E2eProject,
  predicate: (doc: TimelineDocView) => boolean,
  options: { timeout?: number; intervalMs?: number } = {},
): Promise<TimelineDocView> {
  const { timeout = 10_000, intervalMs = 150 } = options;
  const deadline = Date.now() + timeout;
  let last: TimelineDocView | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      if (await opfsEntryExists(page, project.timelinePath)) {
        last = await readTimelineDoc(page, project);
        if (predicate(last)) return last;
      }
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `waitForTimelineDoc timed out after ${timeout}ms. ` +
      `Last document: ${last ? JSON.stringify(last.allClips) : 'unavailable'}. ` +
      `Last error: ${String(lastError)}`,
  );
}

/** Convenience: total number of clips across all tracks in the persisted doc. */
export async function persistedClipCount(page: Page, project: E2eProject): Promise<number> {
  return (await readTimelineDoc(page, project)).allClips.length;
}
