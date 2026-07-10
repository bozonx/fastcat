import { CanvasSource, ImageSource, Texture } from 'pixi.js';

function createInitializedCanvas(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (typeof context?.clearRect === 'function') {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function createPlaceholderImageSource(): ImageSource {
  return new ImageSource({
    resource: createInitializedCanvas(2, 2) as unknown as HTMLCanvasElement,
  });
}

export function createSolidColorTexture(color: string): Texture {
  const canvas = createInitializedCanvas(2, 2);
  const context = canvas.getContext('2d');
  if (context && typeof context.fillRect === 'function') {
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const source = new CanvasSource({
    resource: canvas as unknown as HTMLCanvasElement,
  });
  source.update?.();

  return new Texture({ source, dynamic: true });
}
