import type { Page } from '@playwright/test';
import { getOpfsFileMetadata, opfsEntryExists, readTextFileFromOpfs } from './virtual-fs';
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
  id: string;
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
  /** Audio properties persisted on the clip, when present. */
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: string;
  audioFadeOutCurve?: string;
  audioMuted?: boolean;
  /** Edge transitions persisted on the clip metadata, when present. */
  transitionIn?: TimelineTransitionView;
  transitionOut?: TimelineTransitionView;
  /** Clip effects persisted as OTIO Effect metadata. */
  effects: TimelineEffectView[];
}

export interface TimelineTransitionView {
  type: string;
  durationUs: number;
  mode?: string;
  curve?: string;
  params?: Record<string, unknown>;
}

export interface TimelineEffectView {
  id: string;
  type: string;
  enabled: boolean;
  target?: string;
  params: Record<string, unknown>;
}

export interface TimelineTrackView {
  id: string;
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
  /** Timeline-level markers persisted as OTIO markers on the stack. */
  markers: TimelineMarkerView[];
}

export interface TimelineMarkerView {
  id: string;
  timeUs: number;
  durationUs?: number;
  text: string;
  color?: string;
}

interface RawRational {
  value?: number;
  rate?: number;
}
interface RawRange {
  start_time?: RawRational;
  duration?: RawRational;
}
interface RawTransition {
  type?: string;
  durationUs?: number;
  mode?: string;
  curve?: string;
  params?: Record<string, unknown>;
}
interface RawChild {
  OTIO_SCHEMA?: string;
  name?: string;
  metadata?: {
    fastcat?: {
      id?: string;
      audio?: {
        gain?: number;
        balance?: number;
        fadeInUs?: number;
        fadeOutUs?: number;
        fadeInCurve?: string;
        fadeOutCurve?: string;
        muted?: boolean;
      };
      transitions?: {
        in?: RawTransition;
        out?: RawTransition;
      };
    };
  };
  source_range?: RawRange;
  media_reference?: { OTIO_SCHEMA?: string; target_url?: string };
  effects?: RawEffect[];
}
interface RawEffect {
  OTIO_SCHEMA?: string;
  name?: string;
  effect_name?: string;
  enabled?: boolean;
  metadata?: {
    fastcat?: {
      effect?: {
        id?: string;
        type?: string;
        target?: string;
        params?: Record<string, unknown>;
      };
    };
  };
}
interface RawTrack {
  OTIO_SCHEMA?: string;
  name?: string;
  kind?: string;
  metadata?: { fastcat?: { id?: string } };
  children?: RawChild[];
}
interface RawTimeline {
  OTIO_SCHEMA?: string;
  name?: string;
  tracks?: { children?: RawTrack[]; markers?: RawMarker[] };
  markers?: RawMarker[];
}
interface RawMarker {
  OTIO_SCHEMA?: string;
  name?: string;
  comment?: string;
  marked_range?: RawRange;
  metadata?: {
    fastcat?: {
      marker?: {
        id?: string;
        color?: string;
      };
    };
  };
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

function parseEffects(raw: RawEffect[] | undefined): TimelineEffectView[] {
  return (raw ?? [])
    .filter((effect) => effect.OTIO_SCHEMA === 'Effect.1')
    .map((effect) => {
      const metadata = effect.metadata?.fastcat?.effect;
      const type =
        metadata?.type ??
        (typeof effect.effect_name === 'string'
          ? effect.effect_name.replace(/^fastcat:/, '')
          : (effect.name ?? ''));

      return {
        id: metadata?.id ?? effect.name ?? '',
        type,
        enabled: effect.enabled !== false,
        target: metadata?.target,
        params: metadata?.params ?? {},
      };
    })
    .filter((effect) => effect.id.length > 0 && effect.type.length > 0);
}

function parseTransition(raw: RawTransition | undefined): TimelineTransitionView | undefined {
  if (!raw || typeof raw.type !== 'string' || raw.type.length === 0) return undefined;
  return {
    type: raw.type,
    durationUs: typeof raw.durationUs === 'number' ? raw.durationUs : 0,
    mode: raw.mode,
    curve: raw.curve,
    params: raw.params,
  };
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

    const fastcatAudio = child.metadata?.fastcat?.audio;
    items.push({
      id: child.metadata?.fastcat?.id ?? '',
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
      audioGain: fastcatAudio?.gain,
      audioBalance: fastcatAudio?.balance,
      audioFadeInUs: fastcatAudio?.fadeInUs,
      audioFadeOutUs: fastcatAudio?.fadeOutUs,
      audioFadeInCurve: fastcatAudio?.fadeInCurve,
      audioFadeOutCurve: fastcatAudio?.fadeOutCurve,
      audioMuted: fastcatAudio?.muted,
      transitionIn: parseTransition(child.metadata?.fastcat?.transitions?.in),
      transitionOut: parseTransition(child.metadata?.fastcat?.transitions?.out),
      effects: parseEffects(child.effects),
    });

    cursorUs += timelineDurationUs;
  }

