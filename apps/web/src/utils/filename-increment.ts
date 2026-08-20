export interface IncrementOptions {
  style?: 'underscore' | 'parentheses' | 'space' | 'none';
  padWidth?: number;
  startIndex?: number;
  forceIndex?: boolean;
}

export interface GetNextIncrementNameParams {
  fileName: string;
  existingNames: string[] | Set<string> | ReadonlySet<string>;
  style?: 'underscore' | 'parentheses' | 'space' | 'none';
  padWidth?: number;
  startIndex?: number;
  forceIndex?: boolean;
}

/**
 * Parses a filename to extract its base name, suffix style, counter value, padding width, and extension.
 */
export function parseFilename(fileName: string): {
  base: string;
  suffixStyle: 'underscore' | 'parentheses' | 'space' | 'none' | null;
  counter: number | null;
  padWidth: number;
  ext: string;
} {
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '';
  const nameWithoutExt = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

  // 1. Parentheses: "base (123)"
  const parenMatch = nameWithoutExt.match(/^(.*) \((\d+)\)$/);
  if (parenMatch) {
    return {
      base: parenMatch[1]!,
      suffixStyle: 'parentheses',
      counter: parseInt(parenMatch[2]!, 10),
      padWidth: parenMatch[2]!.length,
      ext,
    };
  }

  // 2. Underscore: "base_123"
  const underMatch = nameWithoutExt.match(/^(.*)_(\d+)$/);
  if (underMatch) {
    return {
      base: underMatch[1]!,
      suffixStyle: 'underscore',
      counter: parseInt(underMatch[2]!, 10),
      padWidth: underMatch[2]!.length,
      ext,
    };
  }

  // 3. Space: "base 123"
  const spaceMatch = nameWithoutExt.match(/^(.*) (\d+)$/);
  if (spaceMatch) {
    return {
      base: spaceMatch[1]!,
      suffixStyle: 'space',
      counter: parseInt(spaceMatch[2]!, 10),
      padWidth: spaceMatch[2]!.length,
      ext,
    };
  }

  // 4. None: "base123"
  const noneMatch = nameWithoutExt.match(/^(.*?)(\d+)$/);
  if (noneMatch && noneMatch[1]) {
    return {
      base: noneMatch[1]!,
      suffixStyle: 'none',
      counter: parseInt(noneMatch[2]!, 10),
      padWidth: noneMatch[2]!.length,
      ext,
    };
  }

  return {
    base: nameWithoutExt,
    suffixStyle: null,
    counter: null,
    padWidth: 0,
    ext,
  };
}

/**
 * Returns the next available filename by incrementing the highest existing counter value
 * for filenames matching the same base pattern and extension.
 */
export function getNextIncrementName(params: GetNextIncrementNameParams): string {
  const { fileName, existingNames, style, padWidth, startIndex = 1, forceIndex = false } = params;

  const existingSet = existingNames instanceof Set ? existingNames : new Set(existingNames);

  // If the file is not in the set and we are not forcing the index, we can use it directly
  if (!forceIndex && !existingSet.has(fileName)) {
    return fileName;
  }

  const parsedSource = parseFilename(fileName);
  const targetStyle = style ?? parsedSource.suffixStyle ?? 'underscore';
  const targetPadWidth = padWidth ?? parsedSource.padWidth ?? 3;

  const sourceBaseLower = parsedSource.base.toLowerCase();
  const sourceExtLower = parsedSource.ext.toLowerCase();

  const existingCounters: number[] = [];

  for (const name of existingSet) {
    const parsed = parseFilename(name);
    if (
      parsed.base.toLowerCase() === sourceBaseLower &&
      parsed.ext.toLowerCase() === sourceExtLower
    ) {
      if (parsed.counter !== null) {
        existingCounters.push(parsed.counter);
      } else {
        // Treat names without a counter (e.g. "video.mp4") as 0
        existingCounters.push(0);
      }
    }
  }

  const maxVal = existingCounters.length > 0 ? Math.max(...existingCounters) : 0;
  const nextVal = Math.max(maxVal + 1, startIndex);

  // Generate the formatted suffix
  const padded = String(nextVal).padStart(targetPadWidth, '0');
  let suffix = '';
  switch (targetStyle) {
    case 'parentheses':
      suffix = ` (${padded})`;
      break;
    case 'underscore':
      suffix = `_${padded}`;
      break;
    case 'space':
      suffix = ` ${padded}`;
      break;
    case 'none':
      suffix = padded;
      break;
  }

  return `${parsedSource.base}${suffix}${parsedSource.ext}`;
}
