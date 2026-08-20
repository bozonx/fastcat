import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';

describe('Native Monitor Smoke (P2)', () => {
  it('executes monitor IPC lifecycle commands and handles state transitions cleanly', async () => {
    // 1. Set mode to canvas and verify successful return
    const setModeResult = await invokeTauri('monitor_set_mode', { mode: 'canvas' });
    expect(setModeResult).toBeNull();

    // 2. Set canvas size
    const setCanvasSizeResult = await invokeTauri('monitor_set_canvas_size', {
      width: 1280,
      height: 720,
    });
    expect(setCanvasSizeResult).toBeNull();

    // 3. Set monitor scene
    const emptyScene = {
      layers: [],
      audio_layers: [],
      width: 1280,
      height: 720,
    };
    const setSceneResult = await invokeTauri('monitor_set_scene', { scene: emptyScene });
    expect(setSceneResult).toBeNull();

    // 4. Seek transport
    const seekResult = await invokeTauri('monitor_seek', {
      timeSec: 1.5,
      explicit: true,
    });
    expect(seekResult).toBeNull();

    // 5. Pause transport
    const pauseResult = await invokeTauri('monitor_pause');
    expect(pauseResult).toBeNull();

    // 6. Close / graceful pause monitor
    const closeResult = await invokeTauri('monitor_close');
    expect(closeResult).toBeNull();
  });
});
