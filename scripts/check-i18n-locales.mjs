import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function flattenObject(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedKeys = flattenObject(nested, nextPrefix);
      return nestedKeys.length > 0 ? nestedKeys : [nextPrefix];
    }
    return [nextPrefix];
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const rootDir = process.cwd();
const enPath = resolve(rootDir, 'src/locales/en-US.json');
const ruPath = resolve(rootDir, 'src/locales/ru-RU.json');

const [en, ru] = await Promise.all([readJson(enPath), readJson(ruPath)]);

const enKeys = new Set(flattenObject(en));
const ruKeys = new Set(flattenObject(ru));

const missingInRu = [...enKeys].filter((key) => !ruKeys.has(key)).sort();
const extraInRu = [...ruKeys].filter((key) => !enKeys.has(key)).sort();

if (missingInRu.length === 0 && extraInRu.length === 0) {
  console.log('Locale keys are in sync: en-US.json <-> ru-RU.json');
  process.exit(0);
}

if (missingInRu.length > 0) {
  console.error('Missing keys in ru-RU.json:');
  for (const key of missingInRu) {
    console.error(`- ${key}`);
  }
}

if (extraInRu.length > 0) {
  console.error('Extra keys in ru-RU.json:');
  for (const key of extraInRu) {
    console.error(`- ${key}`);
  }
}

process.exit(1);
