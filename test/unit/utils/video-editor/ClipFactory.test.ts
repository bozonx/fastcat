import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipFactory } from '~/utils/video-editor/compositor/ClipFactory';

vi.mock('pixi.js', () => {
  class MockSprite {
    visible = true;
    width = 0;
    height = 0;
    texture = { source: {} };
    constructor(texture?: any) {
      this.texture = texture || { source: {} };
    }
  }

  class MockGraphics extends MockSprite {
    constructor() {
      super();
    }
  }

  class MockTexture {
    static WHITE = new MockTexture();
    static EMPTY = new MockTexture();
    static from = vi.fn(() => new MockTexture());
    source = {};
    constructor(opts?: any) {
      if (opts?.source) this.source = (opts as any).source;
    }
  }

  class MockImageSource {
    constructor(opts?: any) {}
  }

  class MockCanvasSource {
    constructor(opts?: any) {}
  }

  return {
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Texture: MockTexture,
    ImageSource: MockImageSource,
    CanvasSource: MockCanvasSource,
  };
});

// Mock OffscreenCanvas
vi.stubGlobal('OffscreenCanvas', class {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(type: string) {
    return {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
  }
});

describe('ClipFactory', () => {
  const mockLayoutApplier = {
    applySolidLayout: vi.fn(),
    applyShapeLayout: vi.fn(),
  };

  const context = {
    width: 1920,
    height: 1080,
    layoutApplier: mockLayoutApplier as any,
  };

  const factory = new ClipFactory(context);

  const baseParams = {
    itemId: 'item-1',
    layer: 1,
    startUs: 0,
    endUs: 1_000_000,
    durationUs: 1_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 1_000_000,
    sourceDurationUs: 1_000_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a solid clip', () => {
    const clip = factory.createSolidClip({
      ...baseParams,
      backgroundColor: '#ff0000',
      clipType: 'background',
    });

    expect(clip.itemId).toBe('item-1');
    expect(clip.backgroundColor).toBe('#ff0000');
    expect(clip.clipKind).toBe('solid');
    expect(mockLayoutApplier.applySolidLayout).toHaveBeenCalledWith(clip);
  });

  it('creates a text clip', () => {
    const clip = factory.createTextClip({
      ...baseParams,
      text: 'Hello World',
      style: { fontSize: 24 } as any,
    });

    expect(clip.clipType).toBe('text');
    expect(clip.text).toBe('Hello World');
    expect(clip.style.fontSize).toBe(24);
  });

  it('creates a shape clip', () => {
    const clip = factory.createShapeClip({
      ...baseParams,
      shapeType: 'rectangle',
      fillColor: '#00ff00',
      strokeColor: '#000000',
      strokeWidth: 2,
    });

    expect(clip.clipType).toBe('shape');
    expect(clip.shapeType).toBe('rectangle');
    expect(mockLayoutApplier.applyShapeLayout).toHaveBeenCalledWith(clip);
  });

  it('creates a hud clip', () => {
    const clip = factory.createHudClip({
      ...baseParams,
      hudType: 'countdown',
      background: {} as any,
      content: {} as any,
      frame: {} as any,
    });

    expect(clip.clipType).toBe('hud');
    expect(clip.hudType).toBe('countdown');
    expect(clip.ctx).toBeDefined();
  });

  it('creates a video clip', () => {
    const clip = factory.createVideoClip({
      ...baseParams,
      sourcePath: 'video.mp4',
      fileHandle: {} as any,
      input: {} as any,
      sink: {} as any,
      imageSource: {} as any,
    });

    expect(clip.clipKind).toBe('video');
    expect(clip.sourcePath).toBe('video.mp4');
  });
});
