import { AudioSampleSink, BlobSource, Input, ALL_FORMATS } from 'mediabunny';
import { installWorkerIoBudgetListener } from '~/utils/io/io-budget-worker';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';

import { AudioDecodeEngine, copyPlanarSampleToChannelBuffers, resample } from './audio-decode-engine';
import type { DecodeRequest } from '../utils/audio/types';

installWorkerIoBudgetListener();

export { copyPlanarSampleToChannelBuffers, resample };

const engine = new AudioDecodeEngine(
  { AudioSampleSink, Input, BlobSource, ALL_FORMATS, governedBlobWorker },
  16,
  2,
);

if (typeof self !== 'undefined')
  self.addEventListener('message', async (event: MessageEvent<DecodeRequest>) => {
    const data = event.data;
    if (!data || !['decode', 'extract-peaks', 'decode-stt', 'decode-range'].includes(data.type))
      return;

    const response = await engine.handleRequest(data);

    if (response.ok && response.result) {
      const result = response.result;
      if (result.peaks && result.peaks.length > 0) {
        const transfer = result.peaks.map((ch) => ch.buffer as ArrayBuffer);
        self.postMessage(response, transfer);
        return;
      }
      if (result.sttAudio) {
        self.postMessage(response, [result.sttAudio.buffer]);
        return;
      }
      if (result.channelBuffers && result.channelBuffers.length > 0) {
        self.postMessage(response, [...result.channelBuffers]);
        return;
      }
    }

    self.postMessage(response);
  });
