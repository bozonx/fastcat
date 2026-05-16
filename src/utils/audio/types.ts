export interface DecodeRequest {
  type: 'decode' | 'extract-peaks' | 'decode-stt' | 'decode-range';
  id: number;
  sourceKey: string;
  arrayBuffer?: ArrayBuffer;
  blob?: Blob;
  startTimeS?: number;
  durationS?: number;
  options?: {
    maxLength?: number;
    precision?: number;
    targetSampleRate?: number; // For decode-stt
  };
}

export interface DecodeResponse {
  type: 'decode-result';
  id: number;
  ok: boolean;
  error?: { name?: string; message: string; stack?: string };
  result?: {
    sampleRate: number;
    numberOfChannels: number;
    channelBuffers: ArrayBuffer[];
    peaks?: number[][];
    sttAudio?: Float32Array; // Single mono buffer for Whisper
    startTimeS?: number;
    actualStartTimeS?: number;
    durationS?: number;
    totalFrames?: number;
  };
}
