import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const LOCALE_FILES = {
  en: 'src/locales/en-US.json',
  ru: 'src/locales/ru-RU.json',
};

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
    })
  );
  return files.flat();
}

async function check() {
  const locales = {};
  const localeKeys = {};
  for (const [lang, path] of Object.entries(LOCALE_FILES)) {
    locales[lang] = JSON.parse(await readFile(path, 'utf8'));
    localeKeys[lang] = await flattenObject(locales[lang]);
  }

  const allLocaleKeys = new Set([...Object.keys(localeKeys.en), ...Object.keys(localeKeys.ru)]);
  const usedKeys = new Set();
  const usedDynamicPrefixes = new Set();

  const files = (await getFiles('src')).filter(f => ['.vue', '.ts', '.js'].includes(extname(f)));
  const keyPrefixes = ['common.', 'fastcat.', 'videoEditor.', 'form.', 'mobileFiles.', 'errors.', 'timelineCreation.'];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const anyKeyRegex = /['"]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)['"]/g;
    let match;
    while ((match = anyKeyRegex.exec(content)) !== null) {
      const key = match[1];
      if (keyPrefixes.some(p => key.startsWith(p))) usedKeys.add(key);
    }
    const dynamicRegex = /\b\$?t\s*\(\s*`([^`$]+)\.?\$\{/g;
    while ((match = dynamicRegex.exec(content)) !== null) usedDynamicPrefixes.add(match[1]);
    const vtRegex = /v-t="'([^']+)'"/g;
    while ((match = vtRegex.exec(content)) !== null) usedKeys.add(match[1]);
  }

  let error = false;

  const potentiallyUnused = [...allLocaleKeys].filter(k => !usedKeys.has(k) && ![...usedDynamicPrefixes].some(p => k.startsWith(p))).sort();
  if (potentiallyUnused.length > 0) {
    console.error('--- Potentially Unused Keys ---');
    potentiallyUnused.forEach(k => console.error(k));
    error = true;
  }

  const missingInLocales = [...usedKeys].filter(k => !allLocaleKeys.has(k)).sort();
  if (missingInLocales.length > 0) {
    console.error('\n--- Missing in Locales ---');
    missingInLocales.forEach(k => console.error(k));
    error = true;
  }

  const onlyInEn = [...Object.keys(localeKeys.en)].filter(k => !localeKeys.ru[k]);
  const onlyInRu = [...Object.keys(localeKeys.ru)].filter(k => !localeKeys.en[k]);

  if (onlyInEn.length > 0 || onlyInRu.length > 0) {
    console.error('\n--- Inconsistency between EN and RU ---');
    if (onlyInEn.length > 0) { console.error('Only in EN:'); onlyInEn.sort().forEach(k => console.error(`  - ${k}`)); }
    if (onlyInRu.length > 0) { console.error('Only in RU:'); onlyInRu.sort().forEach(k => console.error(`  - ${k}`)); }
    error = true;
  }

  if (error) process.exit(1);
  console.log('i18n check passed!');
}

check().catch(console.error);
