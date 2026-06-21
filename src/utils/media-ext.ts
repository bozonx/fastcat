export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
export const SVG_EXT = new Set(['svg']);

export function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1).toLowerCase() : '';
}

export function isImagePath(path: string): boolean {
  const ext = extOf(path);
  return IMAGE_EXT.has(ext) || SVG_EXT.has(ext);
}

export function isImageMimeType(type: string): boolean {
  return type.startsWith('image/');
}