  const kind = raw.kind === 'Audio' ? 'Audio' : 'Video';
  return {
    id: raw.metadata?.fastcat?.id ?? '',
    name: raw.name ?? '',
    kind,
    items,
    clips: items.filter((i) => i.type === 'clip'),
  };
}

function parseMarkers(raw: RawMarker[] | undefined): TimelineMarkerView[] {
  return (raw ?? [])
    .filter((marker) => marker.OTIO_SCHEMA === 'Marker.2' || marker.OTIO_SCHEMA === 'Marker.1')
    .map((marker) => {
      const range = marker.marked_range;
      const durationUs = rationalToUs(range?.duration);
      return {
        id: marker.metadata?.fastcat?.marker?.id ?? '',
        timeUs: rationalToUs(range?.start_time),
        ...(durationUs > 0 ? { durationUs } : {}),
        text: marker.comment || marker.name || '',
        color: marker.metadata?.fastcat?.marker?.color,
      };
    })
    .filter((marker) => marker.id.length > 0)
    .sort((a, b) => a.timeUs - b.timeUs);
}

export function parseTimelineDoc(json: string): TimelineDocView {
  const raw = JSON.parse(json) as RawTimeline;
  const tracks = (raw.tracks?.children ?? []).map(parseTrack);
  const markerSource =
    raw.tracks?.markers && raw.tracks.markers.length > 0 ? raw.tracks.markers : raw.markers;
  return {
    name: raw.name ?? '',
    tracks,
    videoTracks: tracks.filter((t) => t.kind === 'Video'),
    audioTracks: tracks.filter((t) => t.kind === 'Audio'),
    allClips: tracks.flatMap((t) => t.clips),
    markers: parseMarkers(markerSource),
  };
}

function autosavePathFor(project: E2eProject): string {
  const projectRoot = `${project.path}/`;
  const timelinePath = project.timelinePath.startsWith(projectRoot)
    ? project.timelinePath.slice(projectRoot.length)
    : project.timelinePath;

  return `${project.path}/.fastcat/autosave/${timelinePath}`;
}

async function readLatestTimelineText(page: Page, project: E2eProject): Promise<string> {
  const autosavePath = autosavePathFor(project);
  const [mainMeta, autosaveMeta] = await Promise.all([
    getOpfsFileMetadata(page, project.timelinePath),
    getOpfsFileMetadata(page, autosavePath),
  ]);

  if (autosaveMeta && (!mainMeta || autosaveMeta.lastModified >= mainMeta.lastModified)) {
    return await readTextFileFromOpfs(page, autosavePath);
  }

  return await readTextFileFromOpfs(page, project.timelinePath);
}

async function readTimelineDocCandidates(
  page: Page,
  project: E2eProject,
): Promise<TimelineDocView[]> {
  const paths = [project.timelinePath, autosavePathFor(project)];
  const docs: TimelineDocView[] = [];

  for (const path of paths) {
    if (!(await opfsEntryExists(page, path))) continue;
    docs.push(parseTimelineDoc(await readTextFileFromOpfs(page, path)));
  }

  return docs;
}

/** Reads and parses the project's latest persisted timeline state from OPFS. */
export async function readTimelineDoc(page: Page, project: E2eProject): Promise<TimelineDocView> {
  const json = await readLatestTimelineText(page, project);
  return parseTimelineDoc(json);
}

/**
 * Polls the persisted timeline until `predicate` holds — use after a UI edit to
 * wait for the app's debounced autosave to flush, so assertions read a settled
 * document rather than racing the save.
 *
 * Checks the *latest* timeline state (the file that would actually be restored
 * on reload — autosave if newer, otherwise the main file) rather than any
 * candidate, so the predicate must hold for the state the user would see.
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
      const doc = await readTimelineDoc(page, project);
      last = doc;
      if (predicate(doc)) return doc;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `waitForTimelineDoc timed out after ${timeout}ms. ` +
      `Last clips: ${last ? JSON.stringify(last.allClips) : 'unavailable'}. ` +
      `Last markers: ${last ? JSON.stringify(last.markers) : 'unavailable'}. ` +
      `Last error: ${String(lastError)}`,
  );
}

/** Convenience: total number of clips across all tracks in the persisted doc. */
export async function persistedClipCount(page: Page, project: E2eProject): Promise<number> {
  return (await readTimelineDoc(page, project)).allClips.length;
}
