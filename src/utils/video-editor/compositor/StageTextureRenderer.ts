import { Sprite, Texture, type Application, type Container, type RenderTexture } from 'pixi.js';
import type { CompositorClip, CompositorTrack } from './types';

export interface StageTextureRendererContext {
  app: Application;
  width: number;
  height: number;
  getTrackById: (trackId: string) => CompositorTrack | undefined;
}

export class StageTextureRenderer {
  private transitionCombineSprite: Sprite | null = null;

  constructor(private readonly context: StageTextureRendererContext) {}

  public setSize(width: number, height: number) {
    this.context.width = width;
    this.context.height = height;
  }

  public destroy() {
    if (this.transitionCombineSprite) {
      this.transitionCombineSprite.destroy();
      this.transitionCombineSprite = null;
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
      (sprite as any).__clipId = clip.itemId;
      (sprite as any).__clipOrder = 1;
      sprite.visible = false;
      clip.transitionSprite = sprite;
    }

    const parent = clip.sprite.parent;
    if (parent && sprite.parent !== parent) {
      parent.addChild(sprite);
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

  public renderSingleClipToTexture(clip: CompositorClip, texture: RenderTexture, forceVisible = false) {
    const stageChildren = this.context.app.stage.children;
    const stagePrev = stageChildren.map((child) => child.visible);

    for (let i = 0; i < stageChildren.length; i++) {
      const child = stageChildren[i] as any;
      if (!child) continue;
      const track = this.context.getTrackById(child?.__trackId ?? '');
      child.visible = track?.id === clip.trackId;
    }

    const trackContainer = this.context.getTrackById(clip.trackId ?? '')?.container ?? null;
    const containerChildren = trackContainer ? [...trackContainer.children] : [];
    const containerPrev = containerChildren.map((c) => c.visible);
    for (const c of containerChildren) {
      (c as any).visible = c === clip.sprite;
    }

    const previousClipVisible = clip.sprite.visible;
    if (forceVisible) {
      clip.sprite.visible = true;
    }

    this.context.app.renderer.render({
      container: this.context.app.stage,
      target: texture,
      clear: true,
    });

    clip.sprite.visible = previousClipVisible;

    for (let i = 0; i < containerChildren.length; i++) {
      (containerChildren[i] as any).visible = containerPrev[i] ?? true;
    }
    for (let i = 0; i < stageChildren.length; i++) {
      const child = stageChildren[i];
      if (!child) continue;
      child.visible = stagePrev[i] ?? true;
    }
  }

  public renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
    const children = this.context.app.stage.children;
    const previous = children.map((child) => child.visible);

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as any;
      if (!child) continue;
      const track = this.context.getTrackById(child?.__trackId ?? '');
      const childLayer = typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
      child.visible = childLayer < layer;
    }

    this.context.app.renderer.render({
      container: this.context.app.stage,
      target: texture,
      clear: true,
    });

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      child.visible = previous[i] ?? true;
    }
  }
}
