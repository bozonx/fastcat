import type { Text } from 'pixi.js';
import { TextStyle } from 'pixi.js';
import type { CompositorClip } from '../types';
import { areTextClipStylesEqual } from '../types';

export class TextRenderer {
  public updateTextClip(clip: CompositorClip, text: string, style?: any) {
    const sprite = clip.sprite as Text;
    const styleChanged = !areTextClipStylesEqual(clip.style, style);

    if (clip.text !== text || styleChanged || clip.textDirty) {
      sprite.text = text;
      clip.text = text;
      clip.textDirty = false;

      if (styleChanged || !clip.style) {
        clip.style = { ...style };
        sprite.style = this.createPixiStyle(style);
      }
    }
  }

  private createPixiStyle(style: any): TextStyle {
    return new TextStyle({
      fontFamily: style.fontFamily || 'Arial',
      fontSize: style.fontSize || 24,
      fill: style.color || '#ffffff',
      align: style.align || 'left',
      // ... more style mappings ...
    });
  }
}
