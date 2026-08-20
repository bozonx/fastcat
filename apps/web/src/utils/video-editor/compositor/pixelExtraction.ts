interface ExtractedPixels {
  pixels: unknown;
}

export function getExtractedPixelBytes(extracted: unknown): Uint8Array {
  const value =
    extracted && typeof extracted === 'object' && 'pixels' in extracted
      ? (extracted as ExtractedPixels).pixels
      : extracted;

  if (!ArrayBuffer.isView(value)) {
    return new Uint8Array(0);
  }

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
