export const createBasicProjectSettingsFixture = () => ({
  project: {
    width: 1920,
    height: 1080,
    fps: 30,
    audioSampleRate: 48000,
    audioChannels: 2,
  },
  export: {
    format: 'mp4',
    videoCodec: 'h264',
    videoBitrate: 10000,
    audioCodec: 'aac',
    audioBitrate: 192,
  },
});
