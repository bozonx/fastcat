import {
  RendererType,
  RenderTexture,
  Sprite,
  Texture,
  type Application,
  type Container,
} from 'pixi.js';
import type { CompositorClip, CompositorTrack } from './types';

export interface StageTextureRendererContext {
  app: Application;
  width: number;
  height: number;
  getTrackById: (trackId: string) => CompositorTrack | undefined;
}

export class StageTextureRenderer {
  private transitionCombineSprite: Sprite | null = null;
  private bitmapCaptureSprite: Sprite | null = null;
  private captureTexture: RenderTexture | null = null;

  constructor(private readonly context: StageTextureRendererContext) {}

  // All bitmap captures must go through an off-screen RenderTexture, never the
  // renderer's own canvas: that canvas is displayed directly in the monitor
  // (transferControlToOffscreen), and the awaited createImageBitmap yields to
  // the event loop, which commits whatever intermediate content is on the
  // canvas as a visible frame (black flashes during transitions, effect-less
  // frames with track/adjustment/master effects).
  private ensureCaptureTexture(): RenderTexture {
    const { width, height } = this.context;
    const texture = this.captureTexture;
    const valid =
      texture &&
      !(texture as { destroyed?: boolean }).destroyed &&
      texture.width === width &&
      texture.height === height;
    if (valid) {
      return texture;
    }

    this.captureTexture?.destroy(true);
    this.captureTexture = RenderTexture.create({ width, height });
    return this.captureTexture;
  }

