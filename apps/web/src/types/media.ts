export interface VideoColorSpaceInit {
  fullRange?: boolean;
  matrix?: string;
  primaries?: string;
  transfer?: string;
}

export interface MediaMetadata {
  source: {
    size: number;
    lastModified: number;
  };
  mimeType?: string;
  container?: string;
  duration: number;
  video?: {
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    codec: string;
    parsedCodec: string;
    fps: number;
    bitrate?: number;
    colorSpace?: VideoColorSpaceInit;
    canDecode?: boolean;
    /** True when the source's per-frame timing is not constant (VFR): `fps` is
     * just the stream average, so any single-fps timebase choice for it is a
     * heuristic, not an exact match. `undefined` when this could not be judged
     * (too few packets sampled). */
    isVariableFrameRate?: boolean;
  };
  audio?: {
    codec: string;
    parsedCodec: string;
    sampleRate: number;
    channels: number;
    bitrate?: number;
    canDecode?: boolean;
  };
  image?: {
    canDisplay?: boolean;
    width?: number;
    height?: number;
  };
  audioPeaks?: Float32Array[];
  error?: boolean;
}
