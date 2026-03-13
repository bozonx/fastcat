export interface OtioRationalTime {
  OTIO_SCHEMA: 'RationalTime.1';
  value: number;
  rate: number;
}

export interface OtioTimeRange {
  OTIO_SCHEMA: 'TimeRange.1';
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

export interface OtioExternalReference {
  OTIO_SCHEMA: 'ExternalReference.1';
  target_url: string;
  available_range?: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

export interface OtioMissingReference {
  OTIO_SCHEMA: 'MissingReference.1';
  metadata?: Record<string, unknown>;
}

export type OtioMediaReference = OtioExternalReference | OtioMissingReference;

export interface OtioEffect {
  OTIO_SCHEMA: 'Effect.1';
  name: string;
  effect_name: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface OtioMarker {
  OTIO_SCHEMA: 'Marker.2';
  name: string;
  color: string;
  comment: string;
  marked_range: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

export interface OtioTransition {
  OTIO_SCHEMA: 'Transition.1';
  name: string;
  transition_type: string;
  in_offset: OtioRationalTime;
  out_offset: OtioRationalTime;
  parameters: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface OtioClip {
  OTIO_SCHEMA: 'Clip.1';
  name: string;
  media_reference: OtioMediaReference;
  source_range: OtioTimeRange;
  enabled?: boolean;
  effects?: OtioEffect[];
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

export interface OtioGap {
  OTIO_SCHEMA: 'Gap.1';
  name: string;
  source_range: OtioTimeRange;
  effects?: OtioEffect[];
  metadata?: Record<string, unknown>;
}

export type OtioTrackChild = OtioClip | OtioGap | OtioTransition;

export interface OtioTrack {
  OTIO_SCHEMA: 'Track.1';
  name: string;
  kind: 'Video' | 'Audio';
  children: OtioTrackChild[];
  effects?: OtioEffect[];
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

export interface OtioStack {
  OTIO_SCHEMA: 'Stack.1';
  name: string;
  children: OtioTrack[];
  markers?: OtioMarker[];
}

export interface OtioTimeline {
  OTIO_SCHEMA: 'Timeline.1';
  name: string;
  tracks: OtioStack;
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}