  private extractImageData(texture: RenderTexture): ImageData {
    const renderer = this.context.app.renderer;
    const { pixels, width, height } = renderer.extract.pixels(texture);
    const data =
      pixels instanceof Uint8ClampedArray
        ? pixels
        : new Uint8ClampedArray(pixels as ArrayLike<number>);

    // Pixi's WebGL extract reads the render target's premultiplied pixels but
    // labels them straight (its unpremultiplyAlpha call is compiled out), which
    // darkens semi-transparent pixels; undo the premultiply here. The WebGPU
    // extract path goes through a 2D-canvas drawImage, which already
    // unpremultiplies.
    if (renderer.type === RendererType.WEBGL) {
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]!;
        if (alpha === 0 || alpha === 255) continue;
        data[i] = Math.min(255, Math.round((data[i]! * 255) / alpha));
        data[i + 1] = Math.min(255, Math.round((data[i + 1]! * 255) / alpha));
        data[i + 2] = Math.min(255, Math.round((data[i + 2]! * 255) / alpha));
      }
    }

    return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
  }

  private async captureTextureToBitmap(texture: RenderTexture): Promise<ImageBitmap> {
    return await createImageBitmap(this.extractImageData(texture));
  }

  public setSize(width: number, height: number) {
    this.context.width = width;
    this.context.height = height;
  }

  public destroy() {
    if (this.transitionCombineSprite) {
      this.transitionCombineSprite.destroy();
      this.transitionCombineSprite = null;
    }
    if (this.bitmapCaptureSprite) {
      this.bitmapCaptureSprite.destroy();
      this.bitmapCaptureSprite = null;
    }
    if (this.captureTexture) {
      this.captureTexture.destroy(true);
      this.captureTexture = null;
    }
  }

  public renderCombinedTransitionTexture(
    fromTexture: RenderTexture,
    toTexture: RenderTexture,
    combined: RenderTexture,
  ): void {
    const renderer = this.context.app.renderer;

    if (!this.transitionCombineSprite) {
      this.transitionCombineSprite = new Sprite(Texture.EMPTY);
      this.transitionCombineSprite.anchor.set(0, 0);
    }

    this.transitionCombineSprite.texture = fromTexture;
    this.transitionCombineSprite.x = 0;
    this.transitionCombineSprite.y = 0;
    this.transitionCombineSprite.scale.set(1, 1);
    this.transitionCombineSprite.width = this.context.width;
    this.transitionCombineSprite.height = this.context.height;
    renderer.render({ container: this.transitionCombineSprite, target: combined, clear: true });

    this.transitionCombineSprite.texture = toTexture;
    this.transitionCombineSprite.x = this.context.width;
    this.transitionCombineSprite.y = 0;
    this.transitionCombineSprite.scale.set(1, 1);
    this.transitionCombineSprite.width = this.context.width;
    this.transitionCombineSprite.height = this.context.height;
    renderer.render({ container: this.transitionCombineSprite, target: combined, clear: false });
  }

  public ensureTransitionSprite(clip: CompositorClip): Sprite {
    let sprite = clip.transitionSprite ?? null;
    if (!sprite) {
      sprite = new Sprite(Texture.EMPTY);
      (sprite as { __clipId?: string }).__clipId = clip.itemId;
      (sprite as { __clipOrder?: number }).__clipOrder = 1;
      sprite.visible = false;
      clip.transitionSprite = sprite;
    }

    const spriteParent = clip.sprite?.parent;
    if (spriteParent && sprite.parent !== spriteParent) {
      spriteParent.addChild(sprite);
    }

    sprite.x = 0;
    sprite.y = 0;
    sprite.anchor.set(0, 0);
    sprite.scale.set(1, 1);
    sprite.width = this.context.width;
    sprite.height = this.context.height;

    return sprite;
  }

  public renderDisplayObjectToTexture(displayObject: Container, texture: RenderTexture) {
    this.context.app.renderer.render({
      container: displayObject,
      target: texture,
      clear: true,
    });
  }

  public renderDisplayObjectToTextureForcedVisible(
    displayObject: Container,
    texture: RenderTexture,
  ) {
    const previousVisible = displayObject.visible;
    displayObject.visible = true;
    try {
      this.renderDisplayObjectToTexture(displayObject, texture);
    } finally {
      displayObject.visible = previousVisible;
    }
  }

  public async renderDisplayObjectToBitmapForcedVisible(
    displayObject: Container,
    options: { transparent?: boolean } = {},
  ): Promise<ImageBitmap> {
    const previousVisible = displayObject.visible;
    displayObject.visible = true;
    try {
      const capture = this.ensureCaptureTexture();
      this.context.app.renderer.render({
        container: displayObject,
        target: capture,
        clear: true,
        // The default clear uses the project background color; isolated
        // captures (track effects) must keep the content's own alpha so the
        // processed result still composites over the layers below it.
        clearColor: options.transparent ? [0, 0, 0, 0] : undefined,
      });
      return await this.captureTextureToBitmap(capture);
    } finally {
      displayObject.visible = previousVisible;
    }
  }

  public async renderTextureToBitmap(texture: RenderTexture): Promise<ImageBitmap> {
    if (!this.bitmapCaptureSprite) {
      this.bitmapCaptureSprite = new Sprite(Texture.EMPTY);
      this.bitmapCaptureSprite.anchor.set(0, 0);
    }

    this.bitmapCaptureSprite.texture = texture;
    this.bitmapCaptureSprite.x = 0;
    this.bitmapCaptureSprite.y = 0;
    this.bitmapCaptureSprite.scale.set(
      this.context.width / Math.max(1, texture.width),
      this.context.height / Math.max(1, texture.height),
    );

    const capture = this.ensureCaptureTexture();
    this.context.app.renderer.render({
      container: this.bitmapCaptureSprite,
      target: capture,
      clear: true,
    });
    return await this.captureTextureToBitmap(capture);
  }

  public renderSingleClipToTexture(
    clip: CompositorClip,
    texture: RenderTexture,
    forceVisible = false,
  ) {
    const stageChildren = this.context.app.stage.children;
    const stagePrev = stageChildren.map((child) => child.visible);

    for (let i = 0; i < stageChildren.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = stageChildren[i] as any;
      if (!child) continue;
      const track = this.context.getTrackById(child?.__trackId ?? '');
      child.visible = track?.id === clip.trackId;
    }

    const trackContainer = this.context.getTrackById(clip.trackId ?? '')?.container ?? null;
    const containerChildren = trackContainer ? [...trackContainer.children] : [];
    const containerPrev = containerChildren.map((c) => c.visible);
    for (const c of containerChildren) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).visible = c === clip.sprite;
    }

    const previousClipVisible = clip.sprite?.visible;
    if (forceVisible && clip.sprite) {
      clip.sprite.visible = true;
    }

    try {
      this.context.app.renderer.render({
        container: this.context.app.stage,
        target: texture,
        clear: true,
      });
    } finally {
      if (clip.sprite) {
        clip.sprite.visible = previousClipVisible ?? true;
      }

      for (let i = 0; i < containerChildren.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (containerChildren[i] as any).visible = containerPrev[i] ?? true;
      }
      for (let i = 0; i < stageChildren.length; i++) {
        const child = stageChildren[i];
        if (!child) continue;
        child.visible = stagePrev[i] ?? true;
      }
    }
  }

  public renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    const children = this.context.app.stage.children;
    const previous = children.map((child) => child.visible);

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as { visible: boolean; __trackId?: string } | undefined;
      if (!child) continue;
      const track = this.context.getTrackById(child.__trackId ?? '');
      const childLayer = typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
      child.visible = childLayer < layer;
    }

    try {
      this.context.app.renderer.render({
        container: this.context.app.stage,
        target: texture,
        clear: true,
      });
    } finally {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;
        child.visible = previous[i] ?? true;
      }
    }
  }

  public async renderLowerLayersToBitmap(
    layer: number,
    options: { edgeInsetPixels?: number } = {},
  ): Promise<ImageBitmap> {
    const children = this.context.app.stage.children;
    const previous = children.map((child) => child.visible);

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as { visible: boolean; __trackId?: string } | undefined;
      if (!child) continue;
      const track = this.context.getTrackById(child.__trackId ?? '');
      const childLayer = typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
      child.visible = childLayer < layer;
    }

    try {
      const capture = this.ensureCaptureTexture();
      this.context.app.renderer.render({
        container: this.context.app.stage,
        target: capture,
        clear: true,
      });
      const captureData = this.extractImageData(capture);

      const edgeInsetPixels = Math.max(0, Math.floor(options.edgeInsetPixels ?? 0));
      const maxInset = Math.max(
        0,
        Math.min(
          Math.floor((this.context.width - 1) / 2),
          Math.floor((this.context.height - 1) / 2),
        ),
      );
      const inset = Math.min(edgeInsetPixels, maxInset);
      if (inset === 0) {
        return await createImageBitmap(captureData);
      }

      return await createImageBitmap(
        captureData,
        inset,
        inset,
        this.context.width - inset * 2,
        this.context.height - inset * 2,
        {
          resizeWidth: this.context.width,
          resizeHeight: this.context.height,
          // Bilinear (positive weights only) rather than 'high'/Lanczos, whose
          // negative side-lobes can ring into a faint dark rim at the clamped
          // crop edge — which a large adjustment-clip blur then spreads inward
          // as a vignette. The upscale here is ~1.004x, so quality is unchanged.
          resizeQuality: 'low',
        },
      );
    } finally {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;
        child.visible = previous[i] ?? true;
      }
    }
  }
}
