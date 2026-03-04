import { Texture } from 'pixi.js';

export function createNoiseTexture(width = 256, height = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const val = Math.random() * 255;
    data[i] = val;     // R
    data[i + 1] = val; // G
    data[i + 2] = val; // B
    data[i + 3] = 255; // A
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  return Texture.from(canvas);
}
