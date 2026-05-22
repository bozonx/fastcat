let fontsLoaded = false;

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto:wght@400;700&family=Montserrat:wght@400;700&family=Oswald:wght@400;700&family=Noto+Sans:wght@400;700&family=Open+Sans:wght@400;700&family=Playfair+Display:wght@400;700&family=Lato:wght@400;700&display=swap';

export async function loadFonts(): Promise<void> {
  if (fontsLoaded) return;
  fontsLoaded = true;

  try {
    const response = await fetch(GOOGLE_FONTS_URL);
    const css = await response.text();
    const faceBlocks = css.match(/@font-face\s*{[^}]+}/g) ?? [];
    for (const block of faceBlocks) {
      const familyMatch = block.match(/font-family:\s*['"]?([^'";]+)['"]?/);
      const urlMatch = block.match(/url\(([^)]+)\)/);
      if (familyMatch?.[1] && urlMatch?.[1]) {
        const family = familyMatch[1].trim();
        const url = urlMatch[1].replace(/['"]/g, '');
        const fontFace = new FontFace(family, `url(${url})`);
        (self as unknown as { fonts: FontFaceSet }).fonts.add(fontFace);
        await fontFace.load();
      }
    }
  } catch (e) {
    console.warn('[Worker] Font loading failed:', e);
  }
}
