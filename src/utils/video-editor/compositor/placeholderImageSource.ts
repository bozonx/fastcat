import { ImageSource } from 'pixi.js';

export function createPlaceholderImageSource(): ImageSource {
  const canvas = new OffscreenCanvas(2, 2);
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);

  return new ImageSource({
    resource: canvas as unknown as HTMLCanvasElement,
  });
}
