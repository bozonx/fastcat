/**
 * Доменная модель сцены для нового видео-ядра.
 * Зеркалит src-tauri/src/compositor/scene/mod.rs.
 * (Поля совпадают по именам/snake_case — serde на Rust-стороне настроен на default snake_case).
 */

export interface Scene {
  width: number;
  height: number;
  /** Время кадра в timeline, секунды. */
  time: number;
  layers: Layer[];
  /** RGBA8 0..255. */
  background: [number, number, number, number];
}

export interface Layer {
  id: string;
  kind: LayerKind;
  transform: Transform;
  opacity: number;
  blend: BlendMode;
  mask: Mask | null;
  effects: EffectSpec[];
}

export interface Transform {
  x: number;
  y: number;
  scale_x: number;
  scale_y: number;
  rotation_deg: number;
  anchor_x: number;
  anchor_y: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Mask {
  path: string;
  inverted: boolean;
}

export type LayerKind =
  | { type: 'video-frame'; texture_id: number; natural_width: number; natural_height: number }
  | { type: 'image'; source: string }
  | { type: 'shape'; geometry: ShapeGeometry; fill?: Paint; stroke?: Stroke }
  | { type: 'svg'; source: string }
  | {
      type: 'text';
      content: string;
      font_family: string;
      font_size: number;
      color: [number, number, number, number];
      weight: number;
      italic: boolean;
      align: 'left' | 'center' | 'right' | 'justify';
      line_height: number;
      max_width: number | null;
    }
  | { type: 'group'; children: Layer[] };

export type ShapeGeometry =
  | { kind: 'rect'; width: number; height: number; radius: number }
  | { kind: 'ellipse'; rx: number; ry: number }
  | { kind: 'path'; d: string };

export type Paint =
  | { type: 'solid'; rgba: [number, number, number, number] }
  | { type: 'linear-gradient'; from: [number, number]; to: [number, number]; stops: GradientStop[] }
  | { type: 'radial-gradient'; center: [number, number]; radius: number; stops: GradientStop[] };

export interface GradientStop {
  offset: number;
  rgba: [number, number, number, number];
}
export interface Stroke {
  paint: Paint;
  width: number;
}

export type EffectSpec =
  | { type: 'gaussian-blur'; radius: number }
  | { type: 'brightness'; value: number }
  | { type: 'contrast'; value: number }
  | { type: 'saturation'; value: number }
  | { type: 'hue'; degrees: number }
  | {
      type: 'levels';
      in_black: number;
      in_white: number;
      gamma: number;
      out_black: number;
      out_white: number;
    }
  | {
      type: 'chroma-key';
      key_rgba: [number, number, number, number];
      threshold: number;
      smoothness: number;
    }
  | { type: 'sharpen'; amount: number }
  | { type: 'pixelate'; size: number }
  | { type: 'custom-wgsl'; source: string; params: unknown };

export type TransitionSpec =
  | { type: 'crossfade' }
  | { type: 'wipe'; angle_deg: number; softness: number }
  | { type: 'slide'; direction: 'left' | 'right' | 'up' | 'down' }
  | { type: 'dissolve'; seed: number }
  | { type: 'circle-reveal'; center: [number, number]; softness: number }
  | { type: 'custom-wgsl'; source: string; params: unknown };

export interface MediaInfo {
  clip_id: string;
  width: number;
  height: number;
  duration_sec: number;
  fps: number;
  codec: string;
  has_audio: boolean;
}

export interface VideoBackend {
  /** Открыть медиафайл, получить метаданные и зарегистрировать в кэше. */
  openMedia(path: string): Promise<MediaInfo>;
  /** Отрендерить один кадр сцены (offscreen). Возврат — растровый снимок для монитора. */
  renderFrame(scene: Scene): Promise<{ width: number; height: number; bitmap: ImageBitmap | null }>;
  /** Освободить все ресурсы (адаптер закрывается, текстуры сбрасываются). Для тестов и shutdown. */
  dispose(): Promise<void>;
}
