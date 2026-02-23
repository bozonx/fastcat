export interface AudioEngineClip {
  id: string;
  fileHandle: FileSystemFileHandle;
  startUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceDurationUs: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decodedCache = new Map<string, AudioBuffer | null>();
  private activeNodes = new Map<string, AudioBufferSourceNode>();
  private masterGain: GainNode | null = null;
  private isPlaying = false;
  private baseTimeS = 0;
  private playbackContextTimeS = 0;
  private currentClips: AudioEngineClip[] = [];

  constructor() {}

  async init() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  async loadClips(clips: AudioEngineClip[]) {
    this.currentClips = clips;

    // Prefetch and decode audio data
    for (const clip of clips) {
      const sourceKey = await this.getCacheKey(clip.fileHandle);
      if (!this.decodedCache.has(sourceKey)) {
        this.decodedCache.set(sourceKey, null); // mark as loading
        try {
          const file = await clip.fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          if (this.ctx) {
            const decoded = await this.ctx.decodeAudioData(arrayBuffer);
            this.decodedCache.set(sourceKey, decoded);
          }
        } catch (err) {
          console.warn('[AudioEngine] Failed to decode audio', err);
        }
      }
    }
  }

  updateTimelineLayout(clips: AudioEngineClip[]) {
    this.currentClips = clips;
    if (this.isPlaying) {
      // Re-evaluate playing nodes
      const currentTimeS = this.getCurrentTimeS();
      this.stopAllNodes();
      this.play(currentTimeS);
    }
  }

  private async getCacheKey(fileHandle: FileSystemFileHandle) {
    const file = await fileHandle.getFile();
    // Use path or a combination of name and lastModified as key
    return `${file.name}_${file.lastModified}`;
  }

  async play(timeUs: number) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    
    this.isPlaying = true;
    const timeS = timeUs / 1_000_000;
    this.baseTimeS = timeS;
    this.playbackContextTimeS = this.ctx.currentTime;

    for (const clip of this.currentClips) {
      this.scheduleClip(clip, timeS);
    }
  }

  stop() {
    this.isPlaying = false;
    this.stopAllNodes();
  }

  seek(timeUs: number) {
    if (this.isPlaying) {
      this.stopAllNodes();
      this.play(timeUs);
    }
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  getCurrentTimeS(): number {
    if (!this.isPlaying || !this.ctx) return this.baseTimeS;
    return this.baseTimeS + (this.ctx.currentTime - this.playbackContextTimeS);
  }

  private async scheduleClip(clip: AudioEngineClip, currentTimeS: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const sourceKey = await this.getCacheKey(clip.fileHandle);
    const buffer = this.decodedCache.get(sourceKey);
    if (!buffer) return;

    const clipStartS = clip.startUs / 1_000_000;
    const clipDurationS = clip.durationUs / 1_000_000;
    const clipEndS = clipStartS + clipDurationS;
    
    // If the clip is already completely in the past relative to current time, skip
    if (clipEndS <= currentTimeS) return;

    const sourceStartS = clip.sourceStartUs / 1_000_000;
    
    let playStartS = 0; // When to start playing in AudioContext time
    let bufferOffsetS = 0; // Where to start in the audio buffer

    if (currentTimeS < clipStartS) {
      // Clip is in the future
      playStartS = this.ctx.currentTime + (clipStartS - currentTimeS);
      bufferOffsetS = sourceStartS;
    } else {
      // Clip is currently playing
      playStartS = this.ctx.currentTime;
      bufferOffsetS = sourceStartS + (currentTimeS - clipStartS);
    }

    const durationToPlayS = clipDurationS - (bufferOffsetS - sourceStartS);
    if (durationToPlayS <= 0) return;

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(this.masterGain);
    
    sourceNode.start(playStartS, bufferOffsetS, durationToPlayS);
    
    // Keep track to stop if needed
    // Using a composite key since a clip might be split or repeated (id should be unique though)
    this.activeNodes.set(clip.id, sourceNode);
    
    sourceNode.onended = () => {
      if (this.activeNodes.get(clip.id) === sourceNode) {
        this.activeNodes.delete(clip.id);
      }
    };
  }

  private stopAllNodes() {
    for (const [id, node] of this.activeNodes.entries()) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // ignore errors if already stopped
      }
    }
    this.activeNodes.clear();
  }

  destroy() {
    this.stopAllNodes();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.decodedCache.clear();
  }
}
