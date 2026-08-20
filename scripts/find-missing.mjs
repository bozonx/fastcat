import fs from 'fs';
import { execSync } from 'child_process';

const data = JSON.parse(fs.readFileSync('src/locales/en-US.json'));

function flatten(obj, prefix = '') {
  const keys = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(keys, flatten(value, fullKey));
    } else {
      keys[fullKey] = value;
    }
  }
  return keys;
}

const allKeys = flatten(data);

// Get all videoEditor.timeline references from source files
const srcFiles = execSync("find src -name '*.vue' -o -name '*.ts' -o -name '*.js'")
  .toString()
  .split('\n')
  .filter(Boolean);

const usedKeys = new Set();
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const regex = /videoEditor\.timeline\.[a-zA-Z0-9_.]+/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    usedKeys.add(match[0]);
  }
}

const missing = [];
for (const key of [...usedKeys].sort()) {
  if (!allKeys[key]) {
    missing.push(key);
  }
}

console.log('Missing keys:', missing.length);
for (const key of missing) {
  console.log('  ', key);
}
