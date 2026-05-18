import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const LOCALE_FILES = {
  en: 'src/locales/en-US.json',
  ru: 'src/locales/ru-RU.json',
};

const GENERATED_LOCALE_FILES = {
  en: 'src/locales/en-US.ts',
  ru: 'src/locales/ru-RU.ts',
};

function serializeLocaleModule(locale) {
  return `export default ${JSON.stringify(locale, null, 2)};\n`;
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

async function check() {
  const locales = {};
  const localeKeys = {};
  let error = false;

  for (const [lang, path] of Object.entries(LOCALE_FILES)) {
    locales[lang] = JSON.parse(await readFile(path, 'utf8'));
    localeKeys[lang] = await flattenObject(locales[lang]);

    const generatedPath = GENERATED_LOCALE_FILES[lang];
    const generatedContent = await readFile(generatedPath, 'utf8');
    const expectedContent = serializeLocaleModule(locales[lang]);
    if (generatedContent !== expectedContent) {
      console.error(`${generatedPath} is out of sync with ${path}`);
      error = true;
    }
  }

  const allLocaleKeys = new Set([...Object.keys(localeKeys.en), ...Object.keys(localeKeys.ru)]);
  const usedKeys = new Set();
  const usedDynamicPrefixes = new Set();
  const IGNORED_KEYS = new Set([
    'fastcat.otio.v1',
    'videoEditor.backgroundTasks.copyTitle',
    'videoEditor.backgroundTasks.uploadFailed',
  ]);

  const files = (await getFiles('src')).filter((f) => ['.vue', '.ts', '.js'].includes(extname(f)));
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

  for (const file of files) {
    const content = await readFile(file, 'utf8');

    // 1. Any string literal that looks like a translation key (catches keys passed
    //    as plain strings to historyStore.push, object mappings, etc.)
    const anyKeyRegex = /['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    let match;
    while ((match = anyKeyRegex.exec(content)) !== null) {
      const key = match[1];
      if (keyPrefixes.some((p) => key.startsWith(p))) usedKeys.add(key);
    }

    // 2. Explicit translation calls: t('key') / $t('key')
    const tRegex = /\bt\(\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = tRegex.exec(content)) !== null) usedKeys.add(match[1]);
    const $tRegex = /\$t\(\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = $tRegex.exec(content)) !== null) usedKeys.add(match[1]);

    // 3. v-t directive
    const vtRegex = /v-t\s*=\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = vtRegex.exec(content)) !== null) usedKeys.add(match[1]);

    // 4. Manifest / config keys that reference translations
    const keyPropRegex =
      /(?:nameKey|labelKey|descriptionKey|emptyLabelKey|labelXKey|labelYKey)\s*:\s*['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    while ((match = keyPropRegex.exec(content)) !== null) usedKeys.add(match[1]);

    // 5. Dynamic prefixes like t(`prefix.${var}`)
    const dynamicRegex = /\b\$?t\s*\(\s*`([^`$]+)\.?\$\{/g;
    while ((match = dynamicRegex.exec(content)) !== null) {
      const prefix = match[1].replace(/\.$/, '');
      if (prefix) usedDynamicPrefixes.add(prefix);
    }
  }

  const potentiallyUnused = [...allLocaleKeys]
    .filter((k) => !usedKeys.has(k) && ![...usedDynamicPrefixes].some((p) => k.startsWith(p)))
    .sort();
  if (potentiallyUnused.length > 0) {
    console.error('--- Potentially Unused Keys ---');
    potentiallyUnused.forEach((k) => console.error(k));
    error = true;
  }

  const missingInLocales = [...usedKeys]
    .filter((k) => !allLocaleKeys.has(k) && !IGNORED_KEYS.has(k))
    .sort();
  if (missingInLocales.length > 0) {
    console.error('\n--- Missing in Locales ---');
    missingInLocales.forEach((k) => console.error(k));
    error = true;
  }

  const onlyInEn = [...Object.keys(localeKeys.en)].filter((k) => !localeKeys.ru[k]);
  const onlyInRu = [...Object.keys(localeKeys.ru)].filter((k) => !localeKeys.en[k]);

  if (onlyInEn.length > 0 || onlyInRu.length > 0) {
    console.error('\n--- Inconsistency between EN and RU ---');
    if (onlyInEn.length > 0) {
      console.error('Only in EN:');
      onlyInEn.sort().forEach((k) => console.error(`  - ${k}`));
    }
    if (onlyInRu.length > 0) {
      console.error('Only in RU:');
      onlyInRu.sort().forEach((k) => console.error(`  - ${k}`));
    }
    error = true;
  }

  if (error) process.exit(1);
  console.log('i18n check passed!');
}

check().catch(console.error);
