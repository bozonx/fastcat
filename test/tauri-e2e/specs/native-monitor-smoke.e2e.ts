import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';

describe('Native Monitor Smoke (P2)', () => {
  it('executes monitor IPC lifecycle commands without throwing or crashing', async () => {
    // 1. Set mode to canvas
    const setModeResult = await invokeTauri('monitor_set_mode', { mode: 'canvas' });
    expect(setModeResult == null).toBe(true);

    // 2. Set canvas size
    const setCanvasSizeResult = await invokeTauri('monitor_set_canvas_size', {
      width: 640,
      height: 360,
    });
    expect(setCanvasSizeResult == null).toBe(true);

    // 3. Set monitor scene
    const emptyScene = {
      layers: [],
      audio_layers: [],
      width: 640,
      height: 360,
    };
    const setSceneResult = await invokeTauri('monitor_set_scene', { scene: emptyScene });
    expect(setSceneResult == null).toBe(true);

    // 4. Seek transport
    const seekResult = await invokeTauri('monitor_seek', {
      timeSec: 0.0,
      explicit: true,
    });
    expect(seekResult == null).toBe(true);

    // 5. Pause transport
    const pauseResult = await invokeTauri('monitor_pause');
    expect(pauseResult == null).toBe(true);

    // 6. Close / graceful pause monitor
    const closeResult = await invokeTauri('monitor_close');
    expect(closeResult == null).toBe(true);
  });
});
