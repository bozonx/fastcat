export interface DecodeRequest {
  type: 'decode' | 'extract-peaks';
  id: number;
  sourceKey: string;
  arrayBuffer: ArrayBuffer;
  options?: {
    maxLength?: number;
    precision?: number;
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
  };
}
