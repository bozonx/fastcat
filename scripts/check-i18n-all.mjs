import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

async function getFiles(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(
    subdirs.map(async (subdir) => {
      const res = join(dir, subdir);
      return (await stat(res)).isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat();
}

async function flattenObject(obj, prefix = '') {
  let keys = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(keys, await flattenObject(value, fullKey));
    } else {
      keys[fullKey] = value;
    }
  }
  return keys;
}

async function check() {
  const localeFiles = {
    en: 'src/locales/en-US.json',
    ru: 'src/locales/ru-RU.json',
  };
  const locales = {};
  const localeKeys = {};
  for (const [lang, path] of Object.entries(localeFiles)) {
    locales[lang] = JSON.parse(await readFile(path, 'utf8'));
    localeKeys[lang] = await flattenObject(locales[lang]);
  }

  const allLocaleKeys = new Set([...Object.keys(localeKeys.en), ...Object.keys(localeKeys.ru)]);
  const usedKeys = new Set();
  const usedDynamicPrefixes = new Set();
  const IGNORED_KEYS = new Set([
    'fastcat.otio.v1',
    'videoEditor.backgroundTasks.copyTitle',
    'videoEditor.backgroundTasks.uploadFailed',
  ]);

  const keyPrefixes = [
    'common.',
    'fastcat.',
    'videoEditor.',
    'form.',
    'mobileFiles.',
    'errors.',
    'timelineCreation.',
    'navigation.',
  ];

  const files = (await getFiles('.')).filter((f) => {
    if (f.startsWith('node_modules') || f.startsWith('.git') || f.startsWith('dist')) return false;
    return ['.vue', '.ts', '.js'].includes(extname(f));
  });

  for (const file of files) {
    const content = await readFile(file, 'utf8');

    const anyKeyRegex = /['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    let match;
    while ((match = anyKeyRegex.exec(content)) !== null) {
      const key = match[1];
      if (keyPrefixes.some((p) => key.startsWith(p))) usedKeys.add(key);
    }

    const tRegex = /\bt\(\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = tRegex.exec(content)) !== null) usedKeys.add(match[1]);

    const $tRegex = /\$t\(\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = $tRegex.exec(content)) !== null) usedKeys.add(match[1]);

    const vtRegex = /v-t\s*=\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = vtRegex.exec(content)) !== null) usedKeys.add(match[1]);

    const keyPropRegex =
      /(?:nameKey|labelKey|descriptionKey|emptyLabelKey|labelXKey|labelYKey)\s*:\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = keyPropRegex.exec(content)) !== null) usedKeys.add(match[1]);

    const dynamicRegex = /\b\$?t\s*\(\s*`([^`$]+)\.?\$\{/g;
    while ((match = dynamicRegex.exec(content)) !== null) {
      const prefix = match[1].replace(/\.$/, '');
      if (prefix) usedDynamicPrefixes.add(prefix);
    }
  }

  const missingInLocales = [...usedKeys]
    .filter((k) => !allLocaleKeys.has(k) && !IGNORED_KEYS.has(k))
    .sort();

  if (missingInLocales.length > 0) {
    console.error('--- Missing in Locales ---');
    missingInLocales.forEach((k) => console.error(k));
    process.exit(1);
  } else {
    console.log('No missing keys found!');
  }
}

check().catch(console.error);
